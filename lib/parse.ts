/**
 * 把模型返回的那坨文本，变成能用的对象。
 *
 * 为什么单独一个文件：
 * 模型不是一个 API，它是一个"会说人话的接口"。同一句 prompt 它可能返回：
 *
 *   好的，我来分析一下：
 *   ```json
 *   { "claims": [ ... ] }
 *   ```
 *   希望对你有帮助！
 *
 * 也可能用全角引号 “ ” 当 JSON 的引号，也可能在 JSON 里写注释，
 * 也可能因为 max_tokens 被截断在半个对象上。
 * 这些都不该让整个页面崩掉，更不该让用户看到一屏 ZodError。
 *
 * 所以分两步，各管一件事：
 *   extractJson()  只负责"把 JSON 那一段抠出来"，不管内容对不对
 *   parseWith()    抠出来之后交给 zod，成功给数据，失败给人话
 *
 * 为什么不直接用 JSON.parse：
 * JSON.parse 只认"整个字符串就是一个 JSON"这一种情况。
 * 而模型返回带解释文字的概率，比返回纯 JSON 高得多。
 */

import type { ZodType } from "zod";
import { formatIssues } from "./schema.ts";

/* ---------------------------------------------------------------
   0. 错误类型
   --------------------------------------------------------------- */

/**
 * 抠 JSON 失败时抛这个，而不是抛原生 Error。
 * 好处是调用方能用 instanceof 分辨"是文本不像 JSON"还是"别的地方真出错了"。
 * 前者是正常情况（模型抽风），后者是 bug，不该混在一起处理。
 */
export class JsonExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonExtractError";
  }
}

/* ---------------------------------------------------------------
   1. 小工具
   --------------------------------------------------------------- */

type ParseOk = { ok: true; value: unknown };
type ParseBad = { ok: false; error: string };

/** 包一层 JSON.parse，失败不抛异常只返回原因，方便一路往下试。 */
function tryParse(text: string): ParseOk | ParseBad {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 报错时给用户看一小段原文，否则"解析失败"三个字等于没说。 */
function preview(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

/** 把所有 ``` 代码块的内容抽出来，不区分语言标记。 */
function fencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  const fence = /```[a-zA-Z]*[ \t]*\r?\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

/** 找出文本里所有可能的 JSON 起点（{ 或 [ 的位置），最多 20 个。 */
function jsonStarts(text: string): number[] {
  const starts: number[] = [];
  for (let i = 0; i < text.length && starts.length < 20; i++) {
    const ch = text[i];
    if (ch === "{" || ch === "[") starts.push(i);
  }
  return starts;
}

/**
 * 从 start 位置的 { 或 [ 开始，往后数括号，返回配平的那一段。
 *
 * 为什么要数括号而不是找最后一个 }：
 * 模型常返回 { ... } 后面还跟着一句"以上是我的分析"，
 * 找最后一个 } 会把后面的废话一起圈进来。
 *
 * 为什么要跟踪字符串状态：
 * 主张原文里完全可能有中文括号、花括号，甚至 {"text": "他说 {这是示例}"}。
 * 不区分"在字符串里"和"在结构里"，遇到字符串里的 } 就会提前收工。
 */
function sliceBalanced(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }

    // 全角引号也算字符串起点：模型写中文时很爱用 “ 而不是 "
    if (ch === '"' || ch === "“" || ch === "”") {
      inString = true;
      quote = ch === "“" || ch === "”" ? "”" : '"';
      continue;
    }

    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
      if (depth < 0) return null;
    }
  }

  return null;
}

/**
 * 修一修"差一点就能解析"的 JSON。
 *
 * 只在直接 JSON.parse 失败之后才调用 —— 主路径不猜，猜是最后手段。
 * 修四样东西，而且全部在"字符串外面"修，字符串里面的内容一个字不动：
 *   1. 全角引号 “ ” → "（中文输入法打出来的）
 *   2. // 行注释 和 /* 块注释 *\/（模型爱学 JS 对象字面量）
 *   3. 尾逗号 { "a": 1, } → { "a": 1 }
 *
 * 为什么不直接正则全局替换全角引号：
 * 因为主张原文里本来就可能有 “……” 这种中文引号，
 * 全局替换会把用户的原文改掉，报告里就会出现一堆怪引号。
 * 只有"当前不在字符串里"时遇到的引号才可能是 JSON 的分隔符。
 */
function repair(text: string): string {
  let out = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === quote) {
        out += '"';
        inString = false;
        quote = "";
        continue;
      }
      out += ch;
      continue;
    }

    if (ch === '"') {
      out += '"';
      inString = true;
      quote = '"';
      continue;
    }
    if (ch === "“" || ch === "”") {
      out += '"';
      inString = true;
      quote = "”";
      continue;
    }

    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") continue;
      out += ch;
      continue;
    }

    out += ch;
  }

  return out;
}

/* ---------------------------------------------------------------
   2. 主函数：从任意文本里抠出 JSON
   --------------------------------------------------------------- */

/**
 * 从模型返回的文本里抠出 JSON 并解析成值。
 *
 * 按"从保守到激进"的顺序试，任何一步成功就停：
 *   1. 整段就是 JSON                  ← 最理想，一行就中
 *   2. ``` 代码块里的内容             ← 最常见
 *   3. 从 { 或 [ 开始配平括号的那一段 ← 前后有废话时用
 *   4. 上面都失败，才动用 repair() 修  ← 全角引号、注释、尾逗号
 *
 * 为什么顺序不能反：
 * repair() 会动文本。能不改就不改，改了就可能把内容改坏。
 */
export function extractJson(raw: string): unknown {
  const text = raw.replace(/^\uFEFF/, "").trim();

  if (text === "") {
    throw new JsonExtractError("模型返回的是空字符串。可能请求被截断了，或者 key 没有额度。");
  }

  // 1. 整段就是 JSON
  const whole = tryParse(text);
  if (whole.ok) return whole.value;

  // 2. 代码块
  for (const block of fencedBlocks(text)) {
    const found = fromText(block.trim());
    if (found !== null) return found;
  }

  // 3. 从 JSON 起点配平
  const found = fromText(text);
  if (found !== null) return found;

  // 4. 全都失败，给一条能定位问题的报错
  const starts = jsonStarts(text);
  if (starts.length === 0) {
    /**
     * 有代码块但里面是空的，单独报一句。
     * 这不是凑数：模型被截断时经常正好停在 ```json 之后，
     * 报"找不到 { 或 ["会让人以为是自己贴错了，其实是对面没写完。
     */
    if (text.includes("```")) {
      throw new JsonExtractError(
        `返回里有代码块，但代码块是空的。多半是 max_tokens 用完被截断了。原文：${preview(text)}`,
      );
    }
    throw new JsonExtractError(
      `这段文本里找不到 { 或 [，模型可能只回了一句人话。原文开头：${preview(text)}`,
    );
  }
  if (sliceBalanced(text, starts[0]) === null) {
    throw new JsonExtractError(
      `找到了 JSON 的开头，但括号没闭合，返回可能被截断了。原文结尾：${preview(text.slice(-80))}`,
    );
  }
  throw new JsonExtractError(`JSON 语法错误：${whole.error}。原文开头：${preview(text)}`);
}

/**
 * 在一段文本里找 JSON：先原样试，再配平括号试，最后修一修再试。
 * 找不到返回 null（不是抛异常），因为调用方还有别的候选文本要试。
 */
function fromText(text: string): unknown | null {
  const direct = tryParse(text);
  if (direct.ok) return direct.value;

  for (const start of jsonStarts(text)) {
    const body = sliceBalanced(text, start);
    if (body === null) continue;

    const plain = tryParse(body);
    if (plain.ok) return plain.value;

    const fixed = tryParse(repair(body));
    if (fixed.ok) return fixed.value;
  }

  const repaired = tryParse(repair(text));
  if (repaired.ok) return repaired.value;

  return null;
}

/* ---------------------------------------------------------------
   3. 抠出来之后交给 zod
   --------------------------------------------------------------- */

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * 一步到位：文本 → JSON → zod 校验 → 结果。
 *
 * 为什么返回 { ok, data | error } 而不是抛异常：
 * 这一步失败是"正常业务"，不是"程序 bug"。
 * 抛异常会逼着每个调用方写 try/catch，而且很容易漏掉一个就白屏。
 * 返回结果对象，调用方必须显式处理失败那一支，TypeScript 会盯着你。
 */
export function parseWith<T>(schema: ZodType<T>, raw: string): ParseResult<T> {
  let json: unknown;
  try {
    json = extractJson(raw);
  } catch (e) {
    if (e instanceof JsonExtractError) return { ok: false, error: e.message };
    throw e;
  }

  const result = schema.safeParse(json);
  if (result.success) return { ok: true, data: result.data };

  return { ok: false, error: formatIssues(result.error) };
}

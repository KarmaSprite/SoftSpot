/**
 * parse.ts 自检脚本。
 *
 * 为什么需要它：模型返回的文本有多脏，只有真跑过才知道。
 * 这里把"见过的脏样本"一条条固定下来，改完代码两秒就能确认没退化。
 * 不依赖网络、不依赖 key、不花钱。
 *
 * 跑法：node scripts/check-parse.mjs
 */

import { extractJson, parseWith } from "../lib/parse.ts";
import { AnalysisResultSchema, ExtractResultSchema } from "../lib/schema.ts";

let passed = 0;
let failed = 0;

function pass(name, extra) {
  passed++;
  console.log(`✓ ${name}`);
  if (extra) console.log(`  → ${extra}`);
}

function fail(name, why) {
  failed++;
  console.log(`✗ ${name}`);
  console.log(`  ${why}`);
}

/** 期望能抠出 JSON，并且顺便检查抠出来的内容。 */
function json(name, raw, expect) {
  let value;
  try {
    value = extractJson(raw);
  } catch (e) {
    fail(name, `期望能解析，实际抛错：${e.message}`);
    return;
  }
  if (expect) {
    const problem = expect(value);
    if (problem) {
      fail(name, problem);
      return;
    }
  }
  pass(name);
}

/** 期望抠不出来，并且报错信息里要出现某个关键词。 */
function jsonBad(name, raw, keyword) {
  try {
    const value = extractJson(raw);
    fail(name, `期望报错，实际解析成功了：${JSON.stringify(value).slice(0, 120)}`);
  } catch (e) {
    if (!e.message.includes(keyword)) {
      fail(name, `报错里没有「${keyword}」：${e.message}`);
      return;
    }
    pass(name, e.message);
  }
}

/** 期望 parseWith 全链路成功。 */
function ok(name, schema, raw, expect) {
  const result = parseWith(schema, raw);
  if (!result.ok) {
    fail(name, `期望通过，实际被拒：\n  ${result.error}`);
    return;
  }
  if (expect) {
    const problem = expect(result.data);
    if (problem) {
      fail(name, problem);
      return;
    }
  }
  pass(name);
}

/** 期望 parseWith 失败，并且报错信息里要出现某个关键词。 */
function bad(name, schema, raw, keyword) {
  const result = parseWith(schema, raw);
  if (result.ok) {
    fail(name, "期望被拒，实际通过了");
    return;
  }
  if (!result.error.includes(keyword)) {
    fail(name, `报错里没有「${keyword}」：\n  ${result.error}`);
    return;
  }
  pass(name, result.error.split("\n")[0]);
}

/* ---------------------------------------------------------------
   样本
   --------------------------------------------------------------- */

const ONE_CLAIM = '{"claims":[{"id":"c1","text":"口语练习机会不足","type":"problem","location":"研究背景 第 1 段"}]}';

/* ---------------------------------------------------------------
   1. 干净的情况（这一步必须永远先过，否则后面都是空谈）
   --------------------------------------------------------------- */

json("整段就是一个 JSON", ONE_CLAIM, (v) => (v.claims.length === 1 ? null : "claims 长度不对"));

json("```json 代码块包裹", "```json\n" + ONE_CLAIM + "\n```", (v) =>
  v.claims[0].id === "c1" ? null : "id 不对",
);

json("代码块没写语言标记", "```\n" + ONE_CLAIM + "\n```", (v) =>
  v.claims[0].type === "problem" ? null : "type 不对",
);

/* ---------------------------------------------------------------
   2. 前后有废话（最常见的情况）
   --------------------------------------------------------------- */

json("前面有一句「好的，我来分析」", "好的，我来分析一下：\n" + ONE_CLAIM, (v) =>
  v.claims.length === 1 ? null : "claims 长度不对",
);

json("后面跟着「希望对你有帮助」", ONE_CLAIM + "\n\n希望对你有帮助！", (v) =>
  v.claims.length === 1 ? null : "claims 长度不对",
);

json("前后都有废话，中间夹一个代码块", "好的：\n```json\n" + ONE_CLAIM + "\n```\n以上是我的分析。", (v) =>
  v.claims[0].location === "研究背景 第 1 段" ? null : "location 不对",
);

json("一段废话里夹了两个 JSON，取第一个能解析的", '先说 {坏的 再给 ' + ONE_CLAIM, (v) =>
  Array.isArray(v.claims) ? null : "没取到主张数组",
);

/* ---------------------------------------------------------------
   3. 差一点就能解析的（repair 负责的部分）
   --------------------------------------------------------------- */

json(
  "全角引号当 JSON 的引号",
  "{“claims”:[{“id”:“c1”,“text”:“x”,“type”:“problem”,“location”:“第 1 段”}]}",
  (v) => (v.claims[0].id === "c1" ? null : "全角引号没修对"),
);

json("JSON 里夹了 // 行注释", '{"claims":[ // 这里开始是主张\n{"id":"c1","text":"x","type":"problem","location":"p"}]}', (v) =>
  v.claims.length === 1 ? null : "注释没被去掉",
);

json("JSON 里夹了 /* */ 块注释", '{"claims":[/* 主张列表 */{"id":"c1","text":"x","type":"problem","location":"p"}]}', (v) =>
  v.claims.length === 1 ? null : "块注释没被去掉",
);

json("尾逗号", '{"claims":[{"id":"c1","text":"x","type":"problem","location":"p",},]}', (v) =>
  v.claims[0].id === "c1" ? null : "尾逗号没被去掉",
);

/* ---------------------------------------------------------------
   4. 关键一条：修的时候不能改到字符串里的内容
   --------------------------------------------------------------- */

json(
  "主张原文里的中文引号不能被改成英文引号",
  '{"claims":[{"id":"c1","text":"老师说“多练就好”，但学生没机会","type":"problem","location":"p"}]}',
  (v) =>
    v.claims[0].text === "老师说“多练就好”，但学生没机会"
      ? null
      : `原文被改了：${v.claims[0].text}`,
);

/* ---------------------------------------------------------------
   5. 真坏了的（要给得出人话，不能给一屏堆栈）
   --------------------------------------------------------------- */

jsonBad("空字符串", "", "空字符串");
jsonBad("只有空白字符", "   \n\t  ", "空字符串");
jsonBad("只有 ``` 没有内容", "```json\n```", "代码块是空的");
jsonBad("纯人话，一个括号都没有", "这个问题很复杂，我需要更多信息才能回答。", "找不到 { 或 [");
jsonBad("被 max_tokens 截断在半个对象上", '{"claims":[{"id":"c1","text":"x"', "括号没闭合");

/* ---------------------------------------------------------------
   6. 抠出来了但内容不对（这一步交给 zod）
   --------------------------------------------------------------- */

ok("干净的 JSON 一路通过", ExtractResultSchema, ONE_CLAIM);

ok("代码块 + 废话也能通过", ExtractResultSchema, "好的：\n```json\n" + ONE_CLAIM + "\n```");

bad(
  "合法 JSON 但缺 text 字段",
  ExtractResultSchema,
  '{"claims":[{"id":"c1","type":"problem","location":"p"}]}',
  "claims.0.text",
);

bad(
  "type 冒出第四种",
  ExtractResultSchema,
  '{"claims":[{"id":"c1","text":"x","type":"innovation","location":"p"}]}',
  "claims.0.type",
);

bad(
  "及格线不是 3 条",
  AnalysisResultSchema,
  '{"claims":[{"id":"c1","text":"x","type":"problem","location":"p","overlap":88,"defensibility":72}],' +
    '"questions":[{"id":"q1","claimId":"c1","question":"q","why":"w","checklist":["a","b"],"risk":63}]}',
  "questions.0.checklist",
);

/* ---------------------------------------------------------------
   收尾
   --------------------------------------------------------------- */

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

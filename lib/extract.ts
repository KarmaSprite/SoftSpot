/**
 * L1 抽取：提纲文本 → 主张数组。
 *
 * 这个文件干的事，说白了就三步：
 *   1. 检查输入（太短太长都别浪费一次调用）
 *   2. 让模型抽（具体怎么调由外面传进来）
 *   3. 校验 + 核对（结构交给 zod，原文对不对由纯代码核对）
 *
 * 为什么模型调用要从外面传进来（callModel 是个参数）：
 * 现在还没有 API key。如果在这里写死 fetch DeepSeek，
 * 那这一步一行代码都测不了，只能干等。
 *
 * 做成参数之后，测试的时候传一个"假模型"（返回事先写死的字符串），
 * 上线的时候传"真模型"（fetch DeepSeek）。
 * 同一份 prompt、同一份校验逻辑，两种情况下跑的是同一段代码。
 *
 * 这不只是为了现在能测。改 prompt 的时候，你会想反复验证
 * "这条脏数据现在还能不能兜住" —— 每次都要真调一次 API 的话，
 * 既慢又花钱，改几次人就不想改了。
 */

import { parseWith } from "./parse.ts";
import { buildExtractMessages } from "./prompts.ts";
import { ExtractResultSchema, type ExtractResult } from "./schema.ts";

/* ---------------------------------------------------------------
   0. 类型
   --------------------------------------------------------------- */

/**
 * 调用模型的最小约定。
 *
 * 故意只有两个参数、一个返回值：
 * 参数越多，假模型就越难写，测试就越容易被跳过。
 * 将来真要加 temperature、max_tokens 这类东西，
 * 应该由实现方自己决定，不该污染这个接口。
 */
export type ModelCaller = (system: string, user: string) => Promise<string>;

export type ExtractOk = {
  ok: true;
  data: ExtractResult;
  /** 结构没问题，但有些地方值得提醒用户（比如原文对不上）。 */
  warnings: string[];
};

export type ExtractBad = {
  ok: false;
  /** 给人看的错误说明，可以直接显示在页面上。 */
  error: string;
};

export type ExtractOutcome = ExtractOk | ExtractBad;

/* ---------------------------------------------------------------
   1. 输入长度限制
   --------------------------------------------------------------- */

/**
 * 太短的提纲抽不出东西，太长的会超出模型的上下文窗口。
 *
 * 为什么下限是 40 字：
 * 一条主张本身就二三十字，加上"我要研究……"这种前缀，
 * 少于 40 字的输入基本不可能含有一条完整主张。
 * 与其花钱让模型返回一个空数组，不如当场告诉用户"再多写点"。
 *
 * 为什么上限是 8000 字：
 * 一份正常的开题提纲 1000-3000 字。8000 字已经是很长很长的了。
 * 设这个上限是为了在超长输入时给出人话提示，
 * 而不是让模型默默截断前半段 —— 那样抽出来的主张会缺一大块，
 * 用户还以为是模型水平不行。
 */
export const MIN_OUTLINE_LENGTH = 40;
export const MAX_OUTLINE_LENGTH = 8000;

/* ---------------------------------------------------------------
   2. 原文核对
   --------------------------------------------------------------- */

/** 把字符串压成"只留文字"，去掉所有空白和标点，方便比较。 */
function normalize(text: string): string {
  return text
    .replace(/[\s\u3000]+/g, "")
    .replace(/[，。、；：？！“”‘’（）《》〈〉【】…—·,.;:?!"'()<>\[\]-]/g, "");
}

/**
 * 检查模型抽出来的主张，原文里到底有没有。
 *
 * 为什么必须查这一条：
 * prompt 里写了"照抄原文"，但模型不一定听。它可能把两句话合成一句、
 * 把"我认为"改成"作者认为"、把长句缩成短句。
 * 这些改动单看都合理，但用户拿着报告回原文里找，就会找不到。
 *
 * 而且这层检查是纯代码的 —— 不花钱、不联网、结果永远一样。
 * 能用代码查的事就别让模型自查，模型自查的结果不可信。
 *
 * 为什么是"警告"而不是"错误"：
 * 偶尔改写一两句不算灾难，直接让整次分析失败太重了。
 * 但如果大面积对不上，说明模型在编，这个必须让用户看见。
 */
function checkAgainstOutline(claims: ExtractResult["claims"], outline: string): string[] {
  const haystack = normalize(outline);
  const missing: string[] = [];

  claims.forEach((claim, index) => {
    const needle = normalize(claim.text);
    if (needle !== "" && !haystack.includes(needle)) {
      missing.push(`第 ${index + 1} 条（${claim.id}）在提纲原文里找不到，模型可能改写了措辞`);
    }
  });

  if (missing.length === 0) return [];

  /**
   * 只漏一两条时逐条列出来，漏得多了就合并成一句。
   * 为什么：6 条里漏 5 条的时候，列 5 行只是把同一句话说五遍，
   * 反而看不清重点。
   */
  if (missing.length > claims.length / 2) {
    return [
      `一共 ${claims.length} 条主张里有 ${missing.length} 条在原文里找不到，这次抽取可能不可靠`,
    ];
  }
  return missing;
}

/* ---------------------------------------------------------------
   3. 主函数
   --------------------------------------------------------------- */

/**
 * 从提纲里抽主张。
 *
 * 返回值用 { ok, data | error } 而不是抛异常，理由和 parse.ts 里一样：
 * 抽取失败是"正常业务"（模型抽风、网络抖动都会导致），
 * 不是"程序 bug"，不该让调用方到处写 try/catch。
 */
export async function extractClaims(
  outline: string,
  callModel: ModelCaller,
): Promise<ExtractOutcome> {
  const text = outline.trim();

  if (text.length === 0) {
    return { ok: false, error: "提纲是空的，先贴点内容进来。" };
  }
  if (text.length < MIN_OUTLINE_LENGTH) {
    return {
      ok: false,
      error: `提纲只有 ${text.length} 字，太短了，抽不出完整的主张。至少写 ${MIN_OUTLINE_LENGTH} 字，把研究问题、方法、预期结果都写上。`,
    };
  }
  if (text.length > MAX_OUTLINE_LENGTH) {
    return {
      ok: false,
      error: `提纲有 ${text.length} 字，超过 ${MAX_OUTLINE_LENGTH} 字的上限。先删掉文献综述和参考文献部分，只留研究问题、方法、预期结果这三块。`,
    };
  }

  const { system, user } = buildExtractMessages(text);

  let raw: string;
  try {
    raw = await callModel(system, user);
  } catch (e) {
    /**
     * 网络断了、key 错了、余额不足，都会走到这里。
     * 这里只报"调用失败"，不猜具体原因 ——
     * 猜错了会让用户往错误的方向排查（比如明明欠费却去查网络）。
     * 真实原因在 5b 那个实现里会被读出来，放在 error.message 里。
     */
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `调用模型失败：${detail}` };
  }

  const parsed = parseWith(ExtractResultSchema, raw);
  if (!parsed.ok) {
    return { ok: false, error: `模型返回的内容不符合要求：\n${parsed.error}` };
  }

  return {
    ok: true,
    data: parsed.data,
    warnings: checkAgainstOutline(parsed.data.claims, text),
  };
}

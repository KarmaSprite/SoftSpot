/**
 * L2-B 质询生成：每条主张 → 1-2 个问题 + 及格线。
 *
 * 跟 extract.ts 一样，模型调用从外面传进来，所以没有 key 也能测。
 *
 * 这个文件最值得讲的一个决定：**一次只问一条主张，不是一次问全部。**
 *
 * 为什么不把 6 条主张一起丢给模型让它一次生成 8 个问题：
 *   1. 它会漏。给了 6 条主张、要求每条 1-2 个，它经常会漏掉中间某一条，
 *      或者给第一条生成 3 个、最后一条 0 个。而"某条主张没有被质询"
 *      恰恰是用户最需要知道的事 —— 漏了就等于没诊断。
 *   2. 它会串。一条主张的问题里提到另一条主张的内容，用户看着就乱了。
 *   3. claimId 会填错。让模型填，它就会填 c9，然后被 schema 拦下来，
 *      白白浪费一次调用。
 *
 * 一次一条的代价是调用次数从 1 次变 N 次。但换来的是：
 *   - 代码保证每条主张都被问到，一条不漏
 *   - claimId 由代码写，不可能错
 *   - 某一条失败只影响那一条，其余照常出结果
 *   - 单条失败可以单独重试，不用重跑整批
 *
 * 这个取舍是能讲清楚的：用一点调用成本，换"完整性"和"可解释性"。
 * 而且第 13 步会把串行改成并发，等待时间不会真的翻 N 倍。
 */

import { parseWith } from "./parse.ts";
import { buildQuestionMessages } from "./prompts.ts";
import { computeRisk } from "./risk.ts";
import { RawQuestionListSchema, type Claim, type Question } from "./schema.ts";
import type { ModelCaller } from "./extract.ts";

/* ---------------------------------------------------------------
   0. 类型
   --------------------------------------------------------------- */

export type QuestionOk = {
  ok: true;
  data: Question[];
  /** 个别主张失败时记在这里 —— 报告仍能出，但要让用户知道哪条没问到。 */
  warnings: string[];
};

export type QuestionBad = {
  ok: false;
  error: string;
};

export type QuestionOutcome = QuestionOk | QuestionBad;

/* ---------------------------------------------------------------
   1. 废话检测（纯代码）
   --------------------------------------------------------------- */

/**
 * 高频套话句式。
 *
 * 为什么要有这一层：
 * prompt 里已经列了反例，但模型不一定听 —— 这是实测最容易翻车的地方。
 * 这层检查不阻止结果，只是打警告，作用有两个：
 *   1. 让用户在 key 到了之后能一眼看出 prompt 到底生效没有
 *   2. 如果以后模型又开始说套话，这里会先响，不用等用户投诉
 *
 * 为什么不直接拒绝（返回错误）：
 * 这些句式偶尔也能问出好问题（比如「请说明你的研究方法」配上具体追问）。
 * 一刀切掉太狠，打警告让人自己判断更合适。
 */
export const BORING_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /请(详细)?(说明|介绍|阐述)(一下)?(你的|您的)?(研究)?(方法|思路|方案)/, label: "「请说明你的研究方法」" },
  { pattern: /(你的|您的)?创新点(是什么|在哪)/, label: "「你的创新点是什么」" },
  { pattern: /(谈谈|说说)(你对|对).{0,8}的?(理解|认识|看法)/, label: "「谈谈你对……的理解」" },
  { pattern: /理论意义|实践意义|研究价值/, label: "「理论意义/实践意义」" },
  { pattern: /有哪些(不足|局限性)/, label: "「有哪些不足」" },
];

/** 返回命中的套话标签，没命中返回空数组。 */
export function detectBoring(question: string): string[] {
  return BORING_PATTERNS.filter((p) => p.pattern.test(question)).map((p) => p.label);
}

/* ---------------------------------------------------------------
   2. 单条主张
   --------------------------------------------------------------- */

type OneResult =
  | { ok: true; questions: Question[]; warnings: string[] }
  | { ok: false; error: string };

/**
 * 处理一条主张：调模型 → 校验 → 补 id/claimId → 算 risk。
 *
 * id 的起点由外面传（nextId），因为多条主张之间要连续编号，
 * 单条函数自己数不出来。
 */
async function generateForClaim(
  claim: Claim,
  outline: string,
  callModel: ModelCaller,
  nextId: () => string,
  hasWarning: boolean,
): Promise<OneResult> {
  const { system, user } = buildQuestionMessages(claim, outline);

  let raw: string;
  try {
    raw = await callModel(system, user);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `调用模型失败：${detail}` };
  }

  const parsed = parseWith(RawQuestionListSchema, raw);
  if (!parsed.ok) {
    return { ok: false, error: `模型返回的内容不符合要求：${parsed.error}` };
  }

  const warnings: string[] = [];

  const questions: Question[] = parsed.data.questions.map((q) => {
    /**
     * 套话检测放在这里，而不是等全部生成完再统一查：
     * 这样警告能直接带上"是哪条主张的第几个问题"，用户才找得到。
     */
    const boring = detectBoring(q.question);
    if (boring.length > 0) {
      warnings.push(`针对「${shorten(claim.text)}」的问题里出现了套话 ${boring.join("、")}，可能没问到点子上`);
    }

    return {
      id: nextId(),
      claimId: claim.id,
      question: q.question,
      why: q.why,
      checklist: q.checklist,
      /**
       * 分数由代码算，模型只给档位。
       * 注意 defensibility 用的是这条主张自己的分数 ——
       * 本来就没底的主张，被问到更危险。
       */
      risk: computeRisk(q.level, { defensibility: claim.defensibility, hasWarning }).score,
    };
  });

  return { ok: true, questions, warnings };
}

/** 把长主张截短，用在警告文案里。 */
function shorten(text: string, max = 18): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/* ---------------------------------------------------------------
   3. 主函数
   --------------------------------------------------------------- */

export type GenerateOptions = {
  /** 哪些主张在原文核对时有警告。key 是 claim.id。 */
  warnedClaimIds?: Set<string>;
};

/**
 * 给每条主张生成质询问题。
 *
 * 失败策略：**单条失败不拖垮整体。**
 * 6 条主张里第 3 条模型返回脏了，不该让整个报告出不来 ——
 * 用户至少能看到另外 5 条的问题，再加一句"第 3 条没问到"。
 * 只有全部失败才返回错误，因为那时候确实没东西可给。
 */
export async function generateQuestions(
  claims: Claim[],
  outline: string,
  callModel: ModelCaller,
  options: GenerateOptions = {},
): Promise<QuestionOutcome> {
  if (claims.length === 0) {
    return { ok: false, error: "没有主张可以质询，先抽取主张。" };
  }

  const warned = options.warnedClaimIds ?? new Set<string>();

  /**
   * id 生成器用闭包而不是全局计数器：
   * 全局计数器会让两次调用之间接着编号（第一次 q1-q8，第二次从 q9 开始），
   * 界面上就会出现一份报告里没有 q1 的怪现象。
   */
  let counter = 0;
  const nextId = () => `q${++counter}`;

  const all: Question[] = [];
  const warnings: string[] = [];

  for (const claim of claims) {
    const result = await generateForClaim(
      claim,
      outline,
      callModel,
      nextId,
      warned.has(claim.id),
    );

    if (result.ok) {
      all.push(...result.questions);
      warnings.push(...result.warnings);
    } else {
      warnings.push(`针对「${shorten(claim.text)}」这条主张没问到问题：${result.error}`);
    }
  }

  if (all.length === 0) {
    return {
      ok: false,
      error: `全部 ${claims.length} 条主张都生成失败了。最后一条的报错：${warnings[warnings.length - 1] ?? "未知"}`,
    };
  }

  return { ok: true, data: all, warnings };
}

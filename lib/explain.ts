/**
 * 把一条主张的原始数据翻译成四段人话。纯函数，不调模型，不读环境变量。
 *
 * 为什么要有这个文件：
 * 主张表上每行只有两个数字（别人做过 / 答得上来）和一个象限标签。
 * 用户看到「别人做过 67、答得上来 52」之后一定会问三件事：
 *   这两个数是怎么算出来的？
 *   最像的那一篇到底是哪一篇？
 *   我该改什么？
 * 答不上来这三问，分数就是玄学；答得上来，用户才敢信、才知道往哪儿使劲。
 *
 * 为什么放在 lib 而不是写进组件：
 * 这是「把数据翻译成人话」的规则，跟 React 一点关系没有。
 * 放进组件就没法用 node 直接跑自检，只能靠人眼看 ——
 * 而人眼看不出「最弱维度挑错了」这种错。
 */

import { DIMENSION_ADVICE } from "./nearest.ts";
import { QUADRANT_META, QUADRANT_THRESHOLD, getClaimQuadrant } from "./quadrant.ts";
import type { Claim } from "./schema.ts";

/* ---------------------------------------------------------------
   1. 输入类型
   --------------------------------------------------------------- */

/** 一个证据维度。跟 lib/evidence.ts 的 DimensionHit 同形。 */
export type ExplainDimension = {
  name: string;
  score: number;
  hits: string[];
};

/**
 * 一条主张的证据明细，形状对齐 /api/analyze 响应里的 evidence[]。
 *
 * 客户端自己声明「我期待收到什么」，服务端多给字段也不会炸 ——
 * 反过来（从 route.ts import 类型）会把服务端模块拖进浏览器包。
 */
export type ExplainEvidence = {
  claimId: string;
  score: number;
  dimensions: ExplainDimension[];
};

/** 一篇检索回来的文献。字段名对齐 lib/overlap.ts 的 UnifiedHit。 */
export type ExplainHit = {
  /** 去重用的唯一键，界面不显示，但真响应里带着，类型上留个位 */
  key?: string;
  source: string;
  title: string;
  year: string;
  authors: string[];
  venue: string;
  url: string;
};

/** 一条主张的检索明细，形状对齐 /api/analyze 响应里的 search[]。 */
export type ExplainSearch = {
  claimId: string;
  score: number;
  reason: string;
  totalHits: number;
  /** 最像的那一篇。一条都没查回来时为 null */
  bestHit: ExplainHit | null;
  /** 跟最像那篇共有的词，展示用 */
  matched: string[];
};

/* ---------------------------------------------------------------
   2. 输出类型
   --------------------------------------------------------------- */

export type ClaimExplain = {
  /** 一句话把两个轴讲清楚 */
  headline: string;
  /** 四个维度里最弱的那一项，拿不到明细时为 null */
  weakest: { name: string; score: number; advice: string } | null;
  /** 四个维度的明细，按 lib/evidence.ts 的顺序 */
  dimensions: ExplainDimension[];
  /** 最像的那一篇，没有时为 null */
  reference: { title: string; meta: string; url: string } | null;
  /** 没有参考时，为什么没有 */
  referenceNote: string;
  /** 该改什么 */
  advice: string;
};

/* ---------------------------------------------------------------
   3. 把分数说成话
   --------------------------------------------------------------- */

/**
 * 分档词表。
 *
 * 为什么从高到低排、用「第一个够得着的」：
 * 这样分界线只有一处（每条的第一个数字），
 * 写成 if/else 链的话改一个阈值要动好几行，早晚漏一处。
 */
const OVERLAP_WORDS: Array<[number, string]> = [
  [70, "这个角度已经被做过很多次"],
  [50, "有人做过相近的"],
  [25, "只沾一点边"],
  [0, "基本没人做过"],
];

const DEFENSIBILITY_WORDS: Array<[number, string]> = [
  [70, "你答得上来"],
  [50, "勉强答得上"],
  [25, "答起来会吃力"],
  [0, "基本答不上来"],
];

function pickWord(score: number, table: Array<[number, string]>): string {
  for (const [min, word] of table) {
    if (score >= min) return word;
  }
  return table[table.length - 1][1];
}

/**
 * 作者名列表转一行字。
 *
 * 为什么三个人以上就截断：Crossref 有些记录挂十几个作者，
 * 全列出来会把「最像的那一篇」挤成三行，标题反而被埋了。
 */
export function formatAuthors(authors: string[]): string {
  const clean = authors.map((author) => author.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length <= 2) return clean.join("、");
  return `${clean.slice(0, 2).join("、")} 等`;
}

/** 来源的中文名。认不出来的原样显示，不猜。 */
const SOURCE_LABEL: Record<string, string> = {
  arxiv: "arXiv",
  crossref: "Crossref",
  web: "中文网页",
  manual: "你自己粘的",
};

function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

/**
 * 命中词的展示格式。
 *
 * 为什么需要这个函数：lib/evidence.ts 借提纲的分时，会把供体的命中词
 * 一个个加上「提纲里有：」前缀塞进 hits，于是数组变成
 *   ["提纲里有：两个", "提纲里有：128名", "提纲里有：64人", ...]
 * 直接 join("、") 出来就是「提纲里有：两个、提纲里有：128名、提纲里有：64人…」，
 * 每项都重复一遍前缀，读起来像坏了。
 *
 * 所以把两类词分开：这句主张自己写的词照原样列，从提纲借来的词
 * 合成一个括注「（提纲里有：两个、128名、64人）」。这样一眼能看出
 * 哪些是这条主张自己说的、哪些是从别处借的 —— 那正是用户要判断的事。
 */
export function formatHits(hits: string[]): string {
  const own: string[] = [];
  const borrowed: string[] = [];

  for (const hit of hits) {
    if (hit.startsWith("提纲里有：")) {
      borrowed.push(hit.slice("提纲里有：".length));
    } else {
      own.push(hit);
    }
  }

  const parts: string[] = [];
  if (own.length > 0) parts.push(own.join("、"));
  if (borrowed.length > 0) parts.push(`（提纲里有：${borrowed.join("、")}）`);

  return parts.length > 0 ? parts.join(" ") : "一个都没找到";
}

/* ---------------------------------------------------------------
   4. 四段话
   --------------------------------------------------------------- */

/**
 * 挑最弱的那个维度。
 *
 * 为什么同分时保留第一个：lib/evidence.ts 里四个维度的顺序是
 * 数字 / 方法 / 出处 / 具体，同分时先报「有没有数字」——
 * 那是最好补的一项（补个样本量就行），先给最容易动手的。
 */
function pickWeakest(
  dimensions: ExplainDimension[],
): { name: string; score: number; advice: string } | null {
  if (dimensions.length === 0) return null;

  let weakest = dimensions[0];
  for (const dimension of dimensions) {
    if (dimension.score < weakest.score) weakest = dimension;
  }

  return {
    name: weakest.name,
    score: weakest.score,
    advice: DIMENSION_ADVICE[weakest.name] ?? "把这一项补具体。",
  };
}

/**
 * 该改什么。
 *
 * 三分支跟 lib/nearest.ts 的 buildAdvice 是同一套判断，
 * 但说法不同：那边是「离主场差多少」，这边是「这一条本身怎么办」。
 * 不合并成一个函数，是因为两者要输出的信息不一样 ——
 * 硬合并会让两边都长出用不上的参数。
 */
function buildAdvice(claim: Claim, weakest: ClaimExplain["weakest"]): string {
  const overlapHigh = claim.overlap >= QUADRANT_THRESHOLD;
  const defensibilityLow = claim.defensibility < QUADRANT_THRESHOLD;

  if (overlapHigh && defensibilityLow) {
    const part = weakest
      ? `先把「${weakest.name}」补上（${weakest.advice}）`
      : "先把证据补上";
    return `两头都要动：${part}，再把选题角度收窄一点。`;
  }

  if (overlapHigh) {
    return "别人做过的部分已经够多了。这一条不用再补证据，该做的是收窄角度，或者写清你和那篇的差别。";
  }

  if (defensibilityLow) {
    return weakest
      ? `卡在「${weakest.name}」：${weakest.advice}`
      : "补证据：样本量、研究方法、依据来源，三样里挑最缺的补。";
  }

  return "这条两个轴都过了。留着 —— 改别的条目时注意别把它改坏。";
}

/**
 * 最像的那一篇。
 *
 * 四种情况必须分开说，不能都归结成「没查到」：
 *   ① 报告里根本没有检索明细（离线示例的旧冻结数据）
 *   ② 一条都没查回来（可能真的是没人做过，也可能词没对上）
 *   ③ 查回来几篇，但没有一篇和这条主张有共同词
 *   ④ 有最像的那一篇
 * 前三种如果都写成「没人做过」，就是把「不知道」伪装成结论。
 */
function buildReference(search: ExplainSearch | undefined): {
  reference: ClaimExplain["reference"];
  referenceNote: string;
} {
  if (!search) {
    return {
      reference: null,
      referenceNote:
        "这份报告是存好的示例，当时没有把检索明细一起存下来，所以看不到最像的那一篇。真跑一次就会有。",
    };
  }

  if (!search.bestHit) {
    if (search.totalHits === 0) {
      return {
        reference: null,
        referenceNote:
          "这次一条都没查回来。这不等于没人做过 —— 只说明这几个库里没匹配到，换个说法再查一次可能就有了。",
      };
    }
    return {
      reference: null,
      referenceNote: `查回来 ${search.totalHits} 篇，但没有一篇和这条主张有共同词。`,
    };
  }

  const hit = search.bestHit;
  const parts = [
    formatAuthors(hit.authors),
    hit.venue,
    hit.year,
    sourceLabel(hit.source),
  ].filter((part) => part.trim().length > 0);

  return {
    reference: {
      title: hit.title,
      meta: parts.join(" · "),
      url: hit.url,
    },
    referenceNote: search.matched.length > 0
      ? `共有的词：${search.matched.join("、")}`
      : search.reason,
  };
}

/* ---------------------------------------------------------------
   5. 对外那一个函数
   --------------------------------------------------------------- */

export function explainClaim(
  claim: Claim,
  evidence: ExplainEvidence | undefined,
  search: ExplainSearch | undefined,
): ClaimExplain {
  const dimensions = evidence?.dimensions ?? [];
  const weakest = pickWeakest(dimensions);
  const quadrant = getClaimQuadrant(claim);

  const headline =
    `别人做过 ${claim.overlap} 分 —— ${pickWord(claim.overlap, OVERLAP_WORDS)}；` +
    `答得上来 ${claim.defensibility} 分 —— ${pickWord(claim.defensibility, DEFENSIBILITY_WORDS)}。` +
    `落在「${QUADRANT_META[quadrant].label}」这一角。`;

  const { reference, referenceNote } = buildReference(search);

  return {
    headline,
    weakest,
    dimensions,
    reference,
    referenceNote,
    advice: buildAdvice(claim, weakest),
  };
}

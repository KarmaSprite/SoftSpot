/**
 * 纵轴分数：这条主张，你答得上来吗。
 *
 * ## 为什么不用"问题危险度"直接当纵轴
 *
 * 第一版纵轴是 `100 - 最危险的那个问题`。真跑两份提纲发现：
 * 七条主张的稳度全是 19，八个点压在同一条水平线上，四象限图退化成只有横轴在动。
 *
 * 试过两轮补救都没用：
 *   第一轮改公式（最大值占 65%、平均占 35%、把压力区间拉伸到整条轴）—— 还是全 24
 *   第二轮把三档改成五档，逼模型做更细的判断 —— 还是全 19，只多出一个 41
 *
 * 查了模型实际给的问题，问题质量很高，但 14 个问题里 9 个都是「致命」档：
 * 「你说普遍存在，数据呢」「你怎么排除班级差异」「评委知不知道谁是干预班」——
 * 这些问题对任何一条主张都成立，它们本来就该是致命的。
 *
 * 也就是说：**质询引擎的危险度天然没有区分度，这是它的本职，不是它的 bug。**
 * 拿它当纵轴，等于用一把只会说"很危险"的尺子去量深浅。
 *
 * ## 现在的纵轴问的是另一个问题
 *
 * 不问"这条多危险"，问"**你的提纲自己撑不撑得住这条主张**"。
 *
 * 比较这两句：
 *   「学生普遍存在话术背得熟、临场接不住的问题」
 *     没有样本、没有数据、没有出处 —— 凭什么说普遍？
 *   「两班 96 人三轮，每轮 6 周，用自编临场应答质量量表四维度 5 级评分，前后测对比」
 *     有样本量、有周期、有工具、有设计 —— 答辩老师能顺着这句话往下问
 *
 * 这两条主张的"答得上来"本来就不该是同一个分。现在它们都是 19。
 *
 * ## 为什么这是纯代码算的
 *
 * 四个维度全是数关键词和数字，不调模型：
 *   同一份提纲跑两次，分数完全一样
 *   答辩被问"这个 37 分怎么来的"，能指着这个文件把四个维度念出来
 *
 * 这跟"四象限用代码算"是同一条原则：能让代码算的，就别让模型算。
 */

import type { Claim } from "./schema.ts";

/* ---------------------------------------------------------------
   1. 四个维度
   --------------------------------------------------------------- */

/**
 * 每个维度的权重，加起来正好 100。
 *
 * 权重怎么定的：
 *   `number`（有数字）最高 —— 开题答辩最常被追的就是"样本多少、做了多久"，
 *     而且数字是唯一没法含糊过去的东西，有就是有。
 *   `method`（有方法）次之 —— "行动研究""前后测""量表"这些词说明作者知道
 *     自己在做什么设计，不是只有一句愿望。
 *   `source`（有来源）第三 —— "调查""数据""文献"说明这句话背后有东西撑着，
 *     但比前两个虚，容易被套话蒙过去。
 *   `specific`（说得具体）最低 —— 它只能说明这句话不像空话，
 *     不能说明它有证据。
 */
const WEIGHT_NUMBER = 30;
const WEIGHT_METHOD = 30;
const WEIGHT_SOURCE = 25;
const WEIGHT_SPECIFIC = 15;

/**
 * 数字证据：带单位的数字才算。
 *
 * 为什么不认所有数字：`2024 年`「第 3 轮」里的数字是时间标记，不是样本量。
 * 只有"96 人""6 周""5 级""25%"这种才是能拿去答辩的量。
 * 单位表列在这里，改的时候一处改全处生效。
 */
const NUMBER_PATTERN =
  /(\d+(?:\.\d+)?|[一二两三四五六七八九十百千]+)\s*(人|名|位|个|班|组|周|月|天|课时|学期|次|轮|篇|份|条|级|分|%|％|百分点|倍)/g;

/**
 * 方法设计词。
 *
 * 分两档：强方法词（直接说明研究设计）拿满分，
 * 弱方法词（只是沾边）拿一半。
 *
 * 为什么分档：`量表` 和 `分析` 不是一个量级的东西 ——
 * 前者说明作者准备了测量工具，后者可能只是顺口一说。
 */
const STRONG_METHOD_WORDS = [
  "行动研究",
  "前后测",
  "前测",
  "后测",
  "对照班",
  "对照组",
  "控制组",
  "实验组",
  "准实验",
  "随机分组",
  "量表",
  "问卷",
  "半结构化访谈",
  "结构化访谈",
  "课堂观察表",
  "编码表",
  "信效度",
  "评分者一致性",
  "双盲",
  "盲评",
  "抽样",
  "三角验证",
];

const WEAK_METHOD_WORDS = [
  "访谈",
  "观察",
  "问卷",
  "测试",
  "统计",
  "分析",
  "编码",
  "测评",
  "评估",
  "对比",
  "实验",
  "调查",
];

/**
 * 证据来源词：这句话背后有没有东西撑着。
 *
 * 注意 `文献` 单独列：写"文献综述表明"也算有来源，
 * 虽然它是二手证据，但比"我认为"强。
 */
const SOURCE_WORDS = [
  "数据",
  "调查",
  "统计",
  "文献",
  "样本",
  "实测",
  "记录",
  "访谈记录",
  "观察记录",
  "测评结果",
  "问卷结果",
  "平台后台",
  "企业反馈",
  "学情",
];

/**
 * 具体程度：这句话是不是在说一件能落地的事。
 *
 * 判定方式两条取其一：
 *   1. 句子够长（30 字以上）—— 空话通常很短，因为没什么可说的
 *   2. 出现了具体载体（课程名、工具名、平台、专业）—— 说明不是泛泛而谈
 *
 * 为什么不按字数线性给分：字数多不等于有内容，
 * 一段绕圈子的空话也能写很长。所以只当加分项，不当主项。
 */
const CONCRETE_WORDS = [
  "课程",
  "专业",
  "班级",
  "学期",
  "课时",
  "平台",
  "系统",
  "工具",
  "模型",
  "语料库",
  "案例库",
  "实训",
  "岗位",
  "企业",
  "直播",
  "短视频",
  "论文",
];

const LONG_TEXT = 30;

/* ---------------------------------------------------------------
   2. 单个维度的打分
   --------------------------------------------------------------- */

export type DimensionHit = {
  /** 维度名，直接显示在界面上。 */
  name: string;
  /** 这个维度拿到的分（0-100）。 */
  score: number;
  /** 命中了哪些词/数字，用来解释为什么给这个分。 */
  hits: string[];
};

export type EvidenceResult = {
  /** 四个维度加权之后的证据分（0-100）。 */
  score: number;
  dimensions: DimensionHit[];
  /** 一句话总结，给用户看。 */
  reason: string;
};

/**
 * 从文本里找出所有命中的词，去重后返回。
 *
 * **为什么要处理"词套词"**：来源表里同时有「观察记录」和「记录」，
 * 一句「根据课堂观察记录」会同时命中两个，被算成"有两个来源"——
 * 其实只说了同一件事。不拦的话，词表越长，虚分越多。
 *
 * 处理方式：命中的词按长度从长到短排，如果某个词是已收录词的一部分，就跳过。
 * 这样「观察记录」收进来之后，「记录」就不会再被算一次。
 */
function findWords(text: string, words: string[]): string[] {
  const matched = words.filter((word) => text.includes(word));

  // 长的优先，短词如果被长词包含就丢掉
  matched.sort((a, b) => b.length - a.length);

  const kept: string[] = [];
  for (const word of matched) {
    const covered = kept.some((longer) => longer.includes(word));
    if (!covered) kept.push(word);
  }

  return kept;
}

/**
 * 数字维度：命中一个给 40 分，两个 70，三个及以上 100。
 *
 * 为什么一个就给 40：一个数字说明作者至少量过一样东西，
 * 但一个数字撑不起一条主张（"96 人"没有周期和工具还是不够）。
 * 三个数字通常意味着样本、时长、指标都交代了。
 */
function scoreNumbers(text: string): DimensionHit {
  const hits: string[] = [];
  NUMBER_PATTERN.lastIndex = 0;
  let match = NUMBER_PATTERN.exec(text);
  while (match !== null) {
    const full = `${match[1]}${match[2]}`;
    if (!hits.includes(full)) hits.push(full);
    match = NUMBER_PATTERN.exec(text);
  }

  let score = 0;
  if (hits.length === 1) score = 40;
  else if (hits.length === 2) score = 70;
  else if (hits.length >= 3) score = 100;

  return { name: "有没有数字", score, hits };
}

/**
 * 方法维度：强方法词一个给 60，两个及以上 100；只有弱方法词给 30。
 *
 * 为什么强方法词一个就 60：`行动研究` `前后测` `量表` 这类词不是随口说的，
 * 写进开题说明作者真的打算这么做。
 */
function scoreMethod(text: string): DimensionHit {
  const strong = findWords(text, STRONG_METHOD_WORDS);
  const weak = findWords(text, WEAK_METHOD_WORDS);
  const hits = [...strong, ...weak];

  let score = 0;
  if (strong.length >= 2) score = 100;
  else if (strong.length === 1) score = 60;
  else if (weak.length >= 2) score = 45;
  else if (weak.length === 1) score = 30;

  return { name: "有没有方法", score, hits };
}

/** 来源维度：命中一个 50，两个及以上 100。 */
function scoreSource(text: string): DimensionHit {
  const hits = findWords(text, SOURCE_WORDS);
  let score = 0;
  if (hits.length >= 2) score = 100;
  else if (hits.length === 1) score = 50;
  return { name: "有没有出处", score, hits };
}

/** 具体程度：句子够长给 40，有具体载体给 70，两者都有给 100。 */
function scoreSpecific(text: string): DimensionHit {
  const hits = findWords(text, CONCRETE_WORDS);
  const isLong = text.length >= LONG_TEXT;

  let score = 0;
  if (isLong && hits.length > 0) score = 100;
  else if (hits.length > 0) score = 70;
  else if (isLong) score = 40;

  if (isLong && !hits.includes("（句子够长）")) hits.push("（句子够长）");

  return { name: "说得具体吗", score, hits };
}

/* ---------------------------------------------------------------
   3. 主函数
   --------------------------------------------------------------- */

/**
 * 算一条主张的"证据分"。
 *
 * 输入只有主张原文 —— 不看模型、不看检索结果。
 * 这是刻意的：证据分要能独立复算，用户拿同一句话自己数一遍也该得到同一个分。
 */
export function evidenceOf(claim: Claim): EvidenceResult {
  const text = claim.text ?? "";

  const dimensions = [
    scoreNumbers(text),
    scoreMethod(text),
    scoreSource(text),
    scoreSpecific(text),
  ];

  const weights = [WEIGHT_NUMBER, WEIGHT_METHOD, WEIGHT_SOURCE, WEIGHT_SPECIFIC];
  const total = dimensions.reduce(
    (sum, dimension, index) => sum + dimension.score * weights[index],
    0,
  );
  const score = Math.round(total / 100);

  const empty = dimensions.filter((dimension) => dimension.score === 0);
  let reason: string;
  if (score >= 70) {
    reason = "这条主张自带样本、方法和出处，答辩时能顺着它往下问。";
  } else if (score >= 40) {
    reason = `这条主张交代了一部分依据，还缺${empty.map((d) => d.name).join("、") || "细节"}。`;
  } else {
    reason = `这条主张只有结论，没有依据 —— ${empty.map((d) => d.name).join("、") || "各方面"}都没交代。`;
  }

  return { score, dimensions, reason };
}

/* ---------------------------------------------------------------
   4. 及格线校准
   --------------------------------------------------------------- */

/**
 * 把四个维度的加权原始分，映射成真正的纵轴分。
 *
 * ## 为什么需要这一步
 *
 * 四个维度各是 0 / 40 / 70 / 100 这种档，加权平均出来天然偏低：
 * 一条交代了样本和方法的主张，原始分只有 48 左右；而四个维度全占才可能到 100。
 * 但 L1 抽出来的主张是**从提纲里切出来的短句**（20-30 字），
 * 「出处」这类维度在短句里几乎不可能出现 —— 指望它满分是不现实的。
 *
 * 实测七条真实主张的原始分是 `[0, 0, 48, 41, 51, 23, 45]`，
 * 直接当纵轴用，七个点全部落在 50 分线以下，「你的主场」永远是空的。
 * 那不是用户写得差，是刻度不合适。
 *
 * ## 校准的依据
 *
 * 开题阶段，一条主张能同时交代「样本多大」和「用什么方法」，
 * 就已经超过及格线了 —— 答辩老师会接着问，但不会让他换题。
 * 所以把「两个维度到位」定在 55-65 分，而不是让它停在 48。
 *
 * 锚点（原始分 → 纵轴分），中间线性插值：
 *   0 → 0     一维度都没有，就是空话
 *  20 → 20    只沾了一个维度的边
 *  40 → 52    两个维度到位，刚过及格线
 *  60 → 72    三个维度到位，比较稳
 *  80 → 88    很扎实
 * 100 → 100   四个维度全满（实际提纲里基本见不到）
 *
 * 只动刻度，不动排序：原始分高的校准后一定还高，不会有主张因为校准而互相换位。
 */
const CALIBRATION: Array<[number, number]> = [
  [0, 0],
  [20, 20],
  [40, 52],
  [60, 72],
  [80, 88],
  [100, 100],
];

export function calibrateEvidence(raw: number): number {
  const clamped = Math.min(100, Math.max(0, raw));

  for (let i = 1; i < CALIBRATION.length; i += 1) {
    const [x1, y1] = CALIBRATION[i - 1];
    const [x2, y2] = CALIBRATION[i];
    if (clamped <= x2) {
      const ratio = (clamped - x1) / (x2 - x1);
      return Math.round(y1 + ratio * (y2 - y1));
    }
  }

  return 100;
}

/* ---------------------------------------------------------------
   5. 和问题压力合成纵轴
   --------------------------------------------------------------- */

/**
 * 纵轴 = 校准后的证据分 + 问题压力的修正（最多 ±15 分）。
 *
 * ## 为什么不是加权平均
 *
 * 第一版写的是 `证据分 × 0.6 + 压力分 × 0.4`，跑出来七个点是 8 / 8 / 36 / 32 / 38 / 21 / 35 ——
 * **全部落在 50 分线以下**，四个象限只有下两个有东西，「你的主场」永远是空的。
 *
 * 原因是这两个量**负相关**：一条主张证据越少，问题就越危险、压力分也越低。
 * 加权相加等于对同一件事惩罚两次，结果被双重压到底部。
 *
 * ## 现在的做法
 *
 * 证据分是主刻度 —— 它才真正在区分"这条主张站不站得住"。
 * 问题压力只在上下 15 分范围内微调：
 *   压力 19（很危险）→ 减 9 分
 *   压力 50（中等）  → 不动
 *   压力 81（很稳）  → 加 9 分
 *
 * 为什么压力还要留一点影响：
 *   一条主张可以证据很足但方向本身有硬伤（设计做得规范，研究问题却不成立）。
 *   完全不看问题清单，纵轴会变成"格式分"——写得越长分越高，那就退化成鼓励灌水了。
 *
 * 为什么中心取 50：50 是"中等危险"，语义上正好是"不修正"的位置。
 * 不取实测中位数，因为那会让纵轴随样本漂移，同一份提纲跑两次可能不一样。
 */
export const PRESSURE_CENTER = 50;
export const PRESSURE_INFLUENCE = 0.3;

export function blendDefensibility(evidenceScore: number, pressureScore: number): number {
  const adjustment = (pressureScore - PRESSURE_CENTER) * PRESSURE_INFLUENCE;
  const blended = calibrateEvidence(evidenceScore) + adjustment;
  return Math.min(100, Math.max(0, Math.round(blended)));
}

/**
 * 证据分的自检脚本。
 *
 * 全程不联网、不花钱：证据分只看主张原文，纯代码算。
 *
 * 跑法：node scripts/check-evidence.mjs
 *
 * 这个脚本存在的理由：
 * 纵轴分数在改这个文件之前，八条主张全是同一个数，四象限图是一条水平线。
 * 所以这里最重要的不是"单个函数算得对"，而是
 * **真实提纲里不同性质的主张必须算出不同的分** —— 第 [7] 组专门锁这个。
 */

import {
  evidenceOf,
  blendDefensibility,
  calibrateEvidence,
  PRESSURE_CENTER,
  PRESSURE_INFLUENCE,
} from "../lib/evidence.ts";

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}${detail ? `  → ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  → ${detail}` : ""}`);
  }
}

/** 造一条主张，只关心 text。 */
function claim(text, type = "method") {
  return { id: "c1", text, type, location: "测试" };
}

/** 取某个维度的分。 */
function dim(result, name) {
  const found = result.dimensions.find((d) => d.name === name);
  return found ? found.score : -1;
}

/* ---------------------------------------------------------------
   [1] 数字维度
   --------------------------------------------------------------- */

console.log("\n[1] 有没有数字：带单位的才算");
{
  const none = evidenceOf(claim("学生临场应答能力不足"));
  check("一个数字都没有 → 0 分", dim(none, "有没有数字") === 0, String(dim(none, "有没有数字")));

  const one = evidenceOf(claim("一共 96 人"));
  check("一个带单位的数字 → 40 分", dim(one, "有没有数字") === 40, String(dim(one, "有没有数字")));

  const two = evidenceOf(claim("两班 96 人"));
  check("两个带单位的数字 → 70 分", dim(two, "有没有数字") === 70, String(dim(two, "有没有数字")));

  const three = evidenceOf(claim("两班 96 人三轮，每轮 6 周"));
  check("三个以上带单位的数字 → 100 分", dim(three, "有没有数字") === 100, String(dim(three, "有没有数字")));

  /*
     中文数字也算：「两班」的「两」是真数量，不是语气词。
     但「两个班一共 96 人」里「两个」和「96 人」是两件事，所以算两个数字。
  */
  const twoClass = evidenceOf(claim("两个班一共 96 人"));
  check("「两个班」和「96 人」算两个数字", dim(twoClass, "有没有数字") === 70, String(dim(twoClass, "有没有数字")));

  /*
     关键的一条：光有年份不算有数字。
     「2024 年」是时间标记，不是样本量，答辩老师不会因为它觉得你有依据。
  */
  const yearOnly = evidenceOf(claim("2024 年开始做这个研究"));
  check("只有年份不算有数字", dim(yearOnly, "有没有数字") === 0, String(dim(yearOnly, "有没有数字")));

  const percent = evidenceOf(claim("评分平均提升 25%"));
  check("百分比算数字", dim(percent, "有没有数字") === 40, String(dim(percent, "有没有数字")));

  const chinese = evidenceOf(claim("挑选三个班级"));
  check("中文数字也认", dim(chinese, "有没有数字") === 40, String(dim(chinese, "有没有数字")));

  /*
     序数不是样本量：「第一轮」「第 3 次」讲的是顺序，一个人都没有。
     这条 bug 是这么来的 —— 有人的提纲写「第一轮录播、第二轮弹幕、
     第三轮跟播」，三轮不同的干预被数成三处样本量，数字维度直接满分。
  */
  const ordinal = evidenceOf(claim("第一轮录播回放，第二轮弹幕模拟，第三轮企业真实直播间跟播"));
  check("「第一轮/第二轮/第三轮」不算数字", dim(ordinal, "有没有数字") === 0, String(dim(ordinal, "有没有数字")));

  const ordinalNum = evidenceOf(claim("第 3 次访谈之后开始调整"));
  check("「第 3 次」不算数字", dim(ordinalNum, "有没有数字") === 0, String(dim(ordinalNum, "有没有数字")));

  const ordinalWeek = evidenceOf(claim("第 2 周开始干预，共 6 周"));
  check("「第 2 周」不算，后面「6 周」照算 → 40 分", dim(ordinalWeek, "有没有数字") === 40, String(dim(ordinalWeek, "有没有数字")));

  const ordinalFirst = evidenceOf(claim("第一名的成绩提升了"));
  check("「第一名」不算数字", dim(ordinalFirst, "有没有数字") === 0, String(dim(ordinalFirst, "有没有数字")));

  /*
     反向断言：治「第」不能误伤「轮」。
     「三轮干预」「每轮 6 周」是真样本量和真时长，必须照旧算。
  */
  const realRounds = evidenceOf(claim("两班 96 人三轮干预，每轮 6 周"));
  check("「三轮干预」「每轮 6 周」照旧算数字", dim(realRounds, "有没有数字") === 100, String(dim(realRounds, "有没有数字")));
}

/* ---------------------------------------------------------------
   [2] 方法维度
   --------------------------------------------------------------- */

console.log("\n[2] 有没有方法：强方法词和弱方法词分开算");
{
  const none = evidenceOf(claim("学生临场应答能力不足"));
  check("没有方法词 → 0 分", dim(none, "有没有方法") === 0, String(dim(none, "有没有方法")));

  const strong1 = evidenceOf(claim("采用行动研究法"));
  check("一个强方法词 → 60 分", dim(strong1, "有没有方法") === 60, String(dim(strong1, "有没有方法")));

  const strong2 = evidenceOf(claim("采用行动研究，做前后测对比"));
  check("两个强方法词 → 100 分", dim(strong2, "有没有方法") === 100, String(dim(strong2, "有没有方法")));

  const weak1 = evidenceOf(claim("会做一些访谈"));
  check("一个弱方法词 → 30 分", dim(weak1, "有没有方法") === 30, String(dim(weak1, "有没有方法")));

  const weak2 = evidenceOf(claim("通过访谈和观察来收集"));
  check("两个弱方法词 → 45 分", dim(weak2, "有没有方法") === 45, String(dim(weak2, "有没有方法")));

  /*
     强弱必须真的分开：同样是一个方法词，
     「量表」和「分析」不该拿同一个分。
  */
  const scale = evidenceOf(claim("用自编量表测"));
  const analyze = evidenceOf(claim("用统计方法分析"));
  check(
    "强方法词比弱方法词分高",
    dim(scale, "有没有方法") > dim(analyze, "有没有方法"),
    `${dim(scale, "有没有方法")} > ${dim(analyze, "有没有方法")}`,
  );
}

/* ---------------------------------------------------------------
   [3] 来源维度
   --------------------------------------------------------------- */

console.log("\n[3] 有没有出处");
{
  const none = evidenceOf(claim("学生临场应答能力不足"));
  check("没有来源词 → 0 分", dim(none, "有没有出处") === 0, String(dim(none, "有没有出处")));

  const one = evidenceOf(claim("根据课堂观察记录"));
  check("一个来源词 → 50 分", dim(one, "有没有出处") === 50, String(dim(one, "有没有出处")));

  const two = evidenceOf(claim("根据课堂观察记录和问卷结果"));
  check("两个来源词 → 100 分", dim(two, "有没有出处") === 100, String(dim(two, "有没有出处")));

  const data = evidenceOf(claim("平台后台数据显示"));
  check("「数据」算来源", dim(data, "有没有出处") > 0, String(dim(data, "有没有出处")));
}

/* ---------------------------------------------------------------
   [4] 具体程度
   --------------------------------------------------------------- */

console.log("\n[4] 说得具体吗");
{
  const none = evidenceOf(claim("能力不足"));
  check("又短又空 → 0 分", dim(none, "说得具体吗") === 0, String(dim(none, "说得具体吗")));

  const short = evidenceOf(claim("针对直播课程做改进"));
  check("短但有具体载体 → 70 分", dim(short, "说得具体吗") === 70, String(dim(short, "说得具体吗")));

  const longNoCarrier = evidenceOf(
    claim("这个研究主要是想解决一个大家一直以来都比较关心但是又一直没有被很好地解决的问题"),
  );
  check("长但没有具体载体 → 40 分", dim(longNoCarrier, "说得具体吗") === 40, String(dim(longNoCarrier, "说得具体吗")));

  const both = evidenceOf(
    claim("针对高职数字媒体专业的直播课程，用真实弹幕语料做临场应答训练，形成可复用的语料库"),
  );
  check("又长又有载体 → 100 分", dim(both, "说得具体吗") === 100, String(dim(both, "说得具体吗")));
}

/* ---------------------------------------------------------------
   [5] 合成
   --------------------------------------------------------------- */

console.log("\n[5] 四个维度合成总分");
{
  const empty = evidenceOf(claim("能力不足"));
  check("四个维度全空 → 0 分", empty.score === 0, String(empty.score));
  check("全空时理由是「只有结论」", empty.reason.includes("只有结论"), empty.reason);

  const rich = evidenceOf(
    claim("两班 96 人三轮，每轮 6 周，采用行动研究和前后测设计，用自编量表评分，结合课堂观察记录和问卷结果，建成直播语料库"),
  );
  check("四个维度全满 → 100 分", rich.score === 100, String(rich.score));
  check("全满时理由是「自带样本」", rich.reason.includes("自带样本"), rich.reason);

  /*
     少一个维度就要扣分，扣的幅度等于那个维度的权重。
     上面那条 rich 去掉「直播语料库」（具体程度从 100 掉到 40），
     应该正好少 15×0.6 = 9 分。
  */
  const withoutCarrier = evidenceOf(
    claim("两班 96 人三轮，每轮 6 周，采用行动研究和前后测设计，用自编量表评分，结合课堂观察记录和问卷结果"),
  );
  check(
    "少一个具体载体扣 9 分",
    rich.score - withoutCarrier.score === 9,
    `${rich.score} - ${withoutCarrier.score}`,
  );

  /*
     权重对不对：四个维度各给一个固定分，手算总分。
     数字 100×0.30 + 方法 100×0.30 + 来源 0×0.25 + 具体 0×0.15 = 60
  */
  const weighted = evidenceOf(claim("两班 96 人三轮，采用行动研究和前后测设计"));
  const expected = Math.round(
    (dim(weighted, "有没有数字") * 30 +
      dim(weighted, "有没有方法") * 30 +
      dim(weighted, "有没有出处") * 25 +
      dim(weighted, "说得具体吗") * 15) /
      100,
  );
  check("总分等于四个维度按权重加权", weighted.score === expected, `${weighted.score} = ${expected}`);

  check("每个维度都有名字", weighted.dimensions.length === 4 && weighted.dimensions.every((d) => d.name.length > 0));
}

/* ---------------------------------------------------------------
   [6] 和问题压力合成纵轴
   --------------------------------------------------------------- */

console.log("\n[6] 证据分打底 + 问题压力微调（最多 ±15 分）");
{
  check("压力的影响系数小于一半", PRESSURE_INFLUENCE < 0.5, String(PRESSURE_INFLUENCE));
  check("压力的中心是 50（不修正的位置）", PRESSURE_CENTER === 50, String(PRESSURE_CENTER));

  // 100 + (100-50)×0.3 = 115 → 夹到 100
  check("双满分 → 100", blendDefensibility(100, 100) === 100, String(blendDefensibility(100, 100)));

  // 0 + (0-50)×0.3 = -15 → 夹到 0
  check("双零 → 0", blendDefensibility(0, 0) === 0, String(blendDefensibility(0, 0)));

  // 100 + (0-50)×0.3 = 85
  check("证据满分压力零分 → 85", blendDefensibility(100, 0) === 85, String(blendDefensibility(100, 0)));

  // 0 + (100-50)×0.3 = 15
  check("证据零分压力满分 → 15", blendDefensibility(0, 100) === 15, String(blendDefensibility(0, 100)));

  // 校准后：压力正好在中点 → 一点都不改，纵轴就是校准后的证据分
  check("压力 50 时纵轴就等于校准后的证据分", blendDefensibility(64, 50) === calibrateEvidence(64), String(blendDefensibility(64, 50)));

  // 压力从 0 到 100，各往中心外侧走 50 分，乘 0.3 就是各 15 分，一头一尾差 30 分
  check("压力从最低到最高，纵轴最多差 30 分", blendDefensibility(60, 100) - blendDefensibility(60, 0) === 30);

  check("超出范围会被夹住", blendDefensibility(200, 50) === 100, String(blendDefensibility(200, 50)));

  /*
     这一条是这套公式存在的理由：
     证据分 60 的主张，即使被问到最危险（压力 19），也应该稳稳落在 50 分线以上 ——
     第一版加权平均在这里算出来是 44，直接掉到下半屏，"你的主场"永远空着。
  */
  check(
    "证据 60 分的主张，压力压到 19 也还在 50 分线上",
    blendDefensibility(60, 19) >= 50,
    String(blendDefensibility(60, 19)),
  );
}

/* ---------------------------------------------------------------
   [7] 最关键：真实提纲里的主张必须算出不同的分
   --------------------------------------------------------------- */

console.log("\n[7] 真实提纲：不同性质的主张必须算出不同的分");
{
  /*
     这七条是真实跑出来的主张（320 字直播带货提纲）。
     改之前它们的纵轴全是 19 —— 这条断言就是为了防止再退回去。
  */
  const realClaims = [
    claim("学生普遍存在话术背得熟、临场接不住的问题", "problem"),
    claim("如何用真实弹幕语料训练学生的临场应答能力", "problem"),
    claim("采用行动研究法，两班 96 人，三轮干预，每轮 6 周", "method"),
    claim("第一轮录播回放，第二轮弹幕模拟，第三轮企业真实直播间跟播", "method"),
    claim("采用前后测设计，用自编临场应答质量量表，四个维度五级评分", "method"),
    claim("形成一套可复用的弹幕语料库，并发表一篇教学研究论文", "expectation"),
    claim("学生应答质量评分平均提升 25%，实训转化率提升 10 个百分点", "expectation"),
  ];

  const evidenceScores = realClaims.map((c) => evidenceOf(c).score);
  const distinct = new Set(evidenceScores).size;

  check(
    "七条真实主张，证据分至少 4 种不同的值",
    distinct >= 4,
    `${JSON.stringify(evidenceScores)}，${distinct} 种`,
  );

  /*
     最该分开的一对：
     「学生普遍存在…」只有结论，没有任何数字和方法；
     「两班 96 人三轮每轮 6 周，行动研究，前后测，量表」全都有。
     它们的证据分必须拉开 40 分以上，否则纵轴还是没区分度。
  */
  const vague = evidenceOf(realClaims[0]).score;
  const solid = evidenceOf(realClaims[2]).score;
  check(
    "「只有结论」和「有样本有方法」至少差 40 分",
    solid - vague >= 40,
    `${vague} vs ${solid}`,
  );

  /*
     加上问题压力之后（假设都是 19 分那种压到底的情况），
     纵轴仍然要能拉开 —— 这是这一步改动真正要保证的事。
  */
  const defensibilities = realClaims.map((c) => blendDefensibility(evidenceOf(c).score, 19));
  const distinctAfterBlend = new Set(defensibilities).size;
  check(
    "问题压力全压到底（19）时，纵轴仍然至少 4 种不同的值",
    distinctAfterBlend >= 4,
    `${JSON.stringify(defensibilities)}，${distinctAfterBlend} 种`,
  );

  check(
    "纵轴最高和最低至少差 30 分",
    Math.max(...defensibilities) - Math.min(...defensibilities) >= 30,
    `${Math.min(...defensibilities)} ~ ${Math.max(...defensibilities)}`,
  );
}

/* ---------------------------------------------------------------
   [7b] 整份提纲的证据能借给单条主张
   --------------------------------------------------------------- */

console.log("\n[7b] 提纲里写过的样本量和方法，单条主张能借到");
{
  /*
     这是真实的一类失败：一份 600 字提纲里明明写着「两个平行班各 64 人」
     「Kappa 0.82」「α=0.89」，但 L1 是逐句切的，这些只落在其中一两条上，
     另外六条主张的「有没有数字」全拿 0 分 —— 用户答得上来，算法认为答不上来。

     这份 outline 就是那段真实提纲的节选。
  */
  const outline = [
    "一、研究背景：混合式教学在高校课程中已广泛推开，但学习投入的中介作用尚不清楚。",
    "二、研究问题：教学设计如何通过学生学习投入影响学业表现。",
    "三、研究内容：三个研究问题，分别对应描述、解释与检验。",
    "四、研究方法：采用准实验设计，两个平行班各 64 人，历时 16 周，前后测。",
    "课堂发言质量由两名研究者依据自编编码表独立编码，评分者一致性 Kappa 为 0.82。",
    "五、预期成果：形成一套可复用的分析框架，并发表一篇教学研究论文。",
  ].join("\n");

  const bare = claim("如何用真实弹幕语料训练学生的临场应答能力", "problem");

  const withoutOutline = evidenceOf(bare);
  const withOutline = evidenceOf(bare, outline);

  check(
    "同一句主张，给了提纲之后分更高",
    withOutline.score > withoutOutline.score,
    `${withoutOutline.score} → ${withOutline.score}`,
  );

  const numbers = withOutline.dimensions.find((d) => d.name === "有没有数字");
  check(
    "「有没有数字」从 0 分借到了分",
    numbers.score > 0,
    `${numbers.score} 分，命中 ${JSON.stringify(numbers.hits)}`,
  );

  check(
    "借来的词在 hits 里标着「提纲里有」，用户能看出不是这句话自己写的",
    numbers.hits.some((hit) => hit.startsWith("提纲里有：")),
    JSON.stringify(numbers.hits),
  );

  /*
     折扣必须真的存在：借来的分不能等于提纲本身的满分。
     否则一句空话只要提纲写得厚，就能拿满分 —— 那是在奖励灌水。
  */
  check(
    "借来的分打了折，不是直接拿提纲的满分",
    numbers.score < 100,
    `${numbers.score} 分`,
  );

  /*
     「说得具体吗」不许借。
     它问的是这句话本身够不够具体，借提纲的分等于给空话灌水。
  */
  const shortClaim = claim("提升学生能力", "expectation");
  const shortWithOutline = evidenceOf(shortClaim, outline);
  const specific = shortWithOutline.dimensions.find((d) => d.name === "说得具体吗");
  check(
    "「说得具体吗」不借提纲的分",
    specific.score === evidenceOf(shortClaim).dimensions.find((d) => d.name === "说得具体吗").score,
    `${specific.score} 分`,
  );

  /*
     反向断言：这句话自己就写全了的时候，不能因为借分而变低。
     借分只往上补，不往下压。
  */
  const solid = claim("采用准实验设计，两个平行班各 64 人，历时 16 周，前后测", "method");
  check(
    "自己写全了的主张，借分之后不会更低",
    evidenceOf(solid, outline).score >= evidenceOf(solid).score,
    `${evidenceOf(solid).score} → ${evidenceOf(solid, outline).score}`,
  );

  /*
     空提纲、空串，行为跟不传一样 —— 不能因为传了个空串就崩或者变分。
  */
  check(
    "传空串提纲，等于没传",
    evidenceOf(bare, "").score === withoutOutline.score,
    `${withoutOutline.score} vs ${evidenceOf(bare, "").score}`,
  );

  /*
     整份提纲全都很弱时，借分也借不出东西来 —— 这是对的。
     一份什么都没写的提纲，不该能让它的主张凭空变稳。
  */
  const weakOutline = "我觉得这个题目很有意思，想研究一下短视频对学生的好处。";
  check(
    "提纲本身没证据时，借不到分",
    evidenceOf(bare, weakOutline).score === withoutOutline.score,
    `${withoutOutline.score} vs ${evidenceOf(bare, weakOutline).score}`,
  );
}

/* ---------------------------------------------------------------
   [8] 边界
   --------------------------------------------------------------- */

console.log("\n[8] 边界情况");
{
  const empty = evidenceOf(claim(""));
  check("空文本不崩且是 0 分", empty.score === 0, String(empty.score));

  const spaces = evidenceOf(claim("     "));
  check("全是空格也不崩", typeof spaces.score === "number");

  const repeated = evidenceOf(claim("96 人 96 人 96 人"));
  check("同一个数字重复出现只算一个", dim(repeated, "有没有数字") === 40, String(dim(repeated, "有没有数字")));

  const english = evidenceOf(claim("action research with pre-test and post-test"));
  check("英文主张不崩（方法词是中文，所以拿 0 分不奇怪）", typeof english.score === "number", String(english.score));
}

/* ---------------------------------------------------------------
   [9] 及格线校准：只动刻度，不动排序
   --------------------------------------------------------------- */

console.log("\n[9] 及格线校准");
{
  check("0 分还是 0 分", calibrateEvidence(0) === 0, String(calibrateEvidence(0)));
  check("100 分还是 100 分", calibrateEvidence(100) === 100, String(calibrateEvidence(100)));

  // 原始 40（两个维度到位）校准到 52，刚过及格线
  check("原始 40 → 52（两个维度到位就算及格）", calibrateEvidence(40) === 52, String(calibrateEvidence(40)));

  /*
     校准最容易写错的地方：把排序搞乱。
     一条原始分更高的主张，校准后必须还更高，否则地图上的上下关系会自相矛盾。
     这里把 0-100 每 5 分都过一遍。
  */
  let orderBroken = "";
  for (let raw = 0; raw < 100; raw += 5) {
    if (calibrateEvidence(raw) > calibrateEvidence(raw + 5)) {
      orderBroken = `${raw} → ${calibrateEvidence(raw)}，但 ${raw + 5} → ${calibrateEvidence(raw + 5)}`;
      break;
    }
  }
  check("原始分更高的，校准后一定不会更低", orderBroken === "", orderBroken);

  // 校准只能往上抬或不动，不能往下压 —— 它解决的就是"整体偏低"
  let pushedDown = "";
  for (let raw = 0; raw <= 100; raw += 5) {
    if (calibrateEvidence(raw) < raw) {
      pushedDown = `${raw} → ${calibrateEvidence(raw)}`;
      break;
    }
  }
  check("校准不会把任何一条往下压", pushedDown === "", pushedDown);

  check("超出范围会被夹住（负数）", calibrateEvidence(-30) === 0, String(calibrateEvidence(-30)));
  check("超出范围会被夹住（超过 100）", calibrateEvidence(150) === 100, String(calibrateEvidence(150)));
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);

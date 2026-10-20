/**
 * 手工粘贴中文文献的自检。
 *
 * 这一层的输入是**用户手打/手粘的自由文本**，是所有输入里最脏的一种。
 * 所以这里测的重点不是"正常的标题能不能认出来"，是：
 *   - 各种编号写法能不能剥掉
 *   - 「被引量：4」这类脏尾巴会不会混进标题
 *   - 认不出来的行是**跳过并说一声**，还是被硬塞进池子
 *   - 同一篇粘两遍会不会被数两次
 *   - 粘一整篇参考文献目录会不会把分数搞乱
 *
 * 跑法：npm run check:manual（不联网、不花钱）
 */

import { parseManualRefs, MIN_TITLE_LENGTH, MAX_REFS } from "../lib/manual.ts";
import { fromManual, scoreOverlap, MANUAL_WEIGHT } from "../lib/overlap.ts";

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ""}`);
  }
}

function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, ok, ok ? "" : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

function titles(refs) {
  return refs.map((ref) => ref.title);
}

/* ==============================================================
   [1] 各种编号写法
   ============================================================== */

console.log("\n[1] 行首编号");

{
  const cases = [
    ["1. 高职院校短视频创作课程混合式教学改革策略", "高职院校短视频创作课程混合式教学改革策略"],
    ["1、高职院校短视频创作课程混合式教学改革策略", "高职院校短视频创作课程混合式教学改革策略"],
    ["1) 高职院校短视频创作课程混合式教学改革策略", "高职院校短视频创作课程混合式教学改革策略"],
    ["1）高职院校短视频创作课程混合式教学改革策略", "高职院校短视频创作课程混合式教学改革策略"],
    ["(1) 高职院校短视频创作课程混合式教学改革策略", "高职院校短视频创作课程混合式教学改革策略"],
    ["（1）高职院校短视频创作课程混合式教学改革策略", "高职院校短视频创作课程混合式教学改革策略"],
    ["[1] 高职院校短视频创作课程混合式教学改革策略", "高职院校短视频创作课程混合式教学改革策略"],
    ["①高职院校短视频创作课程混合式教学改革策略", "高职院校短视频创作课程混合式教学改革策略"],
    ["一、高职院校短视频创作课程混合式教学改革策略", "高职院校短视频创作课程混合式教学改革策略"],
    ["- 高职院校短视频创作课程混合式教学改革策略", "高职院校短视频创作课程混合式教学改革策略"],
    ["• 高职院校短视频创作课程混合式教学改革策略", "高职院校短视频创作课程混合式教学改革策略"],
  ];

  for (const [input, expected] of cases) {
    const { refs } = parseManualRefs(input);
    eq(`剥掉编号：${input.slice(0, 6)}…`, titles(refs), [expected]);
  }
}

/* ==============================================================
   [2] 脏尾巴
   ============================================================== */

console.log("\n[2] 脏尾巴");

{
  const { refs } = parseManualRefs(
    "短视频融入高职院校思政课教学策略研究（被引量：4）",
  );
  eq("去掉「被引量：4」", titles(refs), ["短视频融入高职院校思政课教学策略研究"]);
}

{
  const { refs } = parseManualRefs("短视频融入高职院校思政课教学策略研究 被引 12");
  eq("去掉「被引 12」", titles(refs), ["短视频融入高职院校思政课教学策略研究"]);
}

{
  const { refs } = parseManualRefs("《短视频融入高职院校思政课教学策略研究》");
  eq("去掉书名号", titles(refs), ["短视频融入高职院校思政课教学策略研究"]);
}

{
  const { refs } = parseManualRefs("「短视频融入高职院校思政课教学策略研究」");
  eq("去掉直角引号", titles(refs), ["短视频融入高职院校思政课教学策略研究"]);
}

/* ==============================================================
   [3] 标题 + 期刊 + 年份
   ============================================================== */

console.log("\n[3] 出处和年份");

{
  const { refs } = parseManualRefs(
    "短视频融入高职院校思政课教学策略研究 - 淮南职业技术学院学报 2025",
  );
  eq("短横线分标题和期刊", titles(refs), ["短视频融入高职院校思政课教学策略研究"]);
  eq("期刊名抠出来了", refs[0]?.venue, "淮南职业技术学院学报");
  eq("年份抠出来了", refs[0]?.year, "2025");
}

{
  const { refs } = parseManualRefs("高职数字媒体专业课程改革探索（2022）");
  eq("括号年份：标题", titles(refs), ["高职数字媒体专业课程改革探索"]);
  eq("括号年份：年份", refs[0]?.year, "2022");
  eq("括号年份：没有期刊名", refs[0]?.venue, "");
}

{
  const { refs } = parseManualRefs("行动研究法在职教课堂中的应用 2021年");
  eq("裸年份：标题", titles(refs), ["行动研究法在职教课堂中的应用"]);
  eq("裸年份：年份", refs[0]?.year, "2021");
}

{
  const { refs } = parseManualRefs("某篇论文标题｜中国职业技术教育｜2023");
  eq("竖线分三段", titles(refs), ["某篇论文标题"]);
  eq("竖线分三段：期刊", refs[0]?.venue, "中国职业技术教育");
  eq("竖线分三段：年份", refs[0]?.year, "2023");
}

/*
  中文标题里本身带短横线的情况。
  "短视频+N" 这种写法很常见，不能被当成"标题 - 期刊"的分隔符。
  注意这里靠的是「分隔符必须带空格」，不带空格的短横线不算。
*/
{
  const { refs } = parseManualRefs("高职院校「短视频+N」网络育人模式的实践路径探索");
  eq("标题里的短横线不切", titles(refs), ["高职院校「短视频+N」网络育人模式的实践路径探索"]);
}

{
  const { refs } = parseManualRefs("产教融合-校企合作背景下的人才培养模式研究");
  eq("不带空格的短横线不切", titles(refs), ["产教融合-校企合作背景下的人才培养模式研究"]);
}

/* ==============================================================
   [4] 认不出来的行
   ============================================================== */

console.log("\n[4] 认不出来就跳过并说一声");

{
  const { refs, warnings } = parseManualRefs("研究\n方法\n结论");
  eq("太短的行一条都不算", refs.length, 0);
  check("说了一声有几行太短", warnings.some((w) => w.includes("太短")), warnings.join(" / "));
}

{
  const { refs, warnings } = parseManualRefs("");
  eq("空字符串：0 条", refs.length, 0);
  eq("空字符串：不报警告", warnings.length, 0);
}

{
  const { refs } = parseManualRefs("   \n\n   \n");
  eq("纯空白：0 条", refs.length, 0);
}

{
  const { refs } = parseManualRefs("短标题");
  eq(`${MIN_TITLE_LENGTH - 1} 个字的标题被跳过`, refs.length, 0);
}

{
  const { refs } = parseManualRefs("正好六个字的标题");
  eq(`${MIN_TITLE_LENGTH} 个字的标题被收下`, refs.length, 1);
}

/*
  只有编号没有内容的行。
  剥完编号什么都不剩，应该跳过，而不是变成一条空标题。
*/
{
  const { refs } = parseManualRefs("1.\n2.\n3.");
  eq("只有编号：0 条", refs.length, 0);
}

/* ==============================================================
   [5] 去重
   ============================================================== */

console.log("\n[5] 去重");

{
  const { refs } = parseManualRefs(
    [
      "短视频融入高职院校思政课教学策略研究",
      "短视频融入高职院校思政课教学策略研究 - 淮南职业技术学院学报 2025",
    ].join("\n"),
  );
  eq("同一篇粘两遍只算一条", refs.length, 1);
}

{
  const { refs } = parseManualRefs(
    ["短视频融入高职院校思政课教学策略研究", "短视频融入高职院校思政课教学策略研究！"].join("\n"),
  );
  eq("只差标点也算同一篇", refs.length, 1);
}

{
  const { refs } = parseManualRefs(
    ["短视频融入高职院校思政课教学策略研究", "高职数字媒体专业课程改革探索"].join("\n"),
  );
  eq("两篇不同的都留下", refs.length, 2);
}

/* ==============================================================
   [6] 上限
   ============================================================== */

console.log("\n[6] 上限");

{
  const lines = Array.from({ length: MAX_REFS + 10 }, (_, i) => `第 ${i} 篇文献的标题足够长了`);
  const { refs, warnings } = parseManualRefs(lines.join("\n"));
  eq(`最多认 ${MAX_REFS} 条`, refs.length, MAX_REFS);
  check("说了后面的没算", warnings.some((w) => w.includes("最多认")), warnings.join(" / "));
}

/* ==============================================================
   [7] 接进打分层
   ============================================================== */

console.log("\n[7] 接进打分层");

const CLAIM = {
  id: "c1",
  text: "用镜头语言训练提升高职学生的视频叙事能力",
  type: "method",
  location: "第 2 段",
  overlap: 50,
  defensibility: 50,
};

const INTENT = {
  claimId: "c1",
  phrase: "shot language",
  keywords: ["shot language", "video narrative"],
  zhQuery: "镜头语言 视频叙事 高职",
};

{
  const hit = fromManual({ title: "镜头语言在高职视频教学中的应用研究", venue: "中国职业技术教育", year: "2023" });
  eq("source 是 manual", hit.source, "manual");
  eq("key 带前缀", hit.key.startsWith("manual:"), true);
  eq("年份传下去了", hit.year, "2023");
  eq("期刊名放在 venue", hit.venue, "中国职业技术教育");
}

{
  const result = scoreOverlap({
    claim: CLAIM,
    intent: INTENT,
    arxivHits: [],
    crossrefHits: [],
    manualRefs: [{ title: "镜头语言在高职视频教学中的应用研究", venue: "", year: "" }],
    sourcesAnswered: 1,
  });
  check("粘的文献能推高分数", result.score > 0, `score=${result.score}`);
  eq("最像的那篇来自 manual", result.bestHit?.source, "manual");
  check(
    "理由里说清是「你自己粘的那篇」",
    result.reason.includes("你自己粘的那篇"),
    result.reason,
  );
  check(
    "理由里提醒分数里算上了粘的文献",
    result.reason.includes("算上了你粘的文献"),
    result.reason,
  );
}

/*
  粘一堆不相关的东西不该把分数抬上去。
  这是这个功能最容易被滥用的方向：随便粘 20 篇标题，
  每条主张都能撞上点什么，图上一片"撞车"，诊断就没意义了。
*/
{
  const unrelated = [
    "量子化学密度泛函理论在催化剂设计中的应用",
    "宋代瓷器的釉色演变与窑口关系研究",
    "基于深度学习的医学影像分割算法综述",
    "城市轨道交通客流预测模型比较研究",
    "明清江南园林的空间叙事与造园手法",
  ].map((title) => ({ title, venue: "", year: "" }));

  const result = scoreOverlap({
    claim: CLAIM,
    intent: INTENT,
    arxivHits: [],
    crossrefHits: [],
    manualRefs: unrelated,
    sourcesAnswered: 1,
  });
  check("粘一堆不相关的抬不动分数", result.score < 25, `score=${result.score}`);
}

/*
  一条主张都没查成（sourcesAnswered = 0）时，就算粘了文献，
  分数也必须标成不可信。
  理由：中文文献是用户自己的补充，它不能替代"数据库到底通不通"这个事实。
  混了的话会出现「arXiv 和 Crossref 全挂了，报告却显示分数可信」。
*/
{
  const result = scoreOverlap({
    claim: CLAIM,
    intent: INTENT,
    arxivHits: [],
    crossrefHits: [],
    manualRefs: [{ title: "镜头语言在高职视频教学中的应用研究", venue: "", year: "" }],
    sourcesAnswered: 0,
  });
  eq("一个库都没查成时分数是 0", result.score, 0);
  check("并且说明不算数", result.reason.includes("不算数"), result.reason);
}

{
  eq("手工文献不打折", MANUAL_WEIGHT, 1.0);
}

/* ==============================================================
   [8] 脏输入不崩
   ============================================================== */

console.log("\n[8] 脏输入不崩");

{
  const weird = [
    null,
    undefined,
    123,
    {},
    [],
    "a".repeat(20000),
    "\u0000\u0001\u0002",
    "🎉🎉🎉🎉🎉🎉🎉",
  ];

  let crashed = 0;
  for (const input of weird) {
    try {
      const out = parseManualRefs(input);
      if (!Array.isArray(out.refs) || !Array.isArray(out.warnings)) crashed += 1;
    } catch {
      crashed += 1;
    }
  }
  eq("八种怪输入一个都没崩", crashed, 0);
}

{
  const { refs, warnings } = parseManualRefs("a".repeat(20000));
  check("超长输入被截断", warnings.some((w) => w.includes("只看了前面")), warnings.join(" / "));
  check("截断后仍然认出了一条", refs.length >= 1, `refs=${refs.length}`);
}

/* ==============================================================
   收尾
   ============================================================== */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

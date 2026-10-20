/**
 * 总体评分的自检脚本。
 *
 * 全程不联网、不花钱：总分只吃两个已经算好的数，纯算术。
 *
 * 跑法：node scripts/check-score.mjs
 *
 * 这个脚本存在的理由：
 * 总分是整份报告里唯一一个"一句话结论"，用户会直接拿它判断自己的选题行不行。
 * 一个算错的总结比十个算错的细节严重 —— 细节错了用户能自己看出不对，
 * 总结错了用户只会照单全收。所以这里的断言重点不是公式对不对，
 * 而是**它在各种残缺数据下都不会说出不成立的话**。
 */

import { claimScore, overallScore, SCORE_FORMULA_TEXT } from "../lib/score.ts";

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

/** 造一条主张，只关心两个分数。 */
function item(id, overlap, defensibility) {
  return { id, overlap, defensibility };
}

/* ---------------------------------------------------------------
   [1] 单条主张的分数
   --------------------------------------------------------------- */

console.log("\n[1] 单条主张：两头各占一半");
{
  check(
    "又新又答得上来 = 100",
    claimScore(0, 100) === 100,
    String(claimScore(0, 100)),
  );
  check(
    "别人做过且答不上来 = 0",
    claimScore(100, 0) === 0,
    String(claimScore(100, 0)),
  );
  check(
    "两个 50 分 = 50",
    claimScore(50, 50) === 50,
    String(claimScore(50, 50)),
  );

  /*
     这是这个公式最重要的性质：两头互补。
     「别人做过 100 但答得上来 100」和「没人做过但答不上来」
     应该拿到同一个分 —— 一个不新、一个不稳，对开题来说同样难办。
  */
  check(
    "不新但很稳 = 很新但很不稳",
    claimScore(100, 100) === claimScore(0, 0),
    `${claimScore(100, 100)} vs ${claimScore(0, 0)}`,
  );

  check(
    "分高的那条，单条分一定更高",
    claimScore(20, 80) > claimScore(80, 20),
    `${claimScore(20, 80)} vs ${claimScore(80, 20)}`,
  );
}

/* ---------------------------------------------------------------
   [2] 整份报告的平均
   --------------------------------------------------------------- */

console.log("\n[2] 整份报告：取平均，四舍五入");
{
  const result = overallScore([item("c1", 40, 60), item("c2", 60, 40)]);
  check("两条互补的主张，总分正好 50", result.score === 50, String(result.score));
  check("参与计算的条数对", result.counted === 2, String(result.counted));
  check("横轴平均对", result.averageOverlap === 50, String(result.averageOverlap));
  check("纵轴平均对", result.averageDefensibility === 50, String(result.averageDefensibility));
  check("没有排除任何一条", result.excluded === 0, String(result.excluded));

  const high = overallScore([item("c1", 10, 90), item("c2", 20, 80)]);
  check("两条都很好的，总分高", high.score >= 80, String(high.score));

  const low = overallScore([item("c1", 90, 10), item("c2", 85, 5)]);
  check("两条都很差的，总分低", low.score <= 20, String(low.score));
}

/* ---------------------------------------------------------------
   [3] 查不到的那几条必须排除
   --------------------------------------------------------------- */

console.log("\n[3] 没查成的主张不算进平均");
{
  /*
     这是整个文件里最重要的一组断言。
     检索没做成时 overlap 是 0，但那个 0 的意思是「不知道」。
     如果把它当「没人做过」代进公式，每条白送 50 分 ——
     一份全都查不到的报告会拿到接近满分，那是最坏的一种假话。
  */
  const items = [item("c1", 80, 20), item("c2", 0, 20), item("c3", 0, 20)];
  const withBlind = overallScore(items, ["c2", "c3"]);

  check(
    "被排除的那几条不参与平均",
    withBlind.counted === 1,
    `算了 ${withBlind.counted} 条`,
  );
  check("排除条数如实报出来", withBlind.excluded === 2, String(withBlind.excluded));
  check(
    "总分只反映真实算出来的那条",
    withBlind.score === claimScore(80, 20),
    `${withBlind.score} vs ${claimScore(80, 20)}`,
  );

  const withoutExclusion = overallScore(items);
  check(
    "不排除的话总分会被抬高（证明这个排除确实在起作用）",
    withoutExclusion.score > withBlind.score,
    `${withBlind.score} → ${withoutExclusion.score}`,
  );

  check(
    "reason 里说清了有几条没算进来",
    withBlind.reason.includes("2 条没查成"),
    withBlind.reason,
  );
}

/* ---------------------------------------------------------------
   [4] 一条都算不出来的时候
   --------------------------------------------------------------- */

console.log("\n[4] 算不出来时，不许编一个数");
{
  const allBlind = overallScore([item("c1", 0, 20), item("c2", 0, 30)], ["c1", "c2"]);
  check("全都是查不到时，分数是 null 不是 0", allBlind.score === null, String(allBlind.score));
  check("这时候 verdict 说的是算不出来", allBlind.verdict === "算不出来", allBlind.verdict);
  check(
    "reason 说清了为什么算不出来",
    allBlind.reason.includes("没查成"),
    allBlind.reason,
  );

  const empty = overallScore([]);
  check("一条主张都没有时，分数是 null", empty.score === null, String(empty.score));
  check("一条主张都没有时不会崩", empty.counted === 0, String(empty.counted));
}

/* ---------------------------------------------------------------
   [5] 分档文案
   --------------------------------------------------------------- */

console.log("\n[5] 分档：每一档都有话说，且不重叠");
{
  const bands = [
    { overlap: 0, defensibility: 95, expect: "准备得比较扎实" },
    { overlap: 30, defensibility: 70, expect: "准备得比较扎实" },
    { overlap: 40, defensibility: 60, expect: "大部分能答上来" },
    { overlap: 60, defensibility: 40, expect: "有底子，但软肋明显" },
    { overlap: 90, defensibility: 10, expect: "现在去答辩会很吃力" },
  ];

  for (const band of bands) {
    const result = overallScore([item("c1", band.overlap, band.defensibility)]);
    check(
      `${band.overlap}/${band.defensibility} → ${band.expect}`,
      result.verdict === band.expect,
      `${result.score} 分，${result.verdict}`,
    );
  }

  /*
     分档边界必须严格：59 分不能落到「大部分能答上来」，
     否则「有底子但软肋明显」这一档就永远只有 30-49，越窄越没人看见。
  */
  const justBelow = overallScore([item("c1", 0, 98)]);
  check(
    "接近满分不会掉到下一档",
    justBelow.verdict === "准备得比较扎实",
    `${justBelow.score} 分，${justBelow.verdict}`,
  );
}

/* ---------------------------------------------------------------
   [6] 不会越界
   --------------------------------------------------------------- */

console.log("\n[6] 极端数据不会算出负数或超过 100");
{
  const extreme = overallScore([item("c1", 0, 100), item("c2", 100, 0)]);
  check("两头都极端时总分在 0-100 之间", extreme.score >= 0 && extreme.score <= 100, String(extreme.score));

  /*
     就算上游给了越界的数据（比如检索层出 bug 给了 120），
     总分也不能跟着越界 —— 界面上要显示的是一个百分数。
  */
  const overflow = overallScore([item("c1", 120, -20)]);
  check(
    "上游数据越界时，总分仍落在 0-100",
    overflow.score >= 0 && overflow.score <= 100,
    String(overflow.score),
  );
}

/* ---------------------------------------------------------------
   [7] 公式文案
   --------------------------------------------------------------- */

console.log("\n[7] 公式文案要能对上代码");
{
  check("公式文案非空", SCORE_FORMULA_TEXT.length > 10, `${SCORE_FORMULA_TEXT.length} 字`);
  check(
    "公式文案里写了 0.5 这个权重",
    SCORE_FORMULA_TEXT.includes("0.5"),
    SCORE_FORMULA_TEXT,
  );
  check(
    "公式文案里交代了查不到的不算",
    SCORE_FORMULA_TEXT.includes("查不到"),
    SCORE_FORMULA_TEXT,
  );
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);

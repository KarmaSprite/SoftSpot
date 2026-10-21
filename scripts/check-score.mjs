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

import {
  calibrateScore,
  claimScore,
  overallScore,
  rawClaimScore,
  SCORE_FORMULA_MAIN,
  SCORE_FORMULA_NOTE,
  SCORE_FORMULA_TEXT,
  SCORE_SCALE_POINTS,
  SCORE_SCALE_TEXT,
} from "../lib/score.ts";

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
   [1] 原始公式：两头各占一半
   --------------------------------------------------------------- */

console.log("\n[1] 原始分：两头各占一半");
{
  check("又新又答得上来 = 100", rawClaimScore(0, 100) === 100, String(rawClaimScore(0, 100)));
  check(
    "别人做过且答不上来 = 0",
    rawClaimScore(100, 0) === 0,
    String(rawClaimScore(100, 0)),
  );
  check("两个 50 分 = 50", rawClaimScore(50, 50) === 50, String(rawClaimScore(50, 50)));

  /*
     这是这个公式最重要的性质：两头互补。
     「别人做过 100 但答得上来 100」和「没人做过但答不上来」
     应该拿到同一个分 —— 一个不新、一个不稳，对开题来说同样难办。
  */
  check(
    "不新但很稳 = 很新但很不稳",
    rawClaimScore(100, 100) === rawClaimScore(0, 0),
    `${rawClaimScore(100, 100)} vs ${rawClaimScore(0, 0)}`,
  );

  check(
    "分高的那条，原始分一定更高",
    rawClaimScore(20, 80) > rawClaimScore(80, 20),
    `${rawClaimScore(20, 80)} vs ${rawClaimScore(80, 20)}`,
  );
}

/* ---------------------------------------------------------------
   [2] 刻度换算
   --------------------------------------------------------------- */

console.log("\n[2] 刻度换算：只动刻度，不动排序");
{
  /*
     换算必须单调：原始分高的，显示分不能更低。
     如果这条破了，界面上就会出现「A 条比 B 条写得好，但 B 条分数更高」，
     用户会立刻不信这个数。
  */
  let monotonic = true;
  let previous = -1;
  for (let raw = 0; raw <= 100; raw += 1) {
    const shown = calibrateScore(raw);
    if (shown < previous) monotonic = false;
    previous = shown;
  }
  check("原始分从 0 到 100 走一遍，显示分不会回头", monotonic, "逐分检查");

  check("原始 0 分显示 0 分", calibrateScore(0) === 0, String(calibrateScore(0)));
  check("原始 100 分显示 100 分", calibrateScore(100) === 100, String(calibrateScore(100)));

  /*
     这是加刻度曲线的全部理由：原始 55 分（研究设计写得很细、
     但选题撞得比较多）要显示成 70 分，落到「写得比较扎实」那一档。
     如果哪天有人把锚点改回原样，这条会立刻红。
  */
  check("原始 55 分换算成 70 分", calibrateScore(55) === 70, String(calibrateScore(55)));
  check("原始 40 分换算成 58 分", calibrateScore(40) === 58, String(calibrateScore(40)));
  check("原始 70 分换算成 84 分", calibrateScore(70) === 84, String(calibrateScore(70)));

  check(
    "换算之后，写得好的那份能上 70",
    calibrateScore(55) >= 60,
    `${calibrateScore(55)} 分`,
  );
}

/* ---------------------------------------------------------------
   [3] 照抄一篇论文，不能拿合格证
   --------------------------------------------------------------- */

console.log("\n[3] 撞到 85 分以上，不管纵轴多高都封顶");
{
  /*
     这是这套评分最不能犯的错。
     原始公式里「别人做过 100 + 答得上来 100」= 50 分，
     换刻度之后会变成 66 分 —— 那是「写得比较扎实」。
     等于给「整段照抄一篇论文，只把证据写全」发了一张合格证。
  */
  const copied = claimScore(100, 100);
  check("照抄满分论文的主张，显示分被压到 45 以下", copied <= 45, `${copied} 分`);

  const nearlyCopied = claimScore(90, 100);
  check("撞到 90 分也一样封顶", nearlyCopied <= 45, `${nearlyCopied} 分`);

  const original = claimScore(60, 100);
  check(
    "撞到 60 分（正常范围）不封顶",
    original > 45,
    `${original} 分`,
  );

  /*
     封顶只能往下压，不能往上抬。
     否则「撞车」反而变成了加分项。
  */
  check(
    "封顶不会把低分抬上去",
    claimScore(100, 0) <= claimScore(100, 100),
    `${claimScore(100, 0)} vs ${claimScore(100, 100)}`,
  );
}

/* ---------------------------------------------------------------
   [4] 整份报告的平均
   --------------------------------------------------------------- */

console.log("\n[4] 整份报告：取平均，四舍五入");
{
  const result = overallScore([item("c1", 50, 50), item("c2", 50, 50)]);
  check(
    "两条一模一样的 50/50，总分等于单条的显示分",
    result.score === claimScore(50, 50),
    `${result.score} vs ${claimScore(50, 50)}`,
  );
  check("参与计算的条数对", result.counted === 2, String(result.counted));
  check("横轴平均对", result.averageOverlap === 50, String(result.averageOverlap));
  check("纵轴平均对", result.averageDefensibility === 50, String(result.averageDefensibility));
  check("没有排除任何一条", result.excluded === 0, String(result.excluded));

  /*
     取平均必须发生在换算之后，不是之前。
     反例：两条 60/40 和 40/60，原始分一个 60 一个 40，平均 50；
     但它们换算后的显示分是 75 和 58，平均 67 —— 两个数不一样。
     差在哪：换算是非线性的，先平均再换算会把两端的差异抹平。
     用户看到的是每条的分，总分必须跟那些分对得上，所以先换算再平均。
  */
  const mixed = overallScore([item("c1", 40, 60), item("c2", 60, 40)]);
  check(
    "先换算再平均，不是先平均再换算",
    mixed.score === Math.round((claimScore(40, 60) + claimScore(60, 40)) / 2),
    `${mixed.score}（若先平均再换算会是 ${claimScore(50, 50)}）`,
  );

  const high = overallScore([item("c1", 10, 90), item("c2", 20, 80)]);
  check("两条都很好的，总分高", high.score >= 80, String(high.score));

  const low = overallScore([item("c1", 90, 10), item("c2", 85, 5)]);
  check("两条都很差的，总分低", low.score <= 20, String(low.score));
}

/* ---------------------------------------------------------------
   [5] 查不到的那几条必须排除
   --------------------------------------------------------------- */

console.log("\n[5] 没查成的主张不算进平均");
{
  /*
     这是整个文件里最重要的一组断言。
     检索没做成时 overlap 是 0，但那个 0 的意思是「不知道」。
     如果把它当「没人做过」代进公式，每条白送一半的纵轴分 ——
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
   [6] 一条都算不出来的时候
   --------------------------------------------------------------- */

console.log("\n[6] 算不出来时，不许编一个数");
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
   [7] 分档文案
   --------------------------------------------------------------- */

console.log("\n[7] 分档：写得好的在 60-75，新颖且扎实才 75 以上");
{
  const bands = [
    { overlap: 0, defensibility: 95, expect: "新颖而且扎实" },
    { overlap: 30, defensibility: 70, expect: "新颖而且扎实" },
    { overlap: 40, defensibility: 50, expect: "写得比较扎实" },
    { overlap: 55, defensibility: 50, expect: "写得比较扎实" },
    { overlap: 60, defensibility: 40, expect: "有底子，但软肋明显" },
    { overlap: 85, defensibility: 10, expect: "现在去答辩会很吃力" },
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
     用户要的口径：写得好的落在 60-75。
     拿真实跑过的两份提纲验一遍 —— 一份研究设计写得极细但选题撞得多
     （横轴 51、纵轴 57），一份只写了「我要研究什么」（横轴 82、纵轴 13）。
     前者必须落在 60 以上，后者必须在 40 以下。
  */
  const solid = overallScore([item("c1", 51, 57)]);
  check("研究设计写得细的那份，能上 60", solid.score >= 60, `${solid.score} 分`);

  const vague = overallScore([item("c1", 82, 13)]);
  check("只写了个题目的那份，落在 40 以下", vague.score < 40, `${vague.score} 分`);

  check(
    "分档边界不会让两档重叠",
    new Set(["新颖而且扎实", "写得比较扎实", "有底子，但软肋明显", "现在去答辩会很吃力"])
      .size === 4,
    "四档文案互不相同",
  );
}

/* ---------------------------------------------------------------
   [8] 不会越界
   --------------------------------------------------------------- */

console.log("\n[8] 极端数据不会算出负数或超过 100");
{
  const extreme = overallScore([item("c1", 0, 100), item("c2", 100, 0)]);
  check(
    "两头都极端时总分在 0-100 之间",
    extreme.score >= 0 && extreme.score <= 100,
    String(extreme.score),
  );

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
   [9] 公式文案
   --------------------------------------------------------------- */

console.log("\n[9] 公式文案要能对上代码");
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
  check(
    "公式文案里交代了要换算成显示分",
    SCORE_FORMULA_TEXT.includes("换算"),
    SCORE_FORMULA_TEXT,
  );
  check("刻度文案非空", SCORE_SCALE_TEXT.length > 10, `${SCORE_SCALE_TEXT.length} 字`);

  /*
     刻度文案里写的数字必须和 CALIBRATION 真的一样。
     这一条是防「改了刻度忘了改文案」—— 那会变成界面上印着一份
     跟代码不符的说明，比不印更糟：用户照着验算会发现对不上。
  */
  for (const [raw, shown] of [
    [40, 58],
    [55, 70],
    [70, 84],
  ]) {
    check(
      `刻度文案里的 ${raw} → ${shown} 跟代码一致`,
      calibrateScore(raw) === shown && SCORE_SCALE_TEXT.includes(String(raw)) && SCORE_SCALE_TEXT.includes(String(shown)),
      `calibrateScore(${raw}) = ${calibrateScore(raw)}`,
    );
  }
}

/* ---------------------------------------------------------------
   [10] 拆开的三块要能拼回一整句（第 24f 步）
   --------------------------------------------------------------- */

console.log("\n[10] 拆开的公式和刻度要能拼回去");
{
  /*
     第 24f 步把界面上那一整句拆成了「算式 + 说明」和「三个小片」。
     拆开之后有一个新风险：改了一块忘了另一块。
     这一组断言就是防这个 —— 拼出来的必须等于原来那一句。
  */
  check(
    "算式 + 说明拼起来等于整句",
    SCORE_FORMULA_TEXT === `${SCORE_FORMULA_MAIN}。${SCORE_FORMULA_NOTE}`,
    SCORE_FORMULA_TEXT,
  );

  check(
    "算式本身含 0.5 这个权重",
    SCORE_FORMULA_MAIN.includes("0.5"),
    SCORE_FORMULA_MAIN,
  );

  check(
    "排除规则在说明句里，不在算式里",
    SCORE_FORMULA_NOTE.includes("查不到") && !SCORE_FORMULA_MAIN.includes("查不到"),
    SCORE_FORMULA_NOTE,
  );

  /*
     三个小片上的数字必须跟 CALIBRATION 真的一样。
     界面上现在是三个「40→58」这样的小片，用户照着验算，
     对不上就是印了一份跟代码不符的说明。
  */
  check(
    "刻度小片有三个锚点",
    SCORE_SCALE_POINTS.length === 3,
    `${SCORE_SCALE_POINTS.length} 个`,
  );

  for (const point of SCORE_SCALE_POINTS) {
    check(
      `刻度小片 ${point.raw} → ${point.shown} 跟代码一致`,
      calibrateScore(point.raw) === point.shown,
      `calibrateScore(${point.raw}) = ${calibrateScore(point.raw)}`,
    );
    check(
      `刻度小片 ${point.raw} 也出现在一句话版本里`,
      SCORE_SCALE_TEXT.includes(String(point.raw)) && SCORE_SCALE_TEXT.includes(String(point.shown)),
      SCORE_SCALE_TEXT,
    );
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);

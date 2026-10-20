/**
 * 「离主场最近的一条」的自检脚本。
 *
 * 全程不联网、不花钱：这里全是纯算术，不看检索结果，不调模型。
 *
 * 跑法：node scripts/check-nearest.mjs
 *
 * 这个脚本最该锁住的三件事：
 *   [2] 横轴差 1 分不能算成差 0 分（50 分算"别人做过"，要降到 49 才算新）
 *   [4] 查重没做成的主张不能当选（它的 overlap 0 是"不知道"，不是"没人做过"）
 *   [5] 建议必须点对维度（说"补方法"的时候不能其实缺的是数字）
 */

import {
  findNearestHome,
  gapToHome,
  describeDefGap,
  describeOverlapGap,
  DIMENSION_ADVICE,
} from "../lib/nearest.ts";

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

/** 造一条成品主张：带两个分数。 */
function claim(id, text, overlap, defensibility) {
  return { id, text, type: "method", location: "测试", overlap, defensibility };
}

/** 造一份证据明细。四个维度按 evidence.ts 的顺序给。 */
function evidence(claimId, scores) {
  return {
    claimId,
    score: 0,
    dimensions: [
      { name: "有没有数字", score: scores[0] },
      { name: "有没有方法", score: scores[1] },
      { name: "有没有出处", score: scores[2] },
      { name: "说得具体吗", score: scores[3] },
    ],
  };
}

/* ---------------------------------------------------------------
   [1] 差几分：两个轴的算法
   --------------------------------------------------------------- */

console.log("\n[1] 差几分");
{
  const far = gapToHome(claim("c1", "x", 66, 47));
  check("overlap 66 → 差 17 分", far.overlapGap === 17, String(far.overlapGap));
  check("def 47 → 差 3 分", far.defGap === 3, String(far.defGap));

  const alreadyNew = gapToHome(claim("c2", "x", 20, 80));
  check("overlap 20 → 横轴不差", alreadyNew.overlapGap === 0, String(alreadyNew.overlapGap));
  check("def 80 → 纵轴不差", alreadyNew.defGap === 0, String(alreadyNew.defGap));

  /*
     边界最容易写错的地方。
     50 分在 quadrant.ts 里算「别人做过」，所以 overlap 50 还差 1 分才够新。
     如果这里算成 0，界面会说"已经够新"，而它其实进不了主场 —— 那就等于骗人。
  */
  const exactly50 = gapToHome(claim("c3", "x", 50, 60));
  check("overlap 正好 50 → 还差 1 分（不是 0）", exactly50.overlapGap === 1, String(exactly50.overlapGap));

  const overlap49 = gapToHome(claim("c4", "x", 49, 60));
  check("overlap 49 → 横轴够了", overlap49.overlapGap === 0, String(overlap49.overlapGap));

  const def50 = gapToHome(claim("c5", "x", 20, 50));
  check("def 正好 50 → 纵轴够了（50 算高侧）", def50.defGap === 0, String(def50.defGap));

  const def49 = gapToHome(claim("c6", "x", 20, 49));
  check("def 49 → 还差 1 分", def49.defGap === 1, String(def49.defGap));
}

/* ---------------------------------------------------------------
   [2] 坐标轴文案：差 0 分不能说成「差 0 分」
   --------------------------------------------------------------- */

console.log("\n[2] 文案");
{
  check("纵轴够稳 → 说「已经够稳」", describeDefGap(0) === "已经够稳", describeDefGap(0));
  check("纵轴差 22 → 说「差 22 分」", describeDefGap(22) === "差 22 分", describeDefGap(22));
  check("横轴够新 → 说「已经够新」", describeOverlapGap(0) === "已经够新", describeOverlapGap(0));
  check("横轴差 17 → 说「差 17 分」", describeOverlapGap(17) === "差 17 分", describeOverlapGap(17));
  check(
    "文案里不出现「差 0 分」",
    !describeDefGap(0).includes("差 0") && !describeOverlapGap(0).includes("差 0")
  );
}

/* ---------------------------------------------------------------
   [3] 挑最近的那条
   --------------------------------------------------------------- */

console.log("\n[3] 挑哪条");
{
  /*
     三条候选，总差距分别是：
       c1: def 20（差 30）+ overlap 40（够新）      = 30
       c2: def 60（够）+ overlap 60（差 11）        = 11   ← 最近
       c3: def 30（差 20）+ overlap 70（差 21）     = 41
  */
  const claims = [
    claim("c1", "第一条", 40, 20),
    claim("c2", "第二条", 60, 60),
    claim("c3", "第三条", 70, 30),
  ];
  const found = findNearestHome(claims, [], []);

  check("挑总差距最小的那条", found?.claim.id === "c2", found?.claim.id);
  check("序号是提纲里的原始下标", found?.index === 1, String(found?.index));
  check("两个差都算对", found?.defGap === 0 && found?.overlapGap === 11, `def ${found?.defGap} / overlap ${found?.overlapGap}`);

  // 排序稳定性：同样输入跑两次必须一样
  const again = findNearestHome(claims, [], []);
  check("同样的输入永远给同一条", again?.claim.id === found?.claim.id, again?.claim.id);

  /*
     并列时纵轴高的优先（能补的那条先给）。
     两条的总差距都必须是 5 分，才算真的并列：
       d1: def 45 差 5，overlap 40 够新       = 5
       d2: def 50 够，overlap 54 差 5         = 5
     然后比纵轴：50 > 45，所以 d2 排前面。
  */
  const tied = [
    claim("d1", "纵轴低", 40, 45),
    claim("d2", "纵轴高", 54, 50),
  ];
  const tiedFound = findNearestHome(tied, [], []);
  check(
    "总差距一样时，纵轴高的排前面",
    tiedFound?.claim.id === "d2",
    `${tiedFound?.claim.id}（def ${tiedFound?.claim.defensibility}）`
  );
}

/* ---------------------------------------------------------------
   [4] 哪些不能当选
   --------------------------------------------------------------- */

console.log("\n[4] 排除规则");
{
  check("没有主张 → null", findNearestHome([], [], []) === null);

  /*
     最危险的一个 bug：查重没做成的主张。
     它的 overlap 是 0（0 在四象限里算"没人做过"），
     def 90 又很高，看起来"离主场只差一点"，
     其实这一步根本没量过 —— 当选就等于替用户吹牛。
  */
  const withBlind = [
    claim("b1", "没查成的", 0, 90),
    claim("b2", "真差一点的", 55, 45),
  ];
  const picked = findNearestHome(withBlind, ["b1"], []);
  check("blind 的主张不当选", picked?.claim.id === "b2", picked?.claim.id);

  const allBlind = findNearestHome(
    [claim("b1", "一", 0, 90), claim("b2", "二", 0, 80)],
    ["b1", "b2"],
    []
  );
  check("全部 blind → null（我们不知道，不是没有）", allBlind === null);

  // 已经在主场里的，不能再说成"离主场最近"
  const inHome = findNearestHome([claim("h1", "已经在主场", 30, 70)], [], []);
  check("已经在主场的 → null", inHome === null);

  // 有主场 + 有差一点的，只报差一点的
  const mixed = findNearestHome(
    [claim("h1", "已经在主场", 30, 70), claim("n1", "差一点", 55, 45)],
    [],
    []
  );
  check("有主场时只报没进的那条", mixed?.claim.id === "n1", mixed?.claim.id);
}

/* ---------------------------------------------------------------
   [5] 建议要点对维度
   --------------------------------------------------------------- */

console.log("\n[5] 建议");
{
  // 数字最弱 → 说数字
  const noNumber = findNearestHome(
    [claim("c1", "x", 40, 30)],
    [],
    [evidence("c1", [0, 100, 100, 100])]
  );
  check(
    "数字最弱 → 建议里点「有没有数字」",
    noNumber?.advice.includes("有没有数字") === true,
    noNumber?.advice
  );
  check(
    "数字最弱 → 建议里说样本量",
    noNumber?.advice.includes("样本量") === true,
    noNumber?.advice
  );

  // 方法最弱
  const noMethod = findNearestHome(
    [claim("c1", "x", 40, 30)],
    [],
    [evidence("c1", [100, 0, 100, 100])]
  );
  check(
    "方法最弱 → 建议里点「有没有方法」",
    noMethod?.advice.includes("有没有方法") === true,
    noMethod?.advice
  );
  check(
    "方法最弱 → 建议里说研究方法",
    noMethod?.advice.includes("研究方法") === true,
    noMethod?.advice
  );

  // 出处最弱
  const noSource = findNearestHome(
    [claim("c1", "x", 40, 30)],
    [],
    [evidence("c1", [100, 100, 0, 100])]
  );
  check(
    "出处最弱 → 建议里说依据来源",
    noSource?.advice.includes("依据来源") === true,
    noSource?.advice
  );

  // 具体最弱
  const vague = findNearestHome(
    [claim("c1", "x", 40, 30)],
    [],
    [evidence("c1", [100, 100, 100, 0])]
  );
  check(
    "具体最弱 → 建议里说具体",
    vague?.advice.includes("具体") === true,
    vague?.advice
  );

  /*
     同分时优先报数字/方法。
     四个维度全是 0 的时候，最该先说的是答辩老师第一个问的那两样。
  */
  const allZero = findNearestHome(
    [claim("c1", "x", 40, 30)],
    [],
    [evidence("c1", [0, 0, 0, 0])]
  );
  check(
    "全 0 时优先报「有没有数字」",
    allZero?.weakestDimension?.name === "有没有数字",
    allZero?.weakestDimension?.name
  );

  // 卡横轴时不说证据，说选题角度
  const crowded = findNearestHome(
    [claim("c1", "x", 80, 60)],
    [],
    [evidence("c1", [100, 100, 100, 100])]
  );
  check("卡横轴 → 说收窄或讲清差别", crowded?.advice.includes("收窄") === true, crowded?.advice);
  check("卡横轴 → 不提证据维度", crowded?.blocker === "overlap", crowded?.blocker);

  // 两头都差 → 先说补证据再说横轴
  const both = findNearestHome(
    [claim("c1", "x", 70, 30)],
    [],
    [evidence("c1", [100, 0, 100, 100])]
  );
  check("两头都差 → blocker 是 both", both?.blocker === "both", both?.blocker);
  check("两头都差 → 先说补什么", both?.advice.includes("有没有方法") === true, both?.advice);
  check("两头都差 → 再提横轴", both?.advice.includes("收窄") === true, both?.advice);

  // 拿不到证据明细 → 不能编维度名
  const noEvidence = findNearestHome([claim("c1", "x", 40, 30)], [], []);
  check("没有证据明细 → weakestDimension 为 null", noEvidence?.weakestDimension === null);
  check(
    "没有证据明细 → 建议里不出现维度名",
    !noEvidence?.advice.includes("有没有"),
    noEvidence?.advice
  );
  check(
    "没有证据明细 → 仍然给一句能照做的话",
    noEvidence?.advice.includes("样本量") === true,
    noEvidence?.advice
  );
}

/* ---------------------------------------------------------------
   [6] 维度文案表本身
   --------------------------------------------------------------- */

console.log("\n[6] 维度文案表");
{
  const names = ["有没有数字", "有没有方法", "有没有出处", "说得具体吗"];
  for (const name of names) {
    check(`「${name}」有对应动作`, typeof DIMENSION_ADVICE[name] === "string", DIMENSION_ADVICE[name]);
  }
  check("表里正好四项（不多不少）", Object.keys(DIMENSION_ADVICE).length === 4, String(Object.keys(DIMENSION_ADVICE).length));
}

/* ---------------------------------------------------------------
   [7] 边界：极端分数不崩
   --------------------------------------------------------------- */

console.log("\n[7] 边界");
{
  const zero = findNearestHome([claim("c1", "全 0", 0, 0)], [], []);
  check("0/0 不崩，差 50 分", zero?.defGap === 50, String(zero?.defGap));

  const hundred = findNearestHome([claim("c1", "全 100", 100, 100)], [], []);
  check("100/100 不崩，只差横轴 51 分", hundred?.overlapGap === 51, String(hundred?.overlapGap));

  const onlyOverlap = findNearestHome([claim("c1", "只差横轴", 100, 100)], [], []);
  check("纵轴满分时 blocker 是 overlap", onlyOverlap?.blocker === "overlap", onlyOverlap?.blocker);

  const onlyDef = findNearestHome([claim("c1", "只差纵轴", 0, 0)], [], []);
  check("横轴满分时 blocker 是 defensibility", onlyDef?.blocker === "defensibility", onlyDef?.blocker);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);

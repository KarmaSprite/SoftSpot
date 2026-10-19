/**
 * L2-B 质询生成的自检脚本。
 *
 * 全程不联网、不花钱：所有"模型返回"都是这里写死的字符串。
 *
 * 跑法：node scripts/check-question.mjs
 */

import { generateQuestions, detectBoring } from "../lib/question.ts";
import { buildQuestionMessages, QUESTION_SYSTEM_PROMPT } from "../lib/prompts.ts";
import { computeRisk, LEVEL_BASE } from "../lib/risk.ts";
import { defensibilityFromRisk } from "../lib/similarity.ts";

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

/* ---------------------------------------------------------------
   工具
   --------------------------------------------------------------- */

/** 假模型：永远返回同一段文字。 */
const fixed = (raw) => async () => raw;

/** 假模型：按顺序返回不同的文字，用完之后重复最后一条。 */
function sequence(raws) {
  let i = 0;
  const caller = async () => raws[Math.min(i++, raws.length - 1)];
  caller.calls = () => i;
  return caller;
}

/** 假模型：第 n 次调用抛错。 */
function failingAt(failIndex, raw) {
  let i = 0;
  const caller = async () => {
    if (i++ === failIndex) throw new Error("fetch failed");
    return raw;
  };
  return caller;
}

/** 记录每次调用的 system/user，方便断言。 */
function recorder(raw) {
  const seen = [];
  const caller = async (system, user) => {
    seen.push({ system, user });
    return raw;
  };
  caller.seen = seen;
  return caller;
}

/* ---------------------------------------------------------------
   测试数据
   --------------------------------------------------------------- */

const OUTLINE = `一、研究背景
高职院校学生的英语口语练习机会严重不足，班级人数多、课堂时间有限。

二、研究方法
拟采用大语言模型构建对话陪练系统，通过语音识别实现实时纠错。

三、预期成果
预期在一学期内收集 100 名学生数据，验证口语流利度提升。`;

function claim(id, text, type, defensibility) {
  return { id, text, type, location: "研究方法", overlap: 50, defensibility };
}

const C1 = claim("c1", "高职院校学生的英语口语练习机会严重不足", "problem", 72);
const C2 = claim("c2", "拟采用大语言模型构建对话陪练系统", "method", 41);
const C3 = claim("c3", "预期在一学期内收集 100 名学生数据，验证口语流利度提升", "expectation", 33);

/** 一条正常的问题返回。 */
const GOOD = JSON.stringify({
  questions: [
    {
      question: "嘈杂教室里的语音识别率大概会掉到多少？掉了怎么办？",
      why: "识别率是这个方案能不能用的前提，答不上来整条技术路线都站不住。",
      checklist: [
        "给出一个具体的识别率区间，最好有实测数据",
        "说明降噪方案，或者说明只在高信噪比场景使用",
        "承认极端环境下会失效，并给出兜底策略",
      ],
      level: "high",
    },
  ],
});

/** 两个问题的返回。 */
const TWO = JSON.stringify({
  questions: [
    {
      question: "这条路线 2023 年以来很多产品在做，你和他们差在哪一环？",
      why: "老师大概率见过类似方案，会直接问差异化。",
      checklist: ["能说出 2 个具体竞品", "讲清差在哪一环", "承认差距而不是硬说首创"],
      level: "high",
    },
    {
      question: "学生用这个系统的频率，你打算怎么保证？",
      why: "没人用的系统做出来也没数据。",
      checklist: ["给出具体的课程安排", "说明怎么统计使用次数", "给出激励措施"],
      level: "medium",
    },
  ],
});

/** 带套话的问题。 */
const BORING = JSON.stringify({
  questions: [
    {
      question: "请详细说明你的研究方法。",
      why: "老师想了解整体思路。",
      checklist: ["讲清步骤", "讲清数据来源", "讲清分析方法"],
      level: "low",
    },
  ],
});

/* ---------------------------------------------------------------
   1. 正常路径
   --------------------------------------------------------------- */

await (async () => {
  const r = await generateQuestions([C2], OUTLINE, fixed(GOOD));
  if (!r.ok) return fail("一条主张 → 一个问题", r.error);
  if (r.data.length !== 1) return fail("一条主张 → 一个问题", `期望 1 个，实际 ${r.data.length}`);
  const q = r.data[0];
  if (q.id !== "q1") return fail("一条主张 → 一个问题", `id 应该是 q1，实际 ${q.id}`);
  if (q.claimId !== "c2") return fail("一条主张 → 一个问题", `claimId 应该是 c2，实际 ${q.claimId}`);
  if (r.warnings.length !== 0) return fail("一条主张 → 一个问题", `不该有警告：${r.warnings.join("；")}`);
  pass("一条主张 → 一个问题", `id=${q.id} claimId=${q.claimId} risk=${q.risk}`);
})();

await (async () => {
  const r = await generateQuestions([C2], OUTLINE, fixed(TWO));
  if (!r.ok) return fail("一条主张 → 两个问题", r.error);
  if (r.data.length !== 2) return fail("一条主张 → 两个问题", `期望 2 个，实际 ${r.data.length}`);
  const ids = r.data.map((q) => q.id);
  if (ids.join(",") !== "q1,q2") return fail("一条主张 → 两个问题", `id 不连续：${ids.join(",")}`);
  pass("一条主张 → 两个问题", `id=${ids.join(",")}`);
})();

await (async () => {
  const r = await generateQuestions([C1, C2, C3], OUTLINE, fixed(GOOD));
  if (!r.ok) return fail("三条主张 → 三个问题，id 连续不跳号", r.error);
  const ids = r.data.map((q) => q.id);
  if (ids.join(",") !== "q1,q2,q3") return fail("三条主张 → 三个问题，id 连续不跳号", `实际 ${ids.join(",")}`);
  const claimIds = r.data.map((q) => q.claimId);
  if (claimIds.join(",") !== "c1,c2,c3") return fail("三条主张 → 三个问题，id 连续不跳号", `claimId 顺序不对：${claimIds.join(",")}`);
  pass("三条主张 → 三个问题，id 连续不跳号", `id=${ids.join(",")} claimId=${claimIds.join(",")}`);
})();

/* ---------------------------------------------------------------
   2. 调用次数和消息组装
   --------------------------------------------------------------- */

await (async () => {
  const caller = recorder(GOOD);
  await generateQuestions([C1, C2, C3], OUTLINE, caller);
  if (caller.seen.length !== 3) {
    return fail("三条主张就调三次模型", `实际调了 ${caller.seen.length} 次`);
  }
  pass("三条主张就调三次模型", "一次一条，不合并");
})();

await (async () => {
  const caller = recorder(GOOD);
  await generateQuestions([C2], OUTLINE, caller);
  const { user } = caller.seen[0];
  if (!user.includes(C2.text)) return fail("发给模型的消息里带上了这条主张", "user 里没有主张原文");
  if (!user.includes(OUTLINE)) return fail("发给模型的消息里带上了这条主张", "user 里没有完整提纲");
  if (!user.includes("method")) return fail("发给模型的消息里带上了这条主张", "user 里没有主张类型");
  pass("发给模型的消息里带上了这条主张", "主张原文 + 完整提纲 + 类型都在");
})();

await (async () => {
  const caller = recorder(GOOD);
  await generateQuestions([C2], OUTLINE, caller);
  if (caller.seen[0].system !== QUESTION_SYSTEM_PROMPT) {
    return fail("system 就是那份质询 prompt", "system 被改动了");
  }
  pass("system 就是那份质询 prompt", "规则和素材分开放");
})();

/* ---------------------------------------------------------------
   3. 危险等级换算（纯代码那一层）
   --------------------------------------------------------------- */

await (async () => {
  const r = await generateQuestions([C2], OUTLINE, fixed(GOOD));
  if (!r.ok) return fail("level=high 换成 75 分", r.error);
  // C2 的 defensibility=41 < 50，所以 +8 → 83
  if (r.data[0].risk !== 83) return fail("level=high 换成 75 分", `期望 83（75+8），实际 ${r.data[0].risk}`);
  pass("level=high 换成 75 分", "75 底分 + 8 没底修正 = 83");
})();

await (async () => {
  const r = await generateQuestions([C1], OUTLINE, fixed(GOOD));
  if (!r.ok) return fail("defensibility 够高时不加分", r.error);
  // C1 的 defensibility=72 >= 50，所以只取底分 75
  if (r.data[0].risk !== 75) return fail("defensibility 够高时不加分", `期望 75，实际 ${r.data[0].risk}`);
  pass("defensibility 够高时不加分", "只有底分 75");
})();

{
  const fatal = computeRisk("fatal", { defensibility: 80, hasWarning: false });
  const high = computeRisk("high", { defensibility: 80, hasWarning: false });
  const medium = computeRisk("medium", { defensibility: 80, hasWarning: false });
  const low = computeRisk("low", { defensibility: 80, hasWarning: false });
  const minor = computeRisk("minor", { defensibility: 80, hasWarning: false });
  const order = [fatal, high, medium, low, minor].map((r) => r.score);
  const sorted = [...order].sort((a, b) => b - a);
  if (order.join(",") !== sorted.join(",")) {
    fail("五档之间的顺序不能乱", order.join(" / "));
  } else {
    pass("五档之间的顺序不能乱", order.join(" > "));
  }
}

{
  /**
   * 这条是整套换算规则的"安全边界"：
   * 即使 medium 加满所有修正，也不能超过上一档（high）的底分。
   * 不然排序会跨档反超，"高危"这个词就没意义了。
   *
   * 五档之后这条更关键：最小档位间距只有 15 分，
   * 而两个修正加起来是 13 分 —— 只差 2 分，全靠 computeRisk 里的 cap 兜住。
   */
  const mediumMax = computeRisk("medium", { defensibility: 0, hasWarning: true });
  const highMin = computeRisk("high", { defensibility: 100, hasWarning: false });
  if (mediumMax.score >= highMin.score) {
    fail("medium 加满修正也不能超过 high 的底分", `${mediumMax.score} >= ${highMin.score}`);
  } else {
    pass("medium 加满修正也不能超过 high 的底分", `${mediumMax.score} < ${highMin.score}`);
  }
}

{
  /**
   * 每一档加满修正都不能顶到上一档头上。
   * 逐档检查，因为以后有人加新档位或改底分时，这一组会立刻炸。
   */
  const levels = ["fatal", "high", "medium", "low", "minor"];
  let broken = "";
  for (let i = 1; i < levels.length; i++) {
    const lowerMax = computeRisk(levels[i], { defensibility: 0, hasWarning: true });
    const upperMin = computeRisk(levels[i - 1], { defensibility: 100, hasWarning: false });
    if (lowerMax.score >= upperMin.score) {
      broken = `${levels[i]} 加满 ${lowerMax.score} >= ${levels[i - 1]} 底分 ${upperMin.score}`;
      break;
    }
  }
  if (broken) {
    fail("每一档加满修正都不跨档", broken);
  } else {
    pass("每一档加满修正都不跨档", "fatal > high > medium > low > minor 全程保持");
  }
}

{
  const r = computeRisk("fatal", { defensibility: 0, hasWarning: true });
  if (r.score !== 99) {
    fail("最高分不会顶到 100", `期望 99（95+8+5=108，夹到 99），实际 ${r.score}`);
  } else if (!r.reason.includes("95")) {
    fail("最高分不会顶到 100", `reason 里应该说明底分，实际：${r.reason}`);
  } else {
    pass("最高分不会顶到 100", r.reason);
  }
}

{
  /**
   * 纵轴能不能拉开，全看这一条：
   * 五档两两组合应该能算出足够多的不同分数。
   * 三档的时候这里只有 3 种结果，纵轴就是一条水平线。
   */
  const levels = ["fatal", "high", "medium", "low", "minor"];
  const scores = new Set();
  for (const a of levels) {
    for (const b of levels) {
      scores.add(defensibilityFromRisk([
        computeRisk(a, { defensibility: 80, hasWarning: false }).score,
        computeRisk(b, { defensibility: 80, hasWarning: false }).score,
      ]));
    }
  }
  if (scores.size < 6) {
    fail("五档两两组合至少能算出 6 种稳度", `只有 ${scores.size} 种：${[...scores].sort((x, y) => y - x).join(", ")}`);
  } else {
    pass("五档两两组合至少能算出 6 种稳度", `${scores.size} 种：${[...scores].sort((x, y) => y - x).join(", ")}`);
  }
}

{
  const r = computeRisk("low", { defensibility: 90, hasWarning: false });
  if (r.score !== LEVEL_BASE.low) {
    fail("最低分不会低于下限", `期望 ${LEVEL_BASE.low}，实际 ${r.score}`);
  } else {
    pass("最低分不会低于下限", `low = ${r.score}`);
  }
}

/* ---------------------------------------------------------------
   4. 套话检测
   --------------------------------------------------------------- */

await (async () => {
  const r = await generateQuestions([C2], OUTLINE, fixed(BORING));
  if (!r.ok) return fail("套话被检测出来并给警告", r.error);
  if (r.warnings.length === 0) return fail("套话被检测出来并给警告", "没有给出警告");
  if (!r.warnings[0].includes("套话")) return fail("套话被检测出来并给警告", `警告文案不对：${r.warnings[0]}`);
  pass("套话被检测出来并给警告", r.warnings[0].slice(0, 60));
})();

{
  const cases = [
    ["请详细说明你的研究方法。", true],
    ["你的创新点是什么？", true],
    ["谈谈你对这个领域的理解。", true],
    ["这个研究的理论意义在哪？", true],
    ["你认为有哪些不足？", true],
    ["嘈杂教室里的识别率会掉到多少？", false],
    ["你说的流利度提升，用什么指标衡量？", false],
  ];
  const wrong = cases.filter(([text, shouldHit]) => (detectBoring(text).length > 0) !== shouldHit);
  if (wrong.length > 0) {
    fail("套话检测不误伤正常问题", `判错：${wrong.map(([t]) => t).join(" / ")}`);
  } else {
    pass("套话检测不误伤正常问题", `${cases.length} 条全对`);
  }
}

/* ---------------------------------------------------------------
   5. 单条失败不拖垮整体
   --------------------------------------------------------------- */

await (async () => {
  const caller = failingAt(1, GOOD); // 第 2 次调用抛错
  const r = await generateQuestions([C1, C2, C3], OUTLINE, caller);
  if (!r.ok) return fail("中间一条失败，其余照常出结果", r.error);
  if (r.data.length !== 2) return fail("中间一条失败，其余照常出结果", `期望 2 个问题，实际 ${r.data.length}`);
  if (r.warnings.length === 0) return fail("中间一条失败，其余照常出结果", "没有给出警告");
  if (!r.warnings[0].includes("没问到")) return fail("中间一条失败，其余照常出结果", `警告文案不对：${r.warnings[0]}`);
  pass("中间一条失败，其余照常出结果", `出了 ${r.data.length} 个问题 + 1 条警告`);
})();

await (async () => {
  const r = await generateQuestions([C1, C2], OUTLINE, fixed("这个问题我需要更多信息。"));
  if (r.ok) return fail("全部失败才报错", "期望失败，实际成功了");
  if (!r.error.includes("全部")) return fail("全部失败才报错", `报错文案不对：${r.error}`);
  pass("全部失败才报错", r.error.slice(0, 70));
})();

await (async () => {
  const r = await generateQuestions([], OUTLINE, fixed(GOOD));
  if (r.ok) return fail("没有主张时直接报错", "期望失败，实际成功了");
  pass("没有主张时直接报错", r.error);
})();

/* ---------------------------------------------------------------
   6. schema 边界
   --------------------------------------------------------------- */

await (async () => {
  const three = JSON.stringify({
    questions: [1, 2, 3].map((i) => ({
      question: `问题 ${i}`,
      why: "因为",
      checklist: ["a", "b", "c"],
      level: "low",
    })),
  });
  const r = await generateQuestions([C2], OUTLINE, fixed(three));
  if (r.ok) return fail("模型给 3 个问题被拒绝", "期望失败，实际成功了");
  if (!r.error.includes("全部")) return fail("模型给 3 个问题被拒绝", `报错文案不对：${r.error}`);
  pass("模型给 3 个问题被拒绝", "上限 2 生效");
})();

await (async () => {
  const two = JSON.stringify({
    questions: [
      {
        question: "问题一？",
        why: "因为",
        checklist: ["a", "b"],
        level: "low",
      },
    ],
  });
  const r = await generateQuestions([C2], OUTLINE, fixed(two));
  if (r.ok) return fail("checklist 只有 2 条被拒绝", "期望失败，实际成功了");
  pass("checklist 只有 2 条被拒绝", "固定 3 条生效");
})();

await (async () => {
  const bad = JSON.stringify({
    questions: [
      {
        question: "问题？",
        why: "因为",
        checklist: ["a", "b", "c"],
        level: "高危",
      },
    ],
  });
  const r = await generateQuestions([C2], OUTLINE, fixed(bad));
  if (r.ok) return fail("level 写成中文被拒绝", "期望失败，实际成功了");
  pass("level 写成中文被拒绝", "只认 fatal/high/medium/low/minor");
})();

/* ---------------------------------------------------------------
   7. prompt 内容上锁
   --------------------------------------------------------------- */

{
  const p = QUESTION_SYSTEM_PROMPT;
  const checks = [
    ["给了套话反例", p.includes("✗")],
    ["给了好问题正例", p.includes("✓")],
    ["按三种类型分派追问方向", p.includes("problem") && p.includes("method") && p.includes("expectation")],
    ["限制 1-2 个问题", p.includes("1-2")],
    ["解释了三档 level 的标准", p.includes("high") && p.includes("medium") && p.includes("low")],
    ["要求 checklist 正好 3 条", p.includes("3 条")],
    ["明确不给分数", p.includes("不要直接给分数")],
  ];
  const broken = checks.filter(([, okFlag]) => !okFlag).map(([label]) => label);
  if (broken.length === 0) {
    pass("质询 prompt 里该有的段落都在", `${checks.length} 项检查全过`);
  } else {
    fail("质询 prompt 里该有的段落都在", `缺：${broken.join("、")}`);
  }
}

{
  const { user } = buildQuestionMessages(C2, OUTLINE);
  const checks = [
    ["带上完整提纲", user.includes(OUTLINE)],
    ["带上主张原文", user.includes(C2.text)],
    ["带上位置", user.includes(C2.location)],
    ["说明只针对这一条", user.includes("只针对")],
  ];
  const broken = checks.filter(([, okFlag]) => !okFlag).map(([label]) => label);
  if (broken.length === 0) {
    pass("质询消息组装正确", `${checks.length} 项全过`);
  } else {
    fail("质询消息组装正确", `缺：${broken.join("、")}`);
  }
}

/* ---------------------------------------------------------------
   收尾
   --------------------------------------------------------------- */

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

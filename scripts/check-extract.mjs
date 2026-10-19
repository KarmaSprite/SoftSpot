/**
 * L1 抽取的自检脚本。
 *
 * 全程不联网、不花钱：所有"模型返回"都是这里写死的字符串。
 * 这是把 callModel 做成参数换来的好处 —— 没有 key 也能测完整条链路。
 *
 * 跑法：node scripts/check-extract.mjs
 */

import { extractClaims, MAX_OUTLINE_LENGTH, MIN_OUTLINE_LENGTH } from "../lib/extract.ts";
import { EXTRACT_SYSTEM_PROMPT, buildExtractMessages } from "../lib/prompts.ts";

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

/** 假模型：不管问什么都返回同一段文字。 */
const fixed = (raw) => async () => raw;

/** 假模型：直接抛错，模拟网络断了。 */
const throwing = (message) => async () => {
  throw new Error(message);
};

/** 假模型：把收到的 user 消息记下来，方便断言 prompt 组装对不对。 */
function recorder(raw) {
  const seen = [];
  const caller = async (system, user) => {
    seen.push({ system, user });
    return raw;
  };
  caller.seen = seen;
  return caller;
}

/** 期望抽取成功。 */
async function ok(name, outline, caller, expect) {
  const result = await extractClaims(outline, caller);
  if (!result.ok) {
    fail(name, `期望成功，实际失败：${result.error}`);
    return;
  }
  if (expect) {
    const problem = expect(result);
    if (problem) {
      fail(name, problem);
      return;
    }
  }
  pass(name);
}

/** 期望抽取失败，并且错误信息里要出现某个关键词。 */
async function bad(name, outline, caller, keyword) {
  const result = await extractClaims(outline, caller);
  if (result.ok) {
    fail(name, `期望失败，实际成功，抽了 ${result.data.claims.length} 条`);
    return;
  }
  if (!result.error.includes(keyword)) {
    fail(name, `错误信息里没有「${keyword}」：${result.error}`);
    return;
  }
  /**
   * 报错信息可能有两行（"不符合要求" + 具体哪个字段错了）。
   * 只打第一行的话，看到的永远是一句"不符合要求"，等于没说。
   * 这里把多行压成一行显示，超过 100 字截断。
   */
  const brief = result.error.replace(/\s*\n\s*/g, " ｜ ");
  pass(name, brief.length > 100 ? brief.slice(0, 100) + "…" : brief);
}

/* ---------------------------------------------------------------
   测试数据
   --------------------------------------------------------------- */

/** 一段够长的提纲（超过 MIN_OUTLINE_LENGTH），后面几个用例共用。 */
const OUTLINE = `一、研究背景
近年来，随着人工智能技术快速发展，教育领域发生了深刻变革。高职院校学生的英语口语练习机会严重不足，班级人数多、课堂时间有限，学生一学期开口次数屈指可数。

二、研究问题
如何用技术手段为高职学生提供足够的、低压力的口语练习机会。

三、研究方法
拟采用大语言模型构建对话陪练系统，通过语音识别与生成技术实现实时纠错。

四、预期成果
预期在一学期内收集 100 名学生数据，验证口语流利度提升。`;

/** 一份"完美"的模型返回：6 条主张，全部照抄原文。 */
const GOOD_JSON = JSON.stringify({
  claims: [
    {
      id: "c1",
      text: "高职院校学生的英语口语练习机会严重不足",
      type: "problem",
      location: "研究背景 第 1 段",
    },
    {
      id: "c2",
      text: "班级人数多、课堂时间有限，学生一学期开口次数屈指可数",
      type: "problem",
      location: "研究背景 第 1 段",
    },
    {
      id: "c3",
      text: "如何用技术手段为高职学生提供足够的、低压力的口语练习机会",
      type: "problem",
      location: "研究问题",
    },
    {
      id: "c4",
      text: "拟采用大语言模型构建对话陪练系统",
      type: "method",
      location: "研究方法",
    },
    {
      id: "c5",
      text: "通过语音识别与生成技术实现实时纠错",
      type: "method",
      location: "研究方法",
    },
    {
      id: "c6",
      text: "预期在一学期内收集 100 名学生数据，验证口语流利度提升",
      type: "expectation",
      location: "预期成果",
    },
  ],
});

/* ---------------------------------------------------------------
   1. 正常路径
   --------------------------------------------------------------- */

await ok("干净的 JSON，6 条主张全部对上原文", OUTLINE, fixed(GOOD_JSON), (r) => {
  if (r.data.claims.length !== 6) return `期望 6 条，实际 ${r.data.claims.length} 条`;
  if (r.warnings.length !== 0) return `不该有警告，实际：${r.warnings.join("；")}`;
  return null;
});

await ok("```json 代码块包裹也能解析", OUTLINE, fixed("```json\n" + GOOD_JSON + "\n```"), (r) =>
  r.data.claims.length === 6 ? null : `期望 6 条，实际 ${r.data.claims.length} 条`,
);

await ok(
  "前后有废话也能解析",
  OUTLINE,
  fixed("好的，我来分析一下：\n```json\n" + GOOD_JSON + "\n```\n以上是我的分析。"),
  (r) => (r.data.claims.length === 6 ? null : `期望 6 条，实际 ${r.data.claims.length} 条`),
);

/* ---------------------------------------------------------------
   2. 原文核对（纯代码那一层）
   --------------------------------------------------------------- */

await ok(
  "模型改写了措辞 → 通过但给警告",
  OUTLINE,
  fixed(
    JSON.stringify({
      claims: [
        {
          id: "c1",
          text: "高职学生的英语口语练习机会非常缺乏",
          type: "problem",
          location: "研究背景",
        },
      ],
    }),
  ),
  (r) => {
    if (r.warnings.length === 0) return "改写过的措辞应该给出警告，实际没有";
    if (!r.warnings[0].includes("找不到")) return `警告文案不对：${r.warnings[0]}`;
    return null;
  },
);

await ok(
  "大部分对不上 → 合并成一句警告，不刷屏",
  OUTLINE,
  fixed(
    JSON.stringify({
      claims: [
        { id: "c1", text: "编造的主张甲", type: "problem", location: "研究背景" },
        { id: "c2", text: "编造的主张乙", type: "problem", location: "研究背景" },
        { id: "c3", text: "编造的主张丙", type: "method", location: "研究方法" },
        { id: "c4", text: "拟采用大语言模型构建对话陪练系统", type: "method", location: "研究方法" },
      ],
    }),
  ),
  (r) => {
    if (r.warnings.length !== 1) return `期望 1 条合并警告，实际 ${r.warnings.length} 条`;
    if (!r.warnings[0].includes("可能不可靠")) return `警告文案不对：${r.warnings[0]}`;
    return null;
  },
);

await ok(
  "标点符号不同不算对不上",
  OUTLINE,
  fixed(
    JSON.stringify({
      claims: [
        {
          id: "c1",
          // 原文是「班级人数多、课堂时间有限，学生一学期开口次数屈指可数」
          // 这里换成逗号、去掉顿号，语义完全一样，不该报警告
          text: "班级人数多 课堂时间有限 学生一学期开口次数屈指可数",
          type: "problem",
          location: "研究背景",
        },
      ],
    }),
  ),
  (r) => (r.warnings.length === 0 ? null : `不该有警告，实际：${r.warnings.join("；")}`),
);

/* ---------------------------------------------------------------
   3. 模型返回不合格
   --------------------------------------------------------------- */

await bad(
  "type 冒出第四种",
  OUTLINE,
  fixed(
    JSON.stringify({
      claims: [{ id: "c1", text: "x", type: "innovation", location: "研究背景" }],
    }),
  ),
  "claims.0.type",
);

await bad("空字符串", OUTLINE, fixed(""), "空字符串");

await bad(
  "被截断在半个对象上",
  OUTLINE,
  fixed('{"claims":[{"id":"c1","text":"高职院校学生的口语练习机会'),
  "括号没闭合",
);

await bad("只回了一句人话", OUTLINE, fixed("这个问题我需要更多信息才能分析。"), "找不到 { 或 [");

await bad("模型抛异常（网络断了）", OUTLINE, throwing("fetch failed"), "调用模型失败");

await bad("模型抛异常（key 错了）", OUTLINE, throwing("401 Unauthorized"), "调用模型失败");

/* ---------------------------------------------------------------
   4. 输入检查（这些情况不该花钱调模型）
   --------------------------------------------------------------- */

await bad("空提纲", "", fixed(GOOD_JSON), "提纲是空的");

await bad("提纲太短", "研究口语", fixed(GOOD_JSON), "太短了");

await bad("提纲超长", "研究".repeat(MAX_OUTLINE_LENGTH), fixed(GOOD_JSON), "超过");

{
  // 长度检查必须在调模型之前 —— 不然超长输入也会先花一次钱
  const caller = recorder(GOOD_JSON);
  await extractClaims("短", caller);
  if (caller.seen.length === 0) {
    pass("太短的输入没有去调模型", "省下一次调用");
  } else {
    fail("太短的输入没有去调模型", `实际调了 ${caller.seen.length} 次`);
  }
}

/* ---------------------------------------------------------------
   5. prompt 本身的内容（给 prompt 上锁）
   --------------------------------------------------------------- */

{
  const p = EXTRACT_SYSTEM_PROMPT;
  const checks = [
    ["提到三种类型", p.includes("problem") && p.includes("method") && p.includes("expectation")],
    ["写了什么不算主张", p.includes("什么不算主张")],
    ["给了反例", p.includes("✗")],
    ["要求照抄原文", p.includes("照抄")],
    ["要求宁少不凑", p.includes("宁少不凑")],
    ["要求只输出 JSON", p.includes("只输出")],
  ];
  const broken = checks.filter(([, okFlag]) => !okFlag).map(([label]) => label);
  if (broken.length === 0) {
    pass("prompt 里该有的段落都在", `${checks.length} 项检查全过`);
  } else {
    fail("prompt 里该有的段落都在", `缺：${broken.join("、")}`);
  }
}

{
  const { system, user } = buildExtractMessages("这是一份提纲");
  if (system !== EXTRACT_SYSTEM_PROMPT) {
    fail("组装消息时 system 就是那份 prompt", "system 被改动了");
  } else if (!user.includes("这是一份提纲")) {
    fail("组装消息时 system 就是那份 prompt", "user 里没有带上提纲原文");
  } else if (user.includes("什么不算主张")) {
    fail("组装消息时 system 就是那份 prompt", "规则被塞进了 user 消息，两者混在一起了");
  } else {
    pass("组装消息时 system 就是那份 prompt", "规则和素材分开放");
  }
}

/* ---------------------------------------------------------------
   收尾
   --------------------------------------------------------------- */

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

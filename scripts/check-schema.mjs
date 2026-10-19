/**
 * schema 自检脚本。
 *
 * 为什么需要它：schema 是"运行时的锁"，锁坏了平时看不出来，
 * 要等模型返回脏数据那一刻才暴露，那时候已经在线上了。
 * 这里把好数据和坏数据各喂一遍，两分钟内就能确认锁还活着。
 *
 * 跑法：node scripts/check-schema.mjs
 */

import {
  AnalysisResultSchema,
  ExtractResultSchema,
  QuestionSchema,
  formatIssues,
} from "../lib/schema.ts";

let passed = 0;
let failed = 0;

/** 断言：期望校验通过，并且可以顺便检查转换后的值。 */
function ok(name, schema, input, expect) {
  const result = schema.safeParse(input);
  if (!result.success) {
    failed++;
    console.log(`✗ ${name}`);
    console.log(`  期望通过，实际被拒：\n  ${formatIssues(result.error)}`);
    return;
  }
  if (expect) {
    const problem = expect(result.data);
    if (problem) {
      failed++;
      console.log(`✗ ${name}`);
      console.log(`  ${problem}`);
      return;
    }
  }
  passed++;
  console.log(`✓ ${name}`);
}

/** 断言：期望校验失败，并且报错信息里要出现某个关键词。 */
function bad(name, schema, input, keyword) {
  const result = schema.safeParse(input);
  if (result.success) {
    failed++;
    console.log(`✗ ${name}`);
    console.log(`  期望被拒，实际通过了`);
    return;
  }
  const message = formatIssues(result.error);
  if (keyword && !message.includes(keyword)) {
    failed++;
    console.log(`✗ ${name}`);
    console.log(`  报错信息里没有「${keyword}」：\n  ${message}`);
    return;
  }
  passed++;
  console.log(`✓ ${name}`);
  console.log(`  → ${message.split("\n")[0]}`);
}

/* ---------------------------------------------------------------
   测试数据
   --------------------------------------------------------------- */

const goodClaim = {
  id: "c1",
  text: "高职院校学生英语口语练习机会严重不足",
  type: "problem",
  location: "研究背景 第 1 段",
  overlap: 88,
  defensibility: 72,
};

const goodQuestion = {
  id: "q1",
  claimId: "c1",
  question: "「练习机会不足」这个判断，你有数据支撑吗？",
  why: "研究问题必须建立在证据上。",
  checklist: ["给出至少一个数据来源", "说明样本量和调查时间", "还没做就说清打算怎么做"],
  risk: 63,
};

/* ---------------------------------------------------------------
   1. L1 抽取
   --------------------------------------------------------------- */

ok("合法的主张通过校验", ExtractResultSchema, {
  claims: [{ id: "c1", text: "口语练习机会不足", type: "problem", location: "第 1 段" }],
});

ok(
  "多余的字段被悄悄丢掉，不报错",
  ExtractResultSchema,
  { claims: [{ id: "c1", text: "x", type: "method", location: "第 1 段", overlap: 99 }] },
  (data) => ("overlap" in data.claims[0] ? "多余的 overlap 没被丢掉" : null),
);

bad(
  "第四种主张类型被拒绝",
  ExtractResultSchema,
  { claims: [{ id: "c1", text: "x", type: "innovation", location: "第 1 段" }] },
  "claims.0.type",
);

bad(
  "主张原文是空白字符串被拒绝",
  ExtractResultSchema,
  { claims: [{ id: "c1", text: "   ", type: "problem", location: "第 1 段" }] },
  "claims.0.text",
);

bad("主张数组为空被拒绝", ExtractResultSchema, { claims: [] }, "claims");

/* ---------------------------------------------------------------
   2. 分数容错
   --------------------------------------------------------------- */

ok(
  "88.7 被取整成 89",
  AnalysisResultSchema,
  { claims: [{ ...goodClaim, overlap: 88.7 }], questions: [goodQuestion] },
  (data) => (data.claims[0].overlap === 89 ? null : `实际是 ${data.claims[0].overlap}`),
);

ok(
  "150 被夹到 100，-5 被夹到 0",
  AnalysisResultSchema,
  {
    claims: [{ ...goodClaim, overlap: 150, defensibility: -5 }],
    questions: [goodQuestion],
  },
  (data) =>
    data.claims[0].overlap === 100 && data.claims[0].defensibility === 0
      ? null
      : `实际是 ${data.claims[0].overlap} / ${data.claims[0].defensibility}`,
);

ok(
  '字符串 "88" 被转成数字 88',
  AnalysisResultSchema,
  { claims: [{ ...goodClaim, overlap: "88" }], questions: [goodQuestion] },
  (data) => (data.claims[0].overlap === 88 ? null : `实际是 ${data.claims[0].overlap}`),
);

bad(
  "分数是 abc 时被拒绝",
  AnalysisResultSchema,
  { claims: [{ ...goodClaim, overlap: "abc" }], questions: [goodQuestion] },
  "claims.0.overlap",
);

/* ---------------------------------------------------------------
   3. L2-B 质询
   --------------------------------------------------------------- */

ok("合法的问题通过校验", QuestionSchema, goodQuestion);

bad(
  "及格线只有 2 条被拒绝",
  QuestionSchema,
  { ...goodQuestion, checklist: ["a", "b"] },
  "checklist",
);

bad(
  "及格线有 4 条也被拒绝",
  QuestionSchema,
  { ...goodQuestion, checklist: ["a", "b", "c", "d"] },
  "checklist",
);

bad("问题缺 why 字段被拒绝", QuestionSchema, { ...goodQuestion, why: undefined }, "why");

/* ---------------------------------------------------------------
   4. 跨字段检查
   --------------------------------------------------------------- */

bad(
  "问题指向不存在的主张被拒绝",
  AnalysisResultSchema,
  { claims: [goodClaim], questions: [{ ...goodQuestion, claimId: "c9" }] },
  "c9 不存在",
);

ok("问题和主张对得上时通过", AnalysisResultSchema, {
  claims: [goodClaim],
  questions: [goodQuestion],
});

/* ---------------------------------------------------------------
   5. 报错信息本身要能看懂
   --------------------------------------------------------------- */

const broken = AnalysisResultSchema.safeParse({
  claims: [{ ...goodClaim, type: "innovation" }],
  questions: [],
});
if (broken.success) {
  failed++;
  console.log("✗ 报错信息是人话");
} else {
  const text = formatIssues(broken.error);
  const lines = text.split("\n");
  const humanReadable =
    lines.every((line) => line.includes(": ")) && text.includes("claims.0.type");
  if (humanReadable) {
    passed++;
    console.log("✓ 报错信息是人话");
    console.log(`  → ${lines[0]}`);
  } else {
    failed++;
    console.log("✗ 报错信息是人话");
    console.log(`  ${text}`);
  }
}

/* ---------------------------------------------------------------
   收尾
   --------------------------------------------------------------- */

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

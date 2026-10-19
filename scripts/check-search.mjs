/**
 * 多源降级的自检。
 *
 * 这里最该测的不是"两个源都正常时会怎样" —— 那是理所当然的。
 * 最该测的是**源挂掉时会不会骗人**：
 *   - arXiv 超时了，Crossref 查到了，分数该不该照常给？
 *   - 两个都超时了，分数该不该标成不可信？
 *   - 一个源返回"0 篇"，那算答话了还是没答话？
 *
 * 这三个问题答错任何一个，用户就会把"我不知道"读成"没人做过"。
 *
 * 跑法：npm run check:search（不联网、不花钱）
 */

import { searchAllClaims, searchClaim, REAL_SEARCHERS } from "../lib/search.ts";

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

/** 造一条主张。 */
function makeClaim(id, text) {
  return {
    id,
    text,
    type: "method",
    location: "第 1 段",
    overlap: 50,
    defensibility: 50,
  };
}

const CLAIM = makeClaim("c1", "用镜头语言训练提升高职学生的视频叙事能力");

const INTENT = {
  claimId: "c1",
  phrase: "shot language",
  keywords: ["shot language", "video narrative", "vocational education"],
  zhQuery: "镜头语言 视频叙事 高职",
};

/* ---------- 造假的检索结果 ---------- */

function arxivOk(hits) {
  return async () => ({ ok: true, hits, totalResults: hits.length, warnings: [] });
}

function arxivFail(message = "arXiv 超过 15 秒没回话，这次跳过") {
  return async () => ({ ok: false, error: message });
}

function arxivThrow(message = "网络直接断了") {
  return async () => {
    throw new Error(message);
  };
}

function crossrefOk(hits) {
  return async () => ({ ok: true, hits, totalResults: hits.length, warnings: [] });
}

function crossrefFail(message = "Crossref 返回了空内容") {
  return async () => ({ ok: false, error: message });
}

const ARXIV_HIT = {
  id: "2608.06932",
  title: "Shot Language Training for Vocational Students",
  summary: "",
  year: "2026",
  authors: ["A"],
  url: "https://arxiv.org/abs/2608.06932",
};

const CROSSREF_HIT = {
  doi: "10.1080/13636820.2023.7654321",
  title: "Video Narrative Ability in Vocational Education",
  year: "2023",
  authors: ["B"],
  journal: "Journal of Vocational Education",
  url: "https://doi.org/10.1080/13636820.2023.7654321",
};

console.log("\n=== 多源降级自检 ===\n");

// ---------- 1. 两个源都正常 ----------

console.log("[1] 两个源都正常：分数照常，两个源都算答话");
{
  const result = await searchClaim(CLAIM, INTENT, {
    arxiv: arxivOk([ARXIV_HIT]),
    crossref: crossrefOk([CROSSREF_HIT]),
  });

  check("查成功了", result.ok === true);
  if (result.ok) {
    const data = result.data;
    console.log(`  分数 ${data.overlap.score}，理由：${data.overlap.reason}`);
    check("分数可信", data.trustworthy === true);
    check("两个源都答话了", data.sources.filter((s) => s.answered).length === 2);
    check("有分数", data.overlap.score > 0, String(data.overlap.score));
    check("有最像的那一篇", data.overlap.bestHit !== null);
    check("原始命中数 = 2", data.rawHitCount === 2, String(data.rawHitCount));
    check("sourcesAnswered 是 2", data.overlap.sourcesAnswered === 2, String(data.overlap.sourcesAnswered));
  }
}

// ---------- 2. arXiv 挂了 ----------

console.log("\n[2] arXiv 挂了、Crossref 正常：分数照给，但要说清是只算了一个库");
{
  const result = await searchClaim(CLAIM, INTENT, {
    arxiv: arxivFail(),
    crossref: crossrefOk([CROSSREF_HIT]),
  });

  check("整条没失败", result.ok === true);
  if (result.ok) {
    const data = result.data;
    console.log(`  分数 ${data.overlap.score}，理由：${data.overlap.reason}`);
    check("分数仍然可信（有一个源答话了）", data.trustworthy === true);
    check("sourcesAnswered 是 1", data.overlap.sourcesAnswered === 1, String(data.overlap.sourcesAnswered));
    check("arXiv 标记为没答话", data.sources.find((s) => s.name === "arXiv")?.answered === false);
    check("arXiv 的失败原因被记下来了", (data.sources.find((s) => s.name === "arXiv")?.error ?? "").length > 0);
    check("Crossref 标记为答话", data.sources.find((s) => s.name === "Crossref")?.answered === true);
    check("分数不是 0（Crossref 查到了东西）", data.overlap.score > 0, String(data.overlap.score));
  }
}

// ---------- 3. Crossref 挂了 ----------

console.log("\n[3] Crossref 挂了、arXiv 正常：反过来也一样");
{
  const result = await searchClaim(CLAIM, INTENT, {
    arxiv: arxivOk([ARXIV_HIT]),
    crossref: crossrefFail(),
  });

  check("整条没失败", result.ok === true);
  if (result.ok) {
    check("分数仍然可信", result.data.trustworthy === true);
    check("Crossref 标记为没答话", result.data.sources.find((s) => s.name === "Crossref")?.answered === false);
    check("arXiv 有命中", result.data.sources.find((s) => s.name === "arXiv")?.hitCount === 1);
  }
}

// ---------- 4. 两个源都挂了 ----------

console.log("\n[4] 两个源都挂了：分数必须标成不可信，且明说原因");
{
  const result = await searchClaim(CLAIM, INTENT, {
    arxiv: arxivFail(),
    crossref: crossrefFail(),
  });

  check("整条仍然没失败（不能因为查不到就不出报告）", result.ok === true);
  if (result.ok) {
    const data = result.data;
    console.log(`  分数 ${data.overlap.score}，理由：${data.overlap.reason}`);
    check("trustworthy = false", data.trustworthy === false);
    check("分数是 0", data.overlap.score === 0, String(data.overlap.score));
    check("sourcesAnswered = 0", data.overlap.sourcesAnswered === 0);
    check("理由里明说分数不算数", data.overlap.reason.includes("不算数"), data.overlap.reason);
    check("没有最像的那一篇（不编一个出来）", data.overlap.bestHit === null);
  }
}

// ---------- 5. 源答话了但一篇都没查到 ----------

console.log("\n[5] 源答话了但 0 篇：这是「查了没有」，不是「没查成」");
{
  const result = await searchClaim(CLAIM, INTENT, {
    arxiv: arxivOk([]),
    crossref: crossrefOk([]),
  });

  check("整条没失败", result.ok === true);
  if (result.ok) {
    const data = result.data;
    console.log(`  理由：${data.overlap.reason}`);
    check("trustworthy = true（答话了）", data.trustworthy === true);
    check("分数是 0", data.overlap.score === 0, String(data.overlap.score));
    check("理由说的是「查了没有」不是「不算数」", data.overlap.reason.includes("一篇都没查到"), data.overlap.reason);
    check("两个源都算答话", data.sources.every((s) => s.answered) === true);
    check("命中数是 0", data.rawHitCount === 0, String(data.rawHitCount));
  }
}

// ---------- 6. 检索器直接抛异常 ----------

console.log("\n[6] 检索器直接抛异常（不是返回 ok:false）：也要接住");
{
  const result = await searchClaim(CLAIM, INTENT, {
    arxiv: arxivThrow(),
    crossref: crossrefThrowSafe(),
  });

  check("整条没失败", result.ok === true);
  if (result.ok) {
    check("两个源都标记为没答话", result.data.sources.every((s) => !s.answered) === true);
    check("trustworthy = false", result.data.trustworthy === false);
    check("失败原因被记下来了", result.data.sources.some((s) => s.error.length > 0));
  }
}

async function crossrefThrowSafe() {
  throw new Error("Crossref 也断了");
}

// ---------- 7. 没有检索意图 ----------

console.log("\n[7] 没有检索意图：这是流程坏了，不是「查了没有」");
{
  const result = await searchClaim(CLAIM, null, {
    arxiv: arxivOk([]),
    crossref: crossrefOk([]),
  });

  check("返回 ok: false", result.ok === false);
  if (!result.ok) {
    check("错误信息说清是没翻出检索词", result.error.includes("没翻出"), result.error);
  }
}

// ---------- 8. 批量：一条坏不影响其他 ----------

console.log("\n[8] 批量：一条主张查挂了，其他照常出结果");
{
  const claims = [
    makeClaim("c1", "第一条主张"),
    makeClaim("c2", "第二条主张"),
    makeClaim("c3", "第三条主张"),
  ];
  const intents = [
    { ...INTENT, claimId: "c1" },
    { ...INTENT, claimId: "c2" },
    { ...INTENT, claimId: "c3" },
  ];

  const result = await searchAllClaims(claims, intents, {
    arxiv: arxivFail("这次故意让 arXiv 全挂"),
    crossref: crossrefOk([CROSSREF_HIT]),
  });

  check("三条都出了结果", result.byClaimId.size === 3, String(result.byClaimId.size));
  check("每个结果都有分数", [...result.byClaimId.values()].every((v) => v.overlap.score >= 0));
  check(
    "每条都仍然可信（arXiv 全挂，但 Crossref 答话了）",
    [...result.byClaimId.values()].every((v) => v.trustworthy === true),
  );
  check(
    "每条都只有一个源答话",
    [...result.byClaimId.values()].every((v) => v.overlap.sourcesAnswered === 1),
  );
  check("arXiv 的失败被记成警告", result.warnings.some((w) => w.includes("arXiv")), result.warnings.slice(0, 2).join(" | "));
  console.log(`  警告 ${result.warnings.length} 条，第一条：${result.warnings[0]}`);
}

// ---------- 9. 批量：缺少检索意图 ----------

console.log("\n[9] 批量：某条主张没有检索意图，只跳过那一条");
{
  const claims = [makeClaim("c1", "有意图的主张"), makeClaim("c2", "没意图的主张")];
  const intents = [{ ...INTENT, claimId: "c1" }];

  const result = await searchAllClaims(claims, intents, {
    arxiv: arxivOk([ARXIV_HIT]),
    crossref: crossrefOk([]),
  });

  check("只出了 1 条结果", result.byClaimId.size === 1, String(result.byClaimId.size));
  check("出结果的是 c1", result.byClaimId.has("c1"));
  check("c2 没被编一个结果出来", !result.byClaimId.has("c2"));
  check("有警告说明 c2 没查成", result.warnings.some((w) => w.includes("没查成")), result.warnings.join(" | "));
  check("minSourcesAnswered 被拉到 0（有条目完全没查）", result.minSourcesAnswered === 0, String(result.minSourcesAnswered));
}

// ---------- 10. 真检索器形状检查 ----------

console.log("\n[10] 真检索器：不联网，只确认形状对");
{
  check("REAL_SEARCHERS 有 arxiv", typeof REAL_SEARCHERS.arxiv === "function");
  check("REAL_SEARCHERS 有 crossref", typeof REAL_SEARCHERS.crossref === "function");

  // 空查询串不该发出去
  const empty = await REAL_SEARCHERS.arxiv("");
  check("空查询被本地拦住，不浪费一次请求", empty.ok === false && empty.error.includes("空的"), JSON.stringify(empty).slice(0, 80));
}

// ---------- 汇总 ----------

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);

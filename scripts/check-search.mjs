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

/*
   中文网页的三个假实现。

   为什么每个用例都必须显式给一个：
   第 14b 步之后，英文库分数低于 25 时会去查中文网页。
   不给的话 `searchers.web` 是 undefined，一调就抛，
   整条被记成"中文查挂了" —— 那不是被测代码的错，是用例没写全。

   webOff 是最常用的：模拟"没配 key，主动跳过"，
   这样老的用例行为跟第 14b 之前完全一样。
*/
function webOff() {
  return async () => ({ ok: false, error: "没配 DEEPSEEK_API_KEY，联网搜索这一步跳过", skipped: true });
}

function webOk(hits) {
  return async () => ({ ok: true, hits, rawCount: hits.length, warnings: [] });
}

function webFail(message = "联网搜索超过 15 秒没回话，这次跳过") {
  return async () => ({ ok: false, error: message, skipped: false });
}

/** 一个假的中文网页命中。站点故意用「龙源期刊网」—— 学术站点，不打折。 */
const WEB_HIT = {
  key: "longyuan.com/1",
  title: "高职院校镜头语言课程教学改革研究",
  snippet: "镜头语言 高职 教学改革",
  url: "https://longyuan.com/1",
  site: "龙源期刊网",
  authority: 3,
  date: "2024-05-01T00:00:00+00:00",
};

/** 另一个：站点是 CSDN，要打折。 */
const WEB_PAGE_HIT = {
  key: "blog.csdn.net/2",
  title: "镜头语言 视频叙事 高职 教学笔记",
  snippet: "随手记",
  url: "https://blog.csdn.net/2",
  site: "CSDN",
  authority: 2,
  date: "",
};

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
    web: webOff(),
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
    web: webOff(),
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
    web: webOff(),
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
    web: webOff(),
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
    web: webOff(),
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
    web: webOff(),
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
    web: webOff(),
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
    web: webOff(),
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
    web: webOff(),
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
  check("REAL_SEARCHERS 有 web", typeof REAL_SEARCHERS.web === "function");

  // 空查询串不该发出去
  const empty = await REAL_SEARCHERS.arxiv("");
  check("空查询被本地拦住，不浪费一次请求", empty.ok === false && empty.error.includes("空的"), JSON.stringify(empty).slice(0, 80));

  // 中文搜索也一样：空查询不花钱
  const emptyWeb = await REAL_SEARCHERS.web("");
  check("中文搜索的空查询也被拦住", emptyWeb.ok === false, JSON.stringify(emptyWeb).slice(0, 80));
}

// ---------- 11. 分数够高时不花中文搜索的钱 ----------

console.log("\n[11] 英文库已经查到撞车了：不该再花 0.005 元去查中文");
{
  let webCalls = 0;
  const countingWeb = async () => {
    webCalls += 1;
    return { ok: true, hits: [WEB_HIT], rawCount: 1, warnings: [] };
  };

  const result = await searchClaim(CLAIM, INTENT, {
    arxiv: arxivOk([ARXIV_HIT]),
    crossref: crossrefOk([CROSSREF_HIT]),
    web: countingWeb,
  });

  check("整条没失败", result.ok === true);
  check("中文检索器一次都没被调用", webCalls === 0, `被调了 ${webCalls} 次`);

  if (result.ok) {
    check("webStatus 是 off", result.data.webStatus === "off", result.data.webStatus);
    check("webHitCount 是 0", result.data.webHitCount === 0, String(result.data.webHitCount));
    check("sources 里没有「中文网页」这一项", !result.data.sources.some((s) => s.name === "中文网页"));
  }
}

// ---------- 12. 英文库查空时才补查中文 ----------

console.log("\n[12] 英文库一篇都没查到：这时候才值得花钱补中文");
{
  let webCalls = 0;
  const countingWeb = async () => {
    webCalls += 1;
    return { ok: true, hits: [WEB_HIT], rawCount: 1, warnings: [] };
  };

  const result = await searchClaim(CLAIM, INTENT, {
    arxiv: arxivOk([]),
    crossref: crossrefOk([]),
    web: countingWeb,
  });

  check("整条没失败", result.ok === true);
  check("中文检索器被调了 1 次", webCalls === 1, `被调了 ${webCalls} 次`);

  if (result.ok) {
    const data = result.data;
    console.log(`  分数 ${data.overlap.score}，理由：${data.overlap.reason}`);
    check("webStatus 是 ok", data.webStatus === "ok", data.webStatus);
    check("webHitCount 是 1", data.webHitCount === 1, String(data.webHitCount));
    check("sources 里有「中文网页」且答话了", data.sources.find((s) => s.name === "中文网页")?.answered === true);
    check("分数被中文命中顶上去了", data.overlap.score > 0, String(data.overlap.score));
    check(
      "最像的那一篇来自 web",
      data.overlap.bestHit !== null && data.overlap.bestHit.source === "web",
      data.overlap.bestHit?.source ?? "null",
    );
    check(
      "「中文网页」不算进 sourcesAnswered",
      data.overlap.sourcesAnswered === 2,
      String(data.overlap.sourcesAnswered),
    );
  }
}

// ---------- 13. 网页要打折 ----------

console.log("\n[13] 同一句话，学术站点不打折、博客打 0.7 折");
{
  /*
     用两个站点跑同一条标题，看分数差多少。
     标题故意写成一模一样 —— 这样分数差只可能来自权重。
  */
  const sharedTitle = "镜头语言 视频叙事 高职 教学";
  const asPaper = { ...WEB_HIT, key: "a.com/1", title: sharedTitle, site: "龙源期刊网" };
  const asBlog = { ...WEB_PAGE_HIT, key: "b.com/2", title: sharedTitle, site: "CSDN" };

  const paperResult = await searchClaim(CLAIM, INTENT, {
    arxiv: arxivOk([]),
    crossref: crossrefOk([]),
    web: webOk([asPaper]),
  });
  const blogResult = await searchClaim(CLAIM, INTENT, {
    arxiv: arxivOk([]),
    crossref: crossrefOk([]),
    web: webOk([asBlog]),
  });

  const paperScore = paperResult.ok ? paperResult.data.overlap.score : -1;
  const blogScore = blogResult.ok ? blogResult.data.overlap.score : -1;

  console.log(`  学术站点 ${paperScore} 分，博客 ${blogScore} 分`);
  check("学术站点的分数更高", paperScore > blogScore, `${paperScore} vs ${blogScore}`);
  check(
    "博客的分数大约是学术站点的 0.7 倍",
    Math.abs(blogScore / paperScore - 0.7) < 0.08,
    `比值 ${(blogScore / paperScore).toFixed(2)}`,
  );
}

// ---------- 14. 中文搜索失败不影响英文库的分数 ----------

console.log("\n[14] 中文搜索挂了：英文库的分数照常，只是少一个参考");
{
  const result = await searchClaim(CLAIM, INTENT, {
    arxiv: arxivOk([]),
    crossref: crossrefOk([]),
    web: webFail("联网搜索超过 15 秒没回话，这次跳过"),
  });

  check("整条没失败", result.ok === true);
  if (result.ok) {
    const data = result.data;
    check("webStatus 是 failed", data.webStatus === "failed", data.webStatus);
    check("分数仍然是 0（英文库真的没查到）", data.overlap.score === 0, String(data.overlap.score));
    check("trustworthy 仍然是 true（英文库答话了）", data.trustworthy === true);
    check("「中文网页」被记成没答话", data.sources.find((s) => s.name === "中文网页")?.answered === false);
    check(
      "失败原因被记下来了",
      (data.sources.find((s) => s.name === "中文网页")?.error ?? "").length > 0,
    );
  }
}

// ---------- 15. 没配 key 时是 skipped 不是 failed ----------

console.log("\n[15] 没配 key：跳过，不是失败");
{
  const result = await searchClaim(CLAIM, INTENT, {
    arxiv: arxivOk([]),
    crossref: crossrefOk([]),
    web: webOff(),
  });

  check("整条没失败", result.ok === true);
  if (result.ok) {
    const data = result.data;
    check("webStatus 是 skipped", data.webStatus === "skipped", data.webStatus);
    check("sources 里没有「中文网页」（跳过不记成故障）", !data.sources.some((s) => s.name === "中文网页"));
    check("分数仍然是 0", data.overlap.score === 0, String(data.overlap.score));
  }
}

// ---------- 16. 批量时算清楚花了几次搜索钱 ----------

console.log("\n[16] 批量：只有真发出去的中文搜索才计费");
{
  const claims = [
    makeClaim("c1", "英文库查空的主张"),
    makeClaim("c2", "英文库查到撞车的主张"),
    makeClaim("c3", "英文库查空、但中文没配 key 的主张"),
  ];
  const intents = [
    { ...INTENT, claimId: "c1" },
    { ...INTENT, claimId: "c2" },
    { ...INTENT, claimId: "c3" },
  ];

  /*
     c1 用真返回（计费）、c2 分数够高不查（不计费）、c3 返回 skipped（不计费）。
     但三条共用一个 searchers.web，所以按调用次数来分：
     用一个会看查询词的假实现区分不了，改成按顺序返回不同结局。
  */
  let call = 0;
  const stagedWeb = async () => {
    call += 1;
    if (call === 1) return { ok: true, hits: [WEB_HIT], rawCount: 1, warnings: [] };
    return { ok: false, error: "没配 DEEPSEEK_API_KEY，联网搜索这一步跳过", skipped: true };
  };

  const result = await searchAllClaims(claims, intents, {
    arxiv: arxivOk([]),
    crossref: crossrefOk([]),
    web: stagedWeb,
  });

  console.log(`  三条主张，中文搜索被调了 ${call} 次，计费 ${result.webSearchCalls} 次`);
  check("三条都出了结果", result.byClaimId.size === 3, String(result.byClaimId.size));
  check("计费次数不超过实际调用次数", result.webSearchCalls <= call, `${result.webSearchCalls} > ${call}`);
  check("skipped 的那次不计费", result.webSearchCalls < call, `计费 ${result.webSearchCalls}，调用 ${call}`);
  check("计费次数 ≥ 1（有一条真查了）", result.webSearchCalls >= 1, String(result.webSearchCalls));
}

// ---------- 17. 中文网页不能把「主判定」抬起来 ----------

console.log("\n[17] 英文库全挂、只有中文查到：分数仍然不可信");
{
  const result = await searchClaim(CLAIM, INTENT, {
    arxiv: arxivFail(),
    crossref: crossrefFail(),
    web: webOk([WEB_HIT]),
  });

  check("整条没失败", result.ok === true);
  if (result.ok) {
    const data = result.data;
    console.log(`  分数 ${data.overlap.score}，理由：${data.overlap.reason}`);
    check("trustworthy = false", data.trustworthy === false);
    check("sourcesAnswered = 0", data.overlap.sourcesAnswered === 0, String(data.overlap.sourcesAnswered));
    check("理由说的是「不算数」", data.overlap.reason.includes("不算数"), data.overlap.reason);
    check(
      "中文网页的命中没有混进最像的那一篇",
      data.overlap.bestHit === null,
      data.overlap.bestHit?.title ?? "null",
    );
  }
}

// ---------- 汇总 ----------

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);

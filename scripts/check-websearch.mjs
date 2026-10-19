/**
 * DeepSeek 联网搜索自检。
 *
 * 跟 check-arxiv.mjs 不一样：这个脚本**默认不联网、不花钱**。
 * 理由：这一步要验的核心是降级逻辑（没配 key 跳过、401、超时、429、去重），
 * 而这些用注入的假 fetch 就能全测到。真联网只留一组，放在最后，
 * 而且没配 key 时自动跳过。
 *
 * 想真跑一次：在 pre-defense 目录下先设好 DEEPSEEK_API_KEY，再
 *   npm run check:websearch
 * 会多花 0.005 元。
 *
 * 跑法：npm run check:websearch
 */

import {
  DEFAULT_COUNT,
  PRICE_PER_CALL,
  dedupeWebHits,
  estimateSearchCost,
  isWebSearchConfigured,
  normalizeUrl,
  searchChinese,
} from "../lib/websearch.ts";

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

/** 造一个假 fetch，返回指定状态码和 body。 */
function fakeFetch(status, body, options = {}) {
  return async () => {
    if (options.throwTimeout) {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    }
    if (options.throwNetwork) {
      throw new Error("fetch failed");
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  };
}

/** 一条合法的搜索结果，字段按实测结构。 */
function sampleResult(overrides = {}) {
  return {
    title: "高职院校短视频创作课程混合式教学改革策略",
    site_name: "知网",
    authority: 4,
    date: "2025-06-01T00:00:00+00:00",
    url: "https://example.com/a/12345",
    summary: "这是一段很长的摘要，实测有一千多字，这里只放一句代表。",
    snippet: "短视频创作课程 混合式教学 高职",
    content: "",
    ...overrides,
  };
}

console.log("\n=== DeepSeek 联网搜索自检（默认不联网） ===\n");

/* ---------------------------------------------------------------
   [1] url 归一化
   --------------------------------------------------------------- */

console.log("[1] url 归一化");
{
  check(
    "http 和 https 当成一回事",
    normalizeUrl("http://example.com/a") === normalizeUrl("https://example.com/a"),
  );
  check("去掉末尾斜杠", normalizeUrl("https://example.com/a/") === "example.com/a");
  check("去掉锚点", normalizeUrl("https://example.com/a#1") === "example.com/a");
  check("去掉 www.", normalizeUrl("https://www.example.com/a") === "example.com/a");
  check(
    "真实 url 带多重锚点也能归一化",
    normalizeUrl("https://wxycb.gpnu.edu.cn/__local/5/69/79/4A.pdf#51#10") ===
      "wxycb.gpnu.edu.cn/__local/5/69/79/4a.pdf",
  );
}

/* ---------------------------------------------------------------
   [2] 去重
   --------------------------------------------------------------- */

console.log("\n[2] 去重");
{
  const sameUrl = dedupeWebHits([
    { key: "example.com/a", title: "标题甲", snippet: "", url: "https://example.com/a", site: "A", authority: 3, date: "" },
    { key: "example.com/a", title: "标题乙", snippet: "", url: "http://example.com/a/", site: "B", authority: 3, date: "" },
  ]);
  check("同一个 url 只留一条", sameUrl.length === 1);

  const sameTitle = dedupeWebHits([
    { key: "a.com/1", title: "高职院校短视频创作课程混合式教学改革策略", snippet: "", url: "https://a.com/1", site: "A", authority: 3, date: "" },
    { key: "b.com/2", title: "高职院校短视频创作课程混合式教学改革策略", snippet: "", url: "https://b.com/2", site: "B", authority: 3, date: "" },
  ]);
  check("标题相同（长标题）也当重复", sameTitle.length === 1);

  const shortTitles = dedupeWebHits([
    { key: "a.com/1", title: "课程简介", snippet: "", url: "https://a.com/1", site: "A", authority: 3, date: "" },
    { key: "b.com/2", title: "课程简介", snippet: "", url: "https://b.com/2", site: "B", authority: 3, date: "" },
  ]);
  check("短标题不参与标题去重（避免误伤）", shortTitles.length === 2);
}

/* ---------------------------------------------------------------
   [3] 没配 key → skipped: true
   --------------------------------------------------------------- */

console.log("\n[3] 没配 key 必须干净跳过");
{
  const outcome = await searchChinese("高职 教学", { apiKey: "" });

  check("ok: false", outcome.ok === false);
  check("skipped: true（不是普通失败）", outcome.ok === false && outcome.skipped === true);
  check(
    "文案说清是没配 key，不是程序坏了",
    outcome.ok === false && outcome.error.includes("没配"),
    outcome.ok === false ? outcome.error : "",
  );
  check("isWebSearchConfigured 对空 key 返回 false", isWebSearchConfigured("") === false);
  check("isWebSearchConfigured 对正常 key 返回 true", isWebSearchConfigured("sk-abc") === true);
}

/* ---------------------------------------------------------------
   [4] 正常返回
   --------------------------------------------------------------- */

console.log("\n[4] 正常返回能解析出字段");
{
  const outcome = await searchChinese("高职 短视频 教学", {
    apiKey: "sk-test",
    fetchImpl: fakeFetch(200, { results: [sampleResult()] }),
  });

  check("ok: true", outcome.ok === true);

  if (outcome.ok) {
    check("拿到 1 条", outcome.hits.length === 1);
    const hit = outcome.hits[0];
    check("title 取到了", hit.title.includes("短视频"));
    check("site 取到了", hit.site === "知网");
    check("authority 是数字", hit.authority === 4);
    check("snippet 优先于 summary", hit.snippet.includes("混合式教学"));
    check("key 是归一化 url", hit.key === "example.com/a/12345");
    check("rawCount 记录原始条数", outcome.rawCount === 1);
    check("没有警告", outcome.warnings.length === 0);
  }
}

/* ---------------------------------------------------------------
   [5] 查成功但一条都没有 → ok: true
   --------------------------------------------------------------- */

console.log("\n[5] 查了但一条都没有，仍然算查成了");
{
  const outcome = await searchChinese("冷门到没有的词", {
    apiKey: "sk-test",
    fetchImpl: fakeFetch(200, { results: [] }),
  });

  check("ok: true（不是失败）", outcome.ok === true);
  if (outcome.ok) {
    check("hits 是空数组", outcome.hits.length === 0);
    check("给了一句警告说明没查到", outcome.warnings.length === 1);
    check(
      "警告文案带上了查询词",
      outcome.warnings[0].includes("冷门到没有的词"),
      outcome.warnings[0],
    );
  }
}

/* ---------------------------------------------------------------
   [6] 各种失败
   --------------------------------------------------------------- */

console.log("\n[6] 失败要分得清是哪一种");
{
  const e401 = await searchChinese("高职 教学", {
    apiKey: "sk-test",
    fetchImpl: fakeFetch(401, { error: { message: "Authentication Fails" } }),
  });
  check("401 → ok: false", e401.ok === false);
  check("401 → skipped: false（是故障不是跳过）", e401.ok === false && e401.skipped === false);
  check(
    "401 文案指向 key",
    e401.ok === false && e401.error.includes("key"),
    e401.ok === false ? e401.error : "",
  );

  const e429 = await searchChinese("高职 教学", {
    apiKey: "sk-test",
    fetchImpl: fakeFetch(429, { error: { message: "rate limit" } }),
  });
  check("429 → ok: false", e429.ok === false);
  check(
    "429 文案说查太快",
    e429.ok === false && e429.error.includes("太快"),
    e429.ok === false ? e429.error : "",
  );

  const e402 = await searchChinese("高职 教学", {
    apiKey: "sk-test",
    fetchImpl: fakeFetch(402, { error: { message: "Insufficient Balance" } }),
  });
  check(
    "402 文案说余额不足",
    e402.ok === false && e402.error.includes("余额"),
    e402.ok === false ? e402.error : "",
  );

  const e500 = await searchChinese("高职 教学", {
    apiKey: "sk-test",
    fetchImpl: fakeFetch(503, "Service Unavailable"),
  });
  check("503 → ok: false", e500.ok === false);
  check(
    "5xx 文案说服务端出错",
    e500.ok === false && e500.error.includes("服务端"),
    e500.ok === false ? e500.error : "",
  );

  const eTimeout = await searchChinese("高职 教学", {
    apiKey: "sk-test",
    timeoutMs: 3000,
    fetchImpl: fakeFetch(200, {}, { throwTimeout: true }),
  });
  check("超时 → ok: false", eTimeout.ok === false);
  check(
    "超时文案带上了秒数",
    eTimeout.ok === false && eTimeout.error.includes("3 秒"),
    eTimeout.ok === false ? eTimeout.error : "",
  );

  const eNet = await searchChinese("高职 教学", {
    apiKey: "sk-test",
    fetchImpl: fakeFetch(200, {}, { throwNetwork: true }),
  });
  check("连不上 → ok: false", eNet.ok === false);
  check(
    "连不上文案说连不上",
    eNet.ok === false && eNet.error.includes("连不上"),
    eNet.ok === false ? eNet.error : "",
  );

  const eEmpty = await searchChinese("   ", { apiKey: "sk-test" });
  check("空查询词直接拒绝，不发请求", eEmpty.ok === false);
  check(
    "空查询词文案说清楚",
    eEmpty.ok === false && eEmpty.error.includes("空"),
    eEmpty.ok === false ? eEmpty.error : "",
  );
}

/* ---------------------------------------------------------------
   [7] 坏数据不能把整个请求搞崩
   --------------------------------------------------------------- */

console.log("\n[7] 脏数据要能扛住");
{
  const outcome = await searchChinese("高职 教学", {
    apiKey: "sk-test",
    fetchImpl: fakeFetch(200, {
      results: [
        { title: "没有 url 的条目", site_name: "A" },
        { url: "https://example.com/ok", title: "正常条目" },
        { title: "", url: "https://example.com/empty-title" },
        null,
      ],
    }),
  });

  check("脏数据不影响整体 ok: true", outcome.ok === true);
  if (outcome.ok) {
    check("缺 url 的丢掉", !outcome.hits.some((h) => h.title === "没有 url 的条目"));
    check("缺标题的丢掉", !outcome.hits.some((h) => h.url.includes("empty-title")));
    check("正常那条留着", outcome.hits.some((h) => h.title === "正常条目"));
    check("rawCount 记的是原始条数（4）", outcome.rawCount === 4);
  }

  const noResults = await searchChinese("高职 教学", {
    apiKey: "sk-test",
    fetchImpl: fakeFetch(200, {}),
  });
  check("响应里连 results 字段都没有 → 当作 0 条", noResults.ok === true);
  check("→ hits 是空数组", noResults.ok === true && noResults.hits.length === 0);
}

/* ---------------------------------------------------------------
   [8] 计费换算
   --------------------------------------------------------------- */

console.log("\n[8] 计费换算");
{
  check("单价是 0.005 元/次", PRICE_PER_CALL === 0.005);
  check("1 次 = 0.005 元", estimateSearchCost(1) === 0.005);
  check("10 次 = 0.05 元", estimateSearchCost(10) === 0.05);
  check("8 条主张各查 1 次 = 0.04 元", estimateSearchCost(8) === 0.04);
  check("0 次 = 0 元", estimateSearchCost(0) === 0);
  check("默认取 6 条", DEFAULT_COUNT === 6);
}

/* ---------------------------------------------------------------
   [9] 真联网（没配 key 自动跳过）
   --------------------------------------------------------------- */

console.log("\n[9] 真联网查一次（没配 key 就跳过，会花 0.005 元）");
{
  if (!isWebSearchConfigured()) {
    console.log("  · 当前环境没有 DEEPSEEK_API_KEY，跳过这一组");
    console.log("  · 这正好证明了「没配 key 能跳过」这件事本身");
  } else {
    const outcome = await searchChinese("高职院校 短视频 教学改革 研究");

    if (!outcome.ok) {
      console.log(`  ! 这一步没查成：${outcome.error}`);
      console.log("  ! 网络或余额问题不算代码错");
      failed += 1;
    } else {
      check("ok: true", outcome.ok === true);
      check(`拿到 ${outcome.hits.length} 条（要求 ≥1）`, outcome.hits.length >= 1);

      const first = outcome.hits[0];
      if (first) {
        check("第一条有标题", first.title.length > 0);
        check("第一条有 url", first.url.startsWith("http"));
        check("第一条有站点名", first.site.length > 0);
        /*
          断言的是 key 而不是 url。
          实测 DeepSeek 返回的 url 常带 `#1` 这种锚点（它自己的索引标记），
          url 保留原样是为了用户点开能落到真实页面；
          去重用的 key 才需要归一化，锚点在那里被去掉。
          一开始我把这条断言写成检查 url，跑出来是假失败。
        */
        check("去重用的 key 里没有锚点", !first.key.includes("#"));
        console.log(`  · 第一条：《${first.title.slice(0, 40)}》`);
        console.log(`  · 站点：${first.site}（权威度 ${first.authority}）`);
      }

      const titles = outcome.hits.map((h) => h.title).join(" ");
      const looksChinese = /[\u4e00-\u9fa5]/.test(titles);
      check("返回的是中文内容（这是它存在的理由）", looksChinese);
    }
  }
}

/* ---------------------------------------------------------------
   收尾
   --------------------------------------------------------------- */

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exitCode = 1;
}

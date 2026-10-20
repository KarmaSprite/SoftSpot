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
  buildWebQuery,
  cleanTitle,
  dedupeWebHits,
  estimateSearchCost,
  isWebSearchConfigured,
  looksLikePaper,
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
   [10] 拼查询词
   --------------------------------------------------------------- */

console.log("\n[10] 拼查询词：必须加「研究 论文」，否则查回来是课程广告");
{
  const intent = {
    claimId: "c1",
    phrase: "shot language",
    keywords: ["shot language", "video narrative"],
    zhQuery: "镜头语言 叙事能力 高职",
  };

  const query = buildWebQuery(intent);
  console.log(`  · ${JSON.stringify(query)}`);
  check("加上了「研究」", query.includes("研究"));
  check("加上了「论文」", query.includes("论文"));
  check("原来的中文词还在", query.includes("镜头语言"));
  check("结果以原词开头（核心词在前）", query.startsWith("镜头语言"));

  // zhQuery 里已经有「研究」时不该重复
  const withResearch = { ...intent, zhQuery: "行动研究 高职 短视频" };
  const q2 = buildWebQuery(withResearch);
  console.log(`  · ${JSON.stringify(q2)}`);
  check("已有的「研究」不重复加", (q2.match(/研究/g) ?? []).length === 1, q2);
  check("「论文」还是要加", q2.includes("论文"));

  // zhQuery 里已经两个词都有
  const withBoth = { ...intent, zhQuery: "高职 教学 研究 论文" };
  const q3 = buildWebQuery(withBoth);
  check("两个词都有时一个都不重复加", q3 === "高职 教学 研究 论文", q3);

  // 多余空格要压掉
  const messy = { ...intent, zhQuery: "  镜头语言   高职  " };
  check("多余空格被压成一个", buildWebQuery(messy) === "镜头语言 高职 研究 论文", buildWebQuery(messy));
}

/* ---------------------------------------------------------------
   [11] 洗标题
   --------------------------------------------------------------- */

console.log("\n[11] 洗标题：站名、期刊期号、重复标题都要去掉");
{
  /*
     这些全是真实样本，来自第 14a 步实测的三组查询。
     每一条都注明了为什么要洗它。
  */
  const cases = [
    {
      raw: "短视频融入高职院校思政课教学策略研究-淮南职业技术学院学报2025年02期-手机知网",
      expect: "短视频融入高职院校思政课教学策略研究",
      why: "站名 + 期刊期号要剥掉",
    },
    {
      raw: "高职院校短视频创作课程混合式教学改革策略 - 高职院校短视频创作课程混合式教学改",
      expect: "高职院校短视频创作课程混合式教学改革策略",
      why: "「标题 - 标题」重复要合掉",
    },
    {
      raw: "高职院校「短视频+N」网络育人模式的实践路径探索 - 期刊文献+",
      expect: "高职院校「短视频+N」网络育人模式的实践路径探索",
      why: "「期刊文献+」是站内标记不是标题",
    },
    {
      raw: "试论电视新闻叙事技巧和镜头语言 - 试论电视新闻叙事技巧和镜头语言",
      expect: "试论电视新闻叙事技巧和镜头语言",
      why: "完全重复的标题",
    },
    {
      raw: "短视频资源融入高职英语听说教学的实践策略与效果评估 - - 收藏",
      expect: "短视频资源融入高职英语听说教学的实践策略与效果评估",
      why: "「- - 收藏」是列表页残留",
    },
    {
      raw: "高职动画剧本创作课程信息化教学设计与实践：提升原创叙事能力与镜头语言素养 - CSD",
      expect: "高职动画剧本创作课程信息化教学设计与实践：提升原创叙事能力与镜头语言素养",
      why: "尾部被截断的英文站名（CSDN 截成 CSD）",
    },
    {
      raw: "视觉聚焦-手机知网",
      expect: "视觉聚焦",
      why: "短标题也能剥掉站名",
    },
    {
      raw: "某论文标题（被引量：4）",
      expect: "某论文标题",
      why: "「被引量：4」是元信息",
    },
  ];

  for (const item of cases) {
    const got = cleanTitle(item.raw);
    check(item.why, got === item.expect, `得到 ${JSON.stringify(got)}`);
  }

  // 干净的标题不该被改坏
  const clean = "高职院校短视频创作课程混合式教学改革策略";
  check("干净的标题原样返回", cleanTitle(clean) === clean, cleanTitle(clean));

  // 空串和纯空白不能崩
  check("空串返回空串", cleanTitle("") === "");
  check("纯空白返回空串", cleanTitle("   ") === "");
}

/* ---------------------------------------------------------------
   [12] 判断是不是论文
   --------------------------------------------------------------- */

console.log("\n[12] 判断是不是论文：决定打不打折");
{
  const paperSites = ["手机知网", "维普网", "万方", "龙源期刊网", "钛学术", "CNKI", "Napstic"];
  for (const site of paperSites) {
    check(
      `站点「${site}」算论文`,
      looksLikePaper({ site, title: "随便一个标题" }) === true,
      site,
    );
  }

  check(
    "站点不认识但标题带「学报」也算论文",
    looksLikePaper({ site: "某学院官网", title: "某某职业技术学院学报目录" }) === true,
  );
  check(
    "标题带「期刊」也算",
    looksLikePaper({ site: "某站", title: "某某期刊投稿指南" }) === true,
  );

  check(
    "CSDN 笔记算网页（要打折）",
    looksLikePaper({ site: "CSDN", title: "镜头语言 学习笔记" }) === false,
  );
  check(
    "学校新闻算网页",
    looksLikePaper({ site: "青岛酒店管理职业技术学院", title: "最美学院 | 艺术学院举办课堂" }) === false,
  );
  check(
    "未知站点算网页",
    looksLikePaper({ site: "（未知站点）", title: "从大量实践经验来看" }) === false,
  );
  check(
    "站点名大小写不影响判断",
    looksLikePaper({ site: "cnki", title: "x" }) === true,
  );
}

/* ---------------------------------------------------------------
   收尾
   --------------------------------------------------------------- */

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exitCode = 1;
}

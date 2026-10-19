/**
 * Crossref 检索自检：真联网跑。
 *
 * 跑法：npm run check:crossref
 * 耗时约 15 秒（Crossref 会间歇返回空内容，重试要等 4 秒）。
 */

import { searchCrossref, searchCrossrefMany } from "../lib/crossref.ts";

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

console.log("\n=== Crossref 检索自检（真联网） ===\n");

// ---------- 1. 参数校验 ----------

console.log("[1] 空检索词直接拒绝");
{
  const outcome = await searchCrossref("   ");
  check("返回 ok: false", outcome.ok === false);
  check(
    "错误文案说得清楚",
    outcome.ok === false && outcome.error.includes("空的"),
    outcome.ok === false ? outcome.error : "",
  );
}

// ---------- 2. 真查职教相关 ----------

console.log("\n[2] 真查：vocational education short video");
{
  const outcome = await searchCrossref("vocational education short video", { rows: 3 });

  if (!outcome.ok) {
    console.log(`  ! 没查成：${outcome.error}`);
    failed += 1;
  } else {
    check("ok: true", outcome.ok === true);
    check(`拿到 ${outcome.hits.length} 条（要求 ≥1）`, outcome.hits.length >= 1);

    const first = outcome.hits[0];
    if (first) {
      check("DOI 格式对（10.xxxx/...）", /^10\.\d{4,9}\//.test(first.doi), first.doi);
      check("title 是字符串不是数组", typeof first.title === "string" && first.title.length > 0);
      check("url 指向 doi.org", first.url.startsWith("https://doi.org/"), first.url);
      check(
        "年份是四位数字或空",
        first.year === "" || /^\d{4}$/.test(first.year),
        `实际 "${first.year}"`,
      );

      console.log("\n  第一条长这样：");
      console.log(`    标题：${first.title}`);
      console.log(`    期刊：${first.journal || "（没取到）"}`);
      console.log(`    年份：${first.year || "（没取到）"}`);
      console.log(`    DOI：${first.doi}`);
      console.log(`    链接：${first.url}`);
    }

    console.log(`\n  ⚠️ totalResults = ${outcome.totalResults}`);
    console.log("     这个数很大是正常的，它不代表'这么多人都做过这个题目'");
  }
}

// ---------- 3. 查不到的词 ----------

console.log("\n[3] 查一个乱码词，确认是「查了没结果」而不是「查询失败」");
{
  const outcome = await searchCrossref("zzqqxxwvv nonexishtent gibberish", { rows: 3 });

  if (!outcome.ok) {
    console.log(`  ! 没查成：${outcome.error}（网络问题，跳过）`);
    failed += 1;
  } else {
    check("ok 仍为 true", outcome.ok === true);
    console.log(`  拿到 ${outcome.hits.length} 条（乱码也可能撞上模糊匹配，不强制为 0）`);
    console.log(`  totalResults = ${outcome.totalResults}`);
  }
}

// ---------- 4. 中文能不能查 ----------

console.log("\n[4] 中文关键词能查出什么（记录事实，不是断言好坏）");
{
  const outcome = await searchCrossref("高职 短视频 教学", { rows: 3 });

  if (!outcome.ok) {
    console.log(`  ! 没查成：${outcome.error}`);
  } else {
    console.log(`  拿到 ${outcome.hits.length} 条，totalResults = ${outcome.totalResults}`);
    for (const hit of outcome.hits.slice(0, 3)) {
      console.log(`    (${hit.year || "?"}) ${hit.title.slice(0, 62)}`);
    }
    const chinese = outcome.hits.filter((h) => /[\u4e00-\u9fa5]/.test(h.title));
    check(
      `至少有 1 条是中文标题（实际 ${chinese.length}/${outcome.hits.length}）`,
      chinese.length >= 1,
    );
    console.log("  实测结论：Crossref 里确实有中文期刊（注册了 DOI 就会进来）");
    console.log("  但准确度不稳：「镜头语言 教学」会混进汉语言教学、生态语言学的论文");
    console.log("  所以当加分项用，真正的兜底还是第 19 步让用户自己粘");
  }
}

// ---------- 5. 连查三个词，确认限速和重试都在工作 ----------

console.log("\n[5] 连查三个词，确认限速和空响应重试都生效");
{
  const started = Date.now();
  const results = await searchCrossrefMany(
    [
      "action research vocational education",
      "shot language film education",
      "teaching evaluation video",
    ],
    { rows: 2 },
  );
  const elapsed = Date.now() - started;

  check("返回了 3 组结果", results.length === 3);
  check(`耗时 ${Math.round(elapsed / 1000)} 秒，≥2 秒说明间隔真的在等`, elapsed >= 2000);

  let okCount = 0;
  let retried = 0;
  for (const { query, outcome } of results) {
    if (outcome.ok) {
      okCount += 1;
      if (outcome.warnings.length > 0) retried += 1;
      console.log(`  · ${query}  → ${outcome.hits.length} 条`);
      for (const hit of outcome.hits) {
        console.log(`      (${hit.year || "?"}) ${hit.title.slice(0, 58)}`);
      }
    } else {
      console.log(`  · ${query}  → 失败：${outcome.error}`);
    }
  }

  check(`三个词至少成功两个（实际 ${okCount}/3）`, okCount >= 2);
  if (retried > 0) {
    console.log(`  （其中 ${retried} 次触发了空响应重试，说明重试逻辑真的用上了）`);
  }
}

// ---------- 6. arXiv vs Crossref 命中对比 ----------

console.log("\n[6] 同一个词在两个源各查一次，看为什么要两个都接");
{
  const { searchArxiv } = await import("../lib/arxiv.ts");
  const query = "vocational education video";
  const cr = await searchCrossref(query, { rows: 2 });

  // arXiv 会给慢查询留 15 秒超时，这里重试一次；
  // 还是失败就照实写下来 —— 那本身就是"为什么要两个源"的证据。
  let ax = await searchArxiv(`all:vocational AND all:education AND all:video`, { maxResults: 2 });
  if (!ax.ok) {
    console.log(`  （arXiv 第一次没回：${ax.error}，再试一次）`);
    ax = await searchArxiv(`all:vocational AND all:education AND all:video`, { maxResults: 2 });
  }

  console.log(`  Crossref「${query}」→ ${cr.ok ? `${cr.hits.length} 条（库内 total ${cr.totalResults}）` : `失败：${cr.error}`}`);
  console.log(`  arXiv「${query}」    → ${ax.ok ? `${ax.hits.length} 条（库内 total ${ax.totalResults}）` : `失败：${ax.error}`}`);
  console.log("  两个源的收录范围完全不同：Crossref 收正式期刊，arXiv 收理工预印本");
  console.log("  实测 arXiv 还会偶发超时 —— 所以第 13 步必须两个都查，一个挂了另一个还能出结果");
}

// ---------- 汇总 ----------

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);

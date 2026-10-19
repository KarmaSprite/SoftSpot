/**
 * arXiv 检索自检：真联网跑三个查询。
 *
 * 为什么不 mock：
 * 这一步唯一的风险就是"接口变了/连不上"，mock 掉正好把要验的东西验没了。
 * 所以这个脚本必须真发请求。它会花 10 秒左右（arXiv 限速 3 秒一次）。
 *
 * 跑法：npm run check:arxiv
 */

import { searchArxiv, searchArxivMany } from "../lib/arxiv.ts";

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

console.log("\n=== arXiv 检索自检（真联网） ===\n");

// ---------- 1. 参数校验 ----------

console.log("[1] 空检索词直接拒绝，不发请求");
{
  const outcome = await searchArxiv("   ");
  check("空词返回 ok: false", outcome.ok === false);
  check(
    "错误文案说得清楚",
    outcome.ok === false && outcome.error.includes("空的"),
    outcome.ok === false ? outcome.error : "",
  );
}

// ---------- 2. 真查一个词 ----------

console.log("\n[2] 真查：short video education");
{
  const outcome = await searchArxiv("all:\"short video\" AND all:education", { maxResults: 3 });

  if (!outcome.ok) {
    console.log(`  ! 这一步没查成：${outcome.error}`);
    console.log("  ! 网络问题不算代码错，下面的结构断言跳过");
    failed += 1;
  } else {
    check("ok: true", outcome.ok === true);
    check(`拿到 ${outcome.hits.length} 条（要求 ≥1）`, outcome.hits.length >= 1);
    check(
      `全站命中 ${outcome.totalResults} 篇，≥ 取回的条数`,
      outcome.totalResults >= outcome.hits.length,
    );

    const first = outcome.hits[0];
    if (first) {
      check("标题非空", first.title.length > 0, first.title);
      check("id 是 arXiv 编号格式（如 2608.06932）", /^\d{4}\.\d{4,5}$/.test(first.id), first.id);
      check("url 指向 arxiv.org/abs/", first.url.startsWith("https://arxiv.org/abs/"), first.url);
      check("年份是四位数字", /^\d{4}$/.test(first.year), first.year);
      check("摘要有内容", first.summary.length > 20, `${first.summary.length} 字符`);
      check("作者至少一个", first.authors.length >= 1, `${first.authors.length} 个`);

      console.log("\n  第一条长这样：");
      console.log(`    标题：${first.title}`);
      console.log(`    年份：${first.year}   作者：${first.authors.slice(0, 3).join(", ")}${first.authors.length > 3 ? " 等" : ""}`);
      console.log(`    链接：${first.url}`);
      console.log(`    摘要：${first.summary.slice(0, 120)}...`);
    }
  }
}

// ---------- 3. 查一个几乎不可能有结果的东西 ----------

console.log("\n[3] 查一个查不到的词，确认是「查了没结果」而不是「查询失败」");
{
  const outcome = await searchArxiv("all:\"zzqqxx\" AND all:\"nonexistent gibberish term\"", {
    maxResults: 3,
  });

  if (!outcome.ok) {
    console.log(`  ! 没查成：${outcome.error}（网络问题，跳过）`);
    failed += 1;
  } else {
    check("ok 仍为 true（不是错误）", outcome.ok === true);
    check(`hits 是空数组（实际 ${outcome.hits.length} 条）`, outcome.hits.length === 0);
    check(`totalResults 也是 0（实际 ${outcome.totalResults}）`, outcome.totalResults === 0);
    console.log("  这一条很关键：查了没人做过 ≠ 查询失败，两者必须分开");
  }
}

// ---------- 4. 连续查三个词，确认限速生效 ----------

console.log("\n[4] 连查三个词，确认限速生效（每个之间至少 3 秒）");
{
  const started = Date.now();
  const results = await searchArxivMany(
    [
      "all:\"action research\" AND all:vocational",
      "all:\"shot language\"",
      "all:\"teaching evaluation\" AND all:video",
    ],
    { maxResults: 2 },
  );
  const elapsed = Date.now() - started;

  check("返回了 3 组结果", results.length === 3);
  // 3 次请求，第 1 次立刻发，后两次各等 3 秒 → 至少 6 秒
  check(`耗时 ${Math.round(elapsed / 1000)} 秒，≥6 秒说明限速真的在等`, elapsed >= 6000);

  let okCount = 0;
  for (const { query, outcome } of results) {
    if (outcome.ok) {
      okCount += 1;
      const titles = outcome.hits.map((h) => `(${h.year}) ${h.title.slice(0, 60)}`);
      console.log(`  · ${query}`);
      if (titles.length === 0) {
        console.log("      （没查到）");
      } else {
        for (const t of titles) {
          console.log(`      ${t}`);
        }
      }
    } else {
      console.log(`  · ${query}`);
      console.log(`      失败：${outcome.error}`);
    }
  }

  check(`三个词至少成功两个（实际 ${okCount}/3）`, okCount >= 2);
}

// ---------- 5. 短语 vs 拆开，召回差多少 ----------

console.log("\n[5] 同一个意思，整串短语查 vs 拆成词查，看召回差多少");
{
  const phrase = await searchArxiv('all:"action research" AND all:vocational', { maxResults: 2 });
  const split = await searchArxiv("all:action AND all:research AND all:vocational", { maxResults: 2 });

  if (!phrase.ok || !split.ok) {
    console.log("  ! 网络问题，跳过");
    failed += 1;
  } else {
    console.log(`  整串短语："action research" AND vocational → 全站 ${phrase.totalResults} 篇`);
    console.log(`  拆成单词：action AND research AND vocational → 全站 ${split.totalResults} 篇`);
    check(
      `拆开的关键词召回不低于整串短语（${split.totalResults} ≥ ${phrase.totalResults}）`,
      split.totalResults >= phrase.totalResults,
    );
    console.log("  结论：第 11 步写检索词时两种都要发，取并集");
  }
}

// ---------- 汇总 ----------

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);

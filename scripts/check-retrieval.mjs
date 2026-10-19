/**
 * L2-A 检索意图翻译自检。
 *
 * 分两段：
 *   前半段用**假模型**验结构，不花钱、不联网，每次提交都能跑。
 *   后半段用**真模型**翻一条真主张，再拿去 arXiv / Crossref 真查一次 ——
 *   这是唯一能证明"翻译得对不对"的办法：查出来的论文标题如果跟主张沾边，就说明翻对了。
 *
 * 跑法：
 *   npm run check:retrieval          只跑假模型部分（免费）
 *   npm run check:retrieval -- --live  连真模型一起跑（约 0.01 元）
 */

import {
  buildArxivQueries,
  buildArxivQuery,
  buildCrossrefQuery,
  checkTerm,
  normalizeKeywords,
  translateClaims,
} from "../lib/retrieval.ts";

const LIVE = process.argv.includes("--live");

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

/** 造一条主张，省得每次写全字段。 */
function makeClaim(id, text, type = "method") {
  return { id, text, type, location: `第 1 段`, overlap: 50, defensibility: 50 };
}

const OUTLINE =
  "本课题针对高职数字媒体技术专业学生视频叙事能力不足的问题，拟采用镜头语言训练的方法开展教学改革。";

console.log("\n=== L2-A 检索意图翻译自检 ===\n");

// ---------- 1. checkTerm：什么术语算能用 ----------

console.log("[1] 术语检查：什么算能用，什么算坏了");
{
  check("正常英文短语通过", checkTerm("shot language", "phrase").length === 0);
  check("带连字符的通过", checkTerm("project-based learning", "phrase").length === 0);
  check("三个词的通过", checkTerm("vocational education teaching", "phrase").length === 0);

  const chinese = checkTerm("镜头语言", "phrase");
  check("中文被拦下", chinese.length > 0, chinese.join("；"));

  const tooLong = checkTerm("a b c d e", "phrase");
  check("超过 4 个词被拦下", tooLong.length > 0, tooLong.join("；"));

  const punctuation = checkTerm("shot language.", "phrase");
  check("带句号被拦下", punctuation.length > 0, punctuation.join("；"));

  const empty = checkTerm("   ", "phrase");
  check("空串被拦下", empty.length > 0);
}

// ---------- 2. normalizeKeywords ----------

console.log("\n[2] 关键词清洗：去重、转小写、掐空");
{
  const result = normalizeKeywords(["Shot Language", "shot language", "  VOCATIONAL  ", "", "video narrative"]);
  check("去掉了大小写重复的", result.length === 3, result.join(" / "));
  check("全转小写", result.every((k) => k === k.toLowerCase()), result.join(" / "));
  check("掐掉了空串", result.every((k) => k.length > 0));
  check("多余空格被压成单空格", result.includes("vocational"), result.join(" / "));
}

// ---------- 3. 拼查询串 ----------

console.log("\n[3] 拼 arXiv 查询串：三种模式各拼出什么");
{
  const intent = {
    claimId: "c1",
    phrase: "shot language",
    keywords: ["shot language", "video narrative", "vocational education"],
    zhQuery: "镜头语言 视频叙事 高职",
  };

  const phrase = buildArxivQuery(intent, "phrase");
  const words = buildArxivQuery(intent, "words");
  const mixed = buildArxivQuery(intent, "mixed");

  console.log(`  短语：${phrase}`);
  console.log(`  拆词：${words}`);
  console.log(`  混合：${mixed}`);

  check("短语模式用了引号", phrase === 'all:"shot language"', phrase);
  check("拆词模式用 AND 连接", words.includes(" AND ") && !words.includes('"'), words);
  check("拆词模式包含短语里的词", words.includes("all:shot") && words.includes("all:language"), words);
  check("混合模式是 短语 AND 关键词", mixed.startsWith('all:"shot language" AND all:"'), mixed);

  const all3 = buildArxivQueries(intent);
  check(`三种模式去重后 ${all3.length} 条`, all3.length === 3, all3.join(" | "));

  // 只有一个关键词时，mixed 和 phrase 会撞成同一个串
  const single = { ...intent, keywords: ["shot language"] };
  const deduped = buildArxivQueries(single);
  check(`关键词只有 1 个时去重到 ${deduped.length} 条`, deduped.length === 2, deduped.join(" | "));
}

console.log("\n[4] 拼 Crossref 查询串：自然语言，不加 AND 不加引号");
{
  const intent = {
    claimId: "c1",
    phrase: "shot language",
    keywords: ["shot language", "video narrative", "vocational education"],
    zhQuery: "镜头语言 视频叙事 高职",
  };
  const query = buildCrossrefQuery(intent);
  console.log(`  ${query}`);

  check("不含 AND", !query.includes("AND"));
  check("不含引号", !query.includes('"'));
  check("短语在第一个", query.startsWith("shot language"), query);
  check("重复的术语只出现一次", query.split("shot language").length === 2, query);
}

// ---------- 5. 假模型：正常返回 ----------

console.log("\n[5] 假模型返回正常 JSON");
{
  const fake = async () =>
    JSON.stringify({
      phrase: "shot language",
      keywords: ["shot language", "video narrative", "vocational education", "digital media"],
      zhQuery: "镜头语言 视频叙事 高职",
    });

  const outcome = await translateClaims([makeClaim("c1", "用镜头语言训练提升叙事能力")], OUTLINE, fake);

  check("ok: true", outcome.ok === true);
  if (outcome.ok) {
    check("翻出 1 条", outcome.data.length === 1);
    check("claimId 由代码填成 c1", outcome.data[0].claimId === "c1", outcome.data[0].claimId);
    check("短语转成小写", outcome.data[0].phrase === "shot language", outcome.data[0].phrase);
    check("有中文原文", outcome.data[0].zhQuery.length > 0);
    check("没有警告", outcome.warnings.length === 0, outcome.warnings.join(" | "));
  }
}

// ---------- 6. 假模型：返回脏数据 ----------

console.log("\n[6] 假模型返回脏数据：该救的救，该拒的拒");
{
  // 6a. 关键词里有中文 —— 去掉那个词，其余保留
  const withChinese = async () =>
    JSON.stringify({
      phrase: "shot language",
      keywords: ["shot language", "镜头语言", "video narrative"],
      zhQuery: "镜头语言",
    });
  const r6a = await translateClaims([makeClaim("c1", "测试主张")], OUTLINE, withChinese);
  check("含中文的关键词被剔除后仍成功", r6a.ok === true);
  if (r6a.ok) {
    check("坏词被剔掉了", !r6a.data[0].keywords.some((k) => /[\u4e00-\u9fa5]/.test(k)), r6a.data[0].keywords.join(" / "));
    check("打了警告", r6a.warnings.length > 0, r6a.warnings.join(" | "));
  }

  // 6b. 短语坏掉，但关键词是好的 —— 用第一个关键词顶上
  const badPhrase = async () =>
    JSON.stringify({
      phrase: "镜头语言 shot language",
      keywords: ["shot language", "video narrative"],
      zhQuery: "镜头语言",
    });
  const r6b = await translateClaims([makeClaim("c1", "测试主张")], OUTLINE, badPhrase);
  check("短语坏了但关键词好，仍然成功", r6b.ok === true);
  if (r6b.ok) {
    check("短语被替换成第一个好关键词", r6b.data[0].phrase === "shot language", r6b.data[0].phrase);
    check("打了警告", r6b.warnings.length > 0);
  }

  // 6c. 全部关键词都坏 —— 这条主张放弃，但不能拖垮其他主张
  const allBad = async (_system, user) => {
    if (user.includes("坏主张")) {
      return JSON.stringify({ phrase: "中文", keywords: ["中文一", "中文二"], zhQuery: "中文" });
    }
    return JSON.stringify({
      phrase: "shot language",
      keywords: ["shot language", "video narrative"],
      zhQuery: "镜头语言",
    });
  };
  const r6c = await translateClaims(
    [makeClaim("c1", "好主张"), makeClaim("c2", "坏主张")],
    OUTLINE,
    allBad,
  );
  check("一条坏一条好，整体仍成功", r6c.ok === true);
  if (r6c.ok) {
    check("只剩好的那条", r6c.data.length === 1, `${r6c.data.length} 条`);
    check("好的是 c1", r6c.data[0].claimId === "c1", r6c.data[0].claimId);
    check("坏的那条有警告", r6c.warnings.some((w) => w.includes("没翻出")), r6c.warnings.join(" | "));
  }

  // 6d. 模型直接抛异常
  const thrower = async () => {
    throw new Error("网络断了");
  };
  const r6d = await translateClaims([makeClaim("c1", "测试主张")], OUTLINE, thrower);
  check("全部失败时返回 ok: false", r6d.ok === false);
  if (!r6d.ok) {
    check("错误信息里带得上原因", r6d.error.includes("网络断了") || r6d.error.includes("全部"), r6d.error);
  }

  // 6e. JSON 外面包了废话 —— 走 parse.ts 的降级链
  const chatty = async () =>
    "好的，我来翻译：\n```json\n" +
    JSON.stringify({
      phrase: "shot language",
      keywords: ["shot language", "video narrative"],
      zhQuery: "镜头语言",
    }) +
    "\n```\n希望有帮助！";
  const r6e = await translateClaims([makeClaim("c1", "测试主张")], OUTLINE, chatty);
  check("包在代码块里的 JSON 也能抠出来", r6e.ok === true);
}

// ---------- 7. 真模型 ----------

if (!LIVE) {
  console.log("\n[7] 真模型部分被跳过（加 -- --live 才会跑，约 0.01 元）");
} else {
  console.log("\n[7] 真模型翻译一条主张，再拿去两个数据库真查");

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.log("  ! 没配 DEEPSEEK_API_KEY，跳过");
    failed += 1;
  } else {
    const { createModelClient, estimateCost } = await import("../lib/deepseek.ts");
    const client = createModelClient({ apiKey });

    const claim = makeClaim(
      "c1",
      "采用镜头语言训练的方式，提升高职数字媒体专业学生的视频叙事能力",
    );

    const started = Date.now();
    const outcome = await translateClaims([claim], OUTLINE, client.call);
    const elapsed = Date.now() - started;
    const usage = client.getUsage();

    check("真模型翻译成功", outcome.ok === true);

    if (outcome.ok) {
      const intent = outcome.data[0];
      console.log("\n  翻译结果：");
      console.log(`    短语：${intent.phrase}`);
      console.log(`    关键词：${intent.keywords.join(", ")}`);
      console.log(`    中文对照：${intent.zhQuery}`);
      if (outcome.warnings.length > 0) {
        console.log(`    警告：${outcome.warnings.join(" | ")}`);
      }

      const arxivQueries = buildArxivQueries(intent);
      console.log("\n  要发给 arXiv 的查询：");
      for (const q of arxivQueries) console.log(`    ${q}`);

      const crossrefQuery = buildCrossrefQuery(intent);
      console.log(`  要发给 Crossref 的查询：\n    ${crossrefQuery}`);

      // 真查一次 Crossref（快，1 秒）
      const { searchCrossref } = await import("../lib/crossref.ts");
      const cr = await searchCrossref(crossrefQuery, { rows: 3 });
      if (cr.ok) {
        console.log(`\n  Crossref 查到 ${cr.hits.length} 条：`);
        for (const hit of cr.hits) {
          console.log(`    (${hit.year || "?"}) ${hit.title.slice(0, 64)}`);
        }
        check("Crossref 至少查到 1 条", cr.hits.length >= 1, "0 条说明翻译可能太窄");
      } else {
        console.log(`\n  Crossref 没查成：${cr.error}`);
      }

      // 真查一次 arXiv（慢，3 秒起）
      const { searchArxiv } = await import("../lib/arxiv.ts");
      const ax = await searchArxiv(arxivQueries[1], { maxResults: 3 });
      if (ax.ok) {
        console.log(`\n  arXiv「${arxivQueries[1]}」查到 ${ax.totalResults} 篇，取回 ${ax.hits.length} 条：`);
        for (const hit of ax.hits) {
          console.log(`    (${hit.year || "?"}) ${hit.title.slice(0, 64)}`);
        }
      } else {
        console.log(`\n  arXiv 没查成：${ax.error}`);
      }

      console.log(`\n  耗时 ${Math.round(elapsed / 1000)} 秒，花费约 ${estimateCost(usage).toFixed(4)} 元`);
    }
  }
}

// ---------- 汇总 ----------

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);

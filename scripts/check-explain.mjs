/**
 * lib/explain.ts 的自检。
 *
 * 为什么这个文件必须先写：explain 的输出全是人话，
 * 人话写错了人眼看不出来 —— 「最弱维度挑错了」「没有参考时却说有人做过」
 * 这类错读起来都很顺，只有断言能抓住。
 *
 * 跑法：node scripts/check-explain.mjs
 */

import { explainClaim, formatAuthors, formatHits } from "../lib/explain.ts";

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail === undefined ? "" : ` —— ${detail}`}`);
  }
}

/** 造一条主张。overlap / defensibility 是唯一要关心的两件事。 */
function claim(id, overlap, defensibility, text = "这是第 " + id + " 条主张") {
  return {
    id,
    text,
    type: "method",
    quote: text,
    location: "研究方法",
    overlap,
    defensibility,
  };
}

/** 造一份证据明细，四个维度按 lib/evidence.ts 的顺序。 */
function evidence(claimId, scores, hits = {}) {
  return {
    claimId,
    score: Math.round(
      (scores[0] * 30 + scores[1] * 30 + scores[2] * 25 + scores[3] * 15) / 100,
    ),
    dimensions: [
      { name: "有没有数字", score: scores[0], hits: hits[0] ?? [] },
      { name: "有没有方法", score: scores[1], hits: hits[1] ?? [] },
      { name: "有没有出处", score: scores[2], hits: hits[2] ?? [] },
      { name: "说得具体吗", score: scores[3], hits: hits[3] ?? [] },
    ],
  };
}

function search(claimId, options = {}) {
  return {
    claimId,
    score: options.score ?? 60,
    reason: options.reason ?? "有重合",
    totalHits: options.totalHits ?? 5,
    bestHit: options.bestHit ?? null,
    matched: options.matched ?? [],
  };
}

/* ===============================================================
   [1] 两个轴怎么说成话
   =============================================================== */

console.log("\n[1] 两个轴怎么说成话");

{
  const result = explainClaim(claim("c1", 80, 20), undefined, undefined);
  check(
    "横轴 80 分说成「做过很多次」",
    result.headline.includes("做过很多次"),
    result.headline,
  );
  check(
    "纵轴 20 分说成「答不上来」",
    result.headline.includes("基本答不上来"),
    result.headline,
  );
  check(
    "两个分数都原样出现在句子里",
    result.headline.includes("80") && result.headline.includes("20"),
    result.headline,
  );
}

{
  const result = explainClaim(claim("c2", 10, 90), undefined, undefined);
  check(
    "横轴 10 分说成「基本没人做过」",
    result.headline.includes("基本没人做过"),
    result.headline,
  );
  check(
    "纵轴 90 分说成「答得上来」",
    result.headline.includes("答得上来"),
    result.headline,
  );
}

{
  /*
    50 分是分界线，两边的话必须不一样。
    如果 50 说成「没人做过」，用户会以为自己在安全区，
    而实际上它正好落在「别人做过」那一侧。
  */
  const at = explainClaim(claim("c3", 50, 50), undefined, undefined);
  check(
    "正好 50 分算「有人做过相近的」这一档",
    at.headline.includes("有人做过相近的"),
    at.headline,
  );
  check(
    "正好 50 分算「勉强答得上」这一档",
    at.headline.includes("勉强答得上"),
    at.headline,
  );
}

{
  const result = explainClaim(claim("c4", 40, 55), undefined, undefined);
  check(
    "象限名出现在句尾",
    result.headline.includes("这一角"),
    result.headline,
  );
}

/* ===============================================================
   [2] 最弱的维度
   =============================================================== */

console.log("\n[2] 最弱的维度");

{
  const ev = evidence("c1", [0, 60, 100, 100]);
  const result = explainClaim(claim("c1", 40, 30), ev, undefined);
  check("挑出分数最低的那个维度", result.weakest?.name === "有没有数字", result.weakest?.name);
  check("最弱维度的分是对的", result.weakest?.score === 0, String(result.weakest?.score));
  check(
    "最弱维度带一句该怎么补",
    (result.weakest?.advice ?? "").includes("样本量"),
    result.weakest?.advice,
  );
  check(
    "建议里点名了这个维度",
    result.advice.includes("有没有数字"),
    result.advice,
  );
}

{
  /*
    同分时必须稳定地挑第一个。
    数字 / 方法 / 出处 / 具体 全 0 分时，报「有没有数字」——
    那是最好补的一项（补个样本量就行）。
  */
  const ev = evidence("c2", [0, 0, 0, 0]);
  const result = explainClaim(claim("c2", 40, 10), ev, undefined);
  check("全 0 分时挑第一个维度", result.weakest?.name === "有没有数字", result.weakest?.name);
}

{
  const result = explainClaim(claim("c3", 40, 30), undefined, undefined);
  check("拿不到证据明细时 weakest 为 null", result.weakest === null);
  check("dimensions 是空数组", result.dimensions.length === 0);
  check(
    "没有明细时给的是笼统建议，不编维度名",
    result.advice.includes("补证据") && !result.advice.includes("有没有"),
    result.advice,
  );
}

/* ===============================================================
   [3] 该改什么：四个分支
   =============================================================== */

console.log("\n[3] 该改什么");

{
  const ev = evidence("c1", [0, 60, 100, 100]);
  const both = explainClaim(claim("c1", 70, 20), ev, undefined);
  check("两头都差时说「两头都要动」", both.advice.includes("两头都要动"), both.advice);
  check("两头都差时点名最弱维度", both.advice.includes("有没有数字"), both.advice);
  check("两头都差时提收窄角度", both.advice.includes("收窄"), both.advice);
}

{
  const crowded = explainClaim(claim("c2", 75, 65), undefined, undefined);
  check(
    "只有横轴高时说「不用再补证据」",
    crowded.advice.includes("不用再补证据"),
    crowded.advice,
  );
  check("只有横轴高时提「收窄角度」", crowded.advice.includes("收窄"), crowded.advice);
}

{
  const ev = evidence("c3", [0, 60, 100, 100]);
  const foggy = explainClaim(claim("c3", 30, 30), ev, undefined);
  check("只有纵轴低时说「卡在」", foggy.advice.includes("卡在"), foggy.advice);
  check("只有纵轴低时点名最弱维度", foggy.advice.includes("有没有数字"), foggy.advice);
}

{
  const home = explainClaim(claim("c4", 30, 70), undefined, undefined);
  check("两个轴都过时说「都过了」", home.advice.includes("都过了"), home.advice);
  check("两个轴都过时不提补证据", !home.advice.includes("补证据"), home.advice);
}

/* ===============================================================
   [4] 最像的那一篇
   =============================================================== */

console.log("\n[4] 最像的那一篇");

{
  const hit = {
    source: "crossref",
    title: "Pitching in tone and non-tone second languages",
    year: "2016",
    authors: ["Alice Chen", "Bob Li", "Carol Wang"],
    venue: "Speech Prosody 2016",
    url: "https://doi.org/10.1/xyz",
  };
  const result = explainClaim(
    claim("c1", 72, 78),
    undefined,
    search("c1", { bestHit: hit, matched: ["tone", "cantonese"] }),
  );

  check("有最像的那篇时 reference 非空", result.reference !== null);
  check("标题原样保留", result.reference?.title === hit.title, result.reference?.title);
  check("链接原样保留", result.reference?.url === hit.url, result.reference?.url);
  check(
    "作者三个人时截断成「等」",
    (result.reference?.meta ?? "").includes("等"),
    result.reference?.meta,
  );
  check(
    "meta 里有期刊名",
    (result.reference?.meta ?? "").includes("Speech Prosody 2016"),
    result.reference?.meta,
  );
  check(
    "meta 里有年份",
    (result.reference?.meta ?? "").includes("2016"),
    result.reference?.meta,
  );
  check(
    "meta 里把 crossref 说成 Crossref",
    (result.reference?.meta ?? "").includes("Crossref"),
    result.reference?.meta,
  );
  check(
    "共有的词列出来了",
    (result.referenceNote ?? "").includes("tone") &&
      (result.referenceNote ?? "").includes("cantonese"),
    result.referenceNote,
  );
}

{
  const hit = {
    source: "arxiv",
    title: "A paper",
    year: "2020",
    authors: [],
    venue: "",
    url: "https://arxiv.org/abs/1234",
  };
  const result = explainClaim(claim("c2", 60, 60), undefined, search("c2", { bestHit: hit }));
  check(
    "没有作者和期刊时 meta 不出现多余的分隔点",
    !(result.reference?.meta ?? "").includes(" ·  · "),
    result.reference?.meta,
  );
  check(
    "meta 仍保留来源和年份",
    (result.reference?.meta ?? "").includes("arXiv") &&
      (result.reference?.meta ?? "").includes("2020"),
    result.reference?.meta,
  );
}

{
  const result = explainClaim(claim("c3", 50, 50), undefined, undefined);
  check("整份报告没有检索明细时 reference 为 null", result.reference === null);
  check(
    "没有明细时说清楚是「存好的示例」而不是「没人做过」",
    result.referenceNote.includes("存好的示例"),
    result.referenceNote,
  );
  check(
    "没有明细时不许说「没人做过」",
    !result.referenceNote.includes("没人做过"),
    result.referenceNote,
  );
}

{
  const result = explainClaim(
    claim("c4", 20, 40),
    undefined,
    search("c4", { totalHits: 0, bestHit: null }),
  );
  check("一条都没查回来时 reference 为 null", result.reference === null);
  check(
    "一条都没查回来时明说「不等于没人做过」",
    result.referenceNote.includes("不等于没人做过"),
    result.referenceNote,
  );
}

{
  const result = explainClaim(
    claim("c5", 20, 40),
    undefined,
    search("c5", { totalHits: 7, bestHit: null }),
  );
  check("查回来几篇但没有最像的时 reference 为 null", result.reference === null);
  check(
    "这种情况说清楚查回来几篇",
    result.referenceNote.includes("7"),
    result.referenceNote,
  );
}

{
  /*
    有最像的那篇但没有共同词（理论上不该出现，但外部数据什么都可能有）：
    这时候要说 reason，不能把空数组 join 成空字符串。
  */
  const hit = {
    source: "web",
    title: "某篇中文文章",
    year: "2023",
    authors: [],
    venue: "",
    url: "https://example.com/x",
  };
  const result = explainClaim(
    claim("c6", 60, 60),
    undefined,
    search("c6", { bestHit: hit, matched: [], reason: "只沾一点边" }),
  );
  check(
    "没有共同词时退回用 reason",
    result.referenceNote.includes("只沾一点边"),
    result.referenceNote,
  );
  check(
    "没有共同词时不出现「共有的词：」这种空话",
    !result.referenceNote.includes("共有的词："),
    result.referenceNote,
  );
}

/* ===============================================================
   [5] 作者名的几种形态
   =============================================================== */

console.log("\n[5] 作者名");

check("空数组给空串", formatAuthors([]) === "", formatAuthors([]));
check("一个人原样返回", formatAuthors(["张三"]) === "张三", formatAuthors(["张三"]));
check(
  "两个人用顿号连",
  formatAuthors(["张三", "李四"]) === "张三、李四",
  formatAuthors(["张三", "李四"]),
);
check(
  "三个人截断成「等」",
  formatAuthors(["张三", "李四", "王五"]) === "张三、李四 等",
  formatAuthors(["张三", "李四", "王五"]),
);
check(
  "空白名字被过滤掉",
  formatAuthors(["张三", "  ", ""]) === "张三",
  formatAuthors(["张三", "  ", ""]),
);

/* ===============================================================
   [6] 边界
   =============================================================== */

console.log("\n[6] 边界");

{
  const zero = explainClaim(claim("z1", 0, 0), undefined, undefined);
  check("两个 0 分不报错", typeof zero.headline === "string" && zero.headline.length > 0);
  check("两个 0 分时说「基本没人做过」", zero.headline.includes("基本没人做过"), zero.headline);
}

{
  const hundred = explainClaim(claim("z2", 100, 100), undefined, undefined);
  check(
    "两个 100 分时说「做过很多次」和「答得上来」",
    hundred.headline.includes("做过很多次") && hundred.headline.includes("答得上来"),
    hundred.headline,
  );
}

{
  /*
    上游给了越界的分（理论上不该有，但 schema 只保证 0-100 的整数，
    真实数据里出现过 -1 和 101）。这里只要求不崩、话还说得通。
  */
  const out = explainClaim(claim("z3", 130, -20), undefined, undefined);
  check("越界的分数不崩", typeof out.headline === "string");
  check(
    "越界时仍落在最高档/最低档，不出现空白",
    out.headline.includes("做过很多次") && out.headline.includes("基本答不上来"),
    out.headline,
  );
}

{
  const ev = evidence("z4", [50, 50, 50, 50]);
  const result = explainClaim(claim("z4", 50, 50), ev, undefined);
  check("四个维度同分时不崩", result.weakest !== null);
  check("四个维度同分时挑第一个", result.weakest?.name === "有没有数字", result.weakest?.name);
}

/* ===============================================================
   [7] 命中词怎么显示
   =============================================================== */

{
  /*
    为什么单独测这个：lib/evidence.ts 借提纲的分时会把命中词一个个
    加上「提纲里有：」前缀塞进 hits，直接 join 出来就是
    「提纲里有：两个、提纲里有：128名、提纲里有：64人…」，
    每项重复一遍前缀，读起来像坏了。实测时就是这么发现的。
  */
  const mixed = formatHits([
    "提纲里有：两个",
    "提纲里有：64人",
    "平台",
    "（句子够长）",
  ]);
  check("自己写的词照原样列出", mixed.includes("平台") && mixed.includes("（句子够长）"), mixed);
  check("借来的词只留一个前缀", mixed.split("提纲里有：").length - 1 === 1, mixed);
  check("借来的词用括注分开", mixed.includes("（提纲里有：两个、64人）"), mixed);
  check("两类词都在", mixed.includes("平台") && mixed.includes("两个"), mixed);
}

{
  const own = formatHits(["平台", "量表"]);
  check("全是自己的词时不出现「提纲里有」", !own.includes("提纲里有"), own);
  check("全是自己的词时照原样顿号连", own === "平台、量表", own);
}

{
  const borrowed = formatHits(["提纲里有：三轮", "提纲里有：6周"]);
  check("全是借来的词时只有一个括注", borrowed === "（提纲里有：三轮、6周）", borrowed);
}

{
  check("一个词都没有时说清楚", formatHits([]) === "一个都没找到", formatHits([]));
}

{
  /* 前缀必须严格匹配，不能把「提纲里有」当普通文字误伤 */
  const tricky = formatHits(["提纲里有数据"]);
  check("不是前缀的「提纲里有」当普通词", tricky === "提纲里有数据", tricky);
}

{
  /* 真实数据的形状：一份 610 字提纲借分后命中词全带前缀 */
  const real = formatHits([
    "提纲里有：两个",
    "提纲里有：128名",
    "提纲里有：64人",
    "提纲里有：一个",
    "提纲里有：16周",
    "提纲里有：两名",
    "提纲里有：一次",
  ]);
  check("七个借来的词只出现一次前缀", real.split("提纲里有：").length - 1 === 1, real);
  check("七个词都在", real.includes("128名") && real.includes("16周") && real.includes("两名"), real);
}

/* ===============================================================
   汇总
   =============================================================== */

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);

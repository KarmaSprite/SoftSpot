/**
 * Crossref「这条到底是不是论文」的自检。
 *
 * 全程不联网：这里只验记录形状的判定，不需要真去查 Crossref。
 * 真去查的那个脚本是 scripts/check-crossref.mjs，它要网、会慢。
 *
 * 跑法：node scripts/check-crossref-filter.mjs
 *
 * 这个脚本存在的理由：
 * 挡掉碎片记录是横轴分数的地基之一。地基塌了不会报错，
 * 只会让所有主张的横轴悄悄高出一档，然后用户被告知
 * 「你的选题别人做过了」—— 而证据是某篇论文里的一张表格。
 * 这种错误没人能自己发现，所以必须由断言守着。
 */

import { looksLikePaper } from "../lib/crossref.ts";

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}${detail ? `  → ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  → ${detail}` : ""}`);
  }
}

/** 造一条 Crossref 记录，只关心判定要用的字段。 */
function record(type, title) {
  return { DOI: "10.1234/test", type, title: [title] };
}

/* ---------------------------------------------------------------
   [1] 实测抓到的碎片，一条都不能漏
   --------------------------------------------------------------- */

console.log("\n[1] 实测抓到的表格和附录，必须挡掉");
{
  /*
     下面这些标题是从真实 Crossref 响应里抄下来的，
     type 全是 component。它们都有 DOI、都有标题，
     所以 parseItem 会照收 —— 只靠「缺字段」是挡不住的。
  */
  const fragments = [
    "Table 5: Inter-rater reliability analysis.",
    "Table 2: Descriptive statistics of the participants.",
    "Figure 5: Model performance of test dataset—Leave-one-subject-out",
    "Supplement 2. Leave-one-out cross-validation of the predictive model",
    "Appendix A. Stimuli list",
    "Table 14: Comparison of 10-fold cross validation",
  ];

  for (const title of fragments) {
    check(`挡掉「${title.slice(0, 34)}…」`, looksLikePaper(record("component", title)) === false);
  }
}

/* ---------------------------------------------------------------
   [2] 真论文一条都不能误伤
   --------------------------------------------------------------- */

console.log("\n[2] 真论文一条都不能误伤");
{
  /*
     误伤的代价比漏掉更大：漏掉一条碎片只是少一份噪声，
     误伤一篇真论文等于告诉用户「这个方向没人做过」，而其实有人做过。
  */
  const papers = [
    record("journal-article", "Pitching in tone and non-tone second languages"),
    record("journal-article", "Investigating Mandarin Tone and Focus Prosody"),
    record("journal-article", "The acoustic analysis of tone differentiation"),
    record("proceedings-article", "Eye tracking cognitive load using pupil diameter"),
    /* 这个标题以 Figure 开头，但后面没有编号 —— 是真论文，不能挡 */
    record("journal-article", "Figure and Ground in Visual Perception"),
    /* 预印本可能没有期刊名也没有年份，仍然是论文 */
    record("posted-content", "A Preprint About Something"),
  ];

  for (const item of papers) {
    check(
      `留下「${item.title[0].slice(0, 34)}…」`,
      looksLikePaper(item) === true,
    );
  }
}

/* ---------------------------------------------------------------
   [3] type 黑名单里的其它零件
   --------------------------------------------------------------- */

console.log("\n[3] type 黑名单：其它不是论文的记录");
{
  const nonPapers = [
    "reference-entry",
    "peer-review",
    "grant",
    "dataset",
    "journal-issue",
    "journal-volume",
    "report-component",
    "standard",
  ];

  for (const type of nonPapers) {
    check(
      `挡掉 type=${type}`,
      looksLikePaper(record(type, "Some Perfectly Normal Looking Title")) === false,
    );
  }
}

/* ---------------------------------------------------------------
   [4] 残缺记录不能崩
   --------------------------------------------------------------- */

console.log("\n[4] 残缺记录不能崩，也不许当成论文");
{
  check("null 不当成论文", looksLikePaper(null) === false);
  check("undefined 不当成论文", looksLikePaper(undefined) === false);
  check("字符串不当成论文", looksLikePaper("journal-article") === false);
  check("空对象不当成论文", looksLikePaper({}) === false);
  check("没有标题不当成论文", looksLikePaper({ DOI: "10.1/x", type: "journal-article" }) === false);
  check("标题是空数组不当成论文", looksLikePaper({ type: "journal-article", title: [] }) === false);

  /*
     type 缺失或大小写不对时，不能因为认不出就一律挡掉。
     宁可多留一条噪声，也不能把一整类真论文悄悄丢掉。
  */
  check(
    "没有 type 字段时按论文处理",
    looksLikePaper({ title: ["A Normal Paper Title"] }) === true,
  );
  check(
    "type 大写时也要认得出黑名单",
    looksLikePaper(record("COMPONENT", "Table 1: Something")) === false,
  );
  check(
    "type 前后带空格时也要认得出",
    looksLikePaper(record("  component  ", "Table 1: Something")) === false,
  );
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);

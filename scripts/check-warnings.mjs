/**
 * lib/warnings.ts 的自检。
 *
 * 这个函数不联网、不调模型，纯字符串处理，所以断言可以写得很硬：
 * 输入什么、输出必须一字不差是什么。
 *
 * 重点测三件事：
 *   1. 同类合并之后，**条数**对不对（这是用户能直接看见的）
 *   2. 合并之后那句话**有没有把「影响了几条」说出来**
 *   3. 只发生一次的和认不出来的警告，**一个字都不能改**
 *
 * 第 3 点最容易在改代码时被顺手破坏 —— 一个「统一格式」的念头
 * 就会把「你粘的第 3 行太短」也套进模板里。
 */

import { collapseWarnings } from "../lib/warnings.ts";

let passed = 0;
let failed = 0;

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ""}`);
  }
}

/** 造一条「查某个库没成功」的警告，句式必须和 lib/search.ts 里的一致。 */
function sourceFail(claim, source, reason) {
  return `「${claim}」查 ${source} 时没成功（${reason}），这条主张的分数只算了另一个库。`;
}

/** 造一条「补查中文没成功」的警告。 */
function webFail(claim, reason) {
  return `「${claim}」补查中文文献时没成功（${reason}）。英文库的分数照常算，只是少了一个参考。`;
}

/* ---------------------------------------------------------------
   [1] 空的和不用改的
   --------------------------------------------------------------- */

console.log("\n[1] 不该动的东西一个字都不动");

check("空数组进，空数组出", JSON.stringify(collapseWarnings([])) === "[]");

const plain = [
  "你粘的第 3 行太短，跳过了。",
  "第 2 条主张的措辞和原文对不上，已按原文改回。",
];
check(
  "没有源故障时原样返回",
  JSON.stringify(collapseWarnings(plain)) === JSON.stringify(plain),
  JSON.stringify(collapseWarnings(plain)),
);

/* ---------------------------------------------------------------
   [2] 只发生一次：保留原句
   --------------------------------------------------------------- */

console.log("\n[2] 只发生一次，保留原句");

const once = [sourceFail("学生课前学习", "arXiv", "arXiv 超过 15 秒没回话")];
const onceOut = collapseWarnings(once);
check("一条故障还是 1 条", onceOut.length === 1, `实际 ${onceOut.length}`);
check(
  "而且原封不动（还带着是哪条主张）",
  onceOut[0] === once[0],
  onceOut[0],
);
check(
  "没有被换成「有 1 条主张」那种合成句式",
  !onceOut[0].includes("有 1 条主张"),
  onceOut[0],
);

/* ---------------------------------------------------------------
   [3] 同类合并
   --------------------------------------------------------------- */

console.log("\n[3] 同一个源、同一个原因，合成一条");

const many = [
  sourceFail("主张一", "arXiv", "arXiv 超过 15 秒没回话"),
  sourceFail("主张二", "arXiv", "arXiv 超过 15 秒没回话"),
  sourceFail("主张三", "arXiv", "arXiv 超过 15 秒没回话"),
];
const manyOut = collapseWarnings(many);
check("3 条合成 1 条", manyOut.length === 1, `实际 ${manyOut.length}`);
check("说出影响了几条", manyOut[0].includes("3 条"), manyOut[0]);
check("说出是哪个源", manyOut[0].includes("arXiv"), manyOut[0]);
check("说出原因", manyOut[0].includes("超过 15 秒没回话"), manyOut[0]);
check(
  "不再逐条点名主张（那样等于没合）",
  !manyOut[0].includes("主张一"),
  manyOut[0],
);

/* ---------------------------------------------------------------
   [4] 源相同但原因不同：不能合
   --------------------------------------------------------------- */

console.log("\n[4] 同一个源、不同原因，分开说");

const reasons = [
  sourceFail("主张一", "arXiv", "arXiv 说我们查太快了（429）"),
  sourceFail("主张二", "arXiv", "arXiv 超过 15 秒没回话"),
  sourceFail("主张三", "arXiv", "arXiv 说我们查太快了（429）"),
];
const reasonsOut = collapseWarnings(reasons);
check("两组，不是一组", reasonsOut.length === 2, `实际 ${reasonsOut.length}`);
check(
  "429 那组说 2 条",
  reasonsOut.some((w) => w.includes("429") && w.includes("2 条")),
  JSON.stringify(reasonsOut),
);
check(
  "超时那组只有 1 条，保留原句",
  reasonsOut.some((w) => w.includes("超过 15 秒没回话") && w.includes("主张二")),
  JSON.stringify(reasonsOut),
);

/* ---------------------------------------------------------------
   [5] 不同源分开
   --------------------------------------------------------------- */

console.log("\n[5] 不同源分开，不能混成一句");

const twoSources = [
  sourceFail("主张一", "arXiv", "arXiv 超过 15 秒没回话"),
  sourceFail("主张二", "arXiv", "arXiv 超过 15 秒没回话"),
  sourceFail("主张一", "Crossref", "Crossref 返回了空内容"),
  sourceFail("主张二", "Crossref", "Crossref 返回了空内容"),
];
const twoOut = collapseWarnings(twoSources);
check("两组合成 2 条", twoOut.length === 2, `实际 ${twoOut.length}`);
check(
  "arXiv 那条说 2 条",
  twoOut.some((w) => w.includes("arXiv") && w.includes("2 条")),
  JSON.stringify(twoOut),
);
check(
  "Crossref 那条说 2 条",
  twoOut.some((w) => w.includes("Crossref") && w.includes("2 条")),
  JSON.stringify(twoOut),
);

/* ---------------------------------------------------------------
   [6] 中文网页的文案不一样
   --------------------------------------------------------------- */

console.log("\n[6] 中文网页是加餐，话要说得轻一点");

const web = [
  webFail("主张一", "请求超时"),
  webFail("主张二", "请求超时"),
];
const webOut = collapseWarnings(web);
check("2 条合成 1 条", webOut.length === 1, `实际 ${webOut.length}`);
check("说出影响几条", webOut[0].includes("2 条"), webOut[0]);
check(
  "不说「只算了另一个库」（那是英文库挂掉时的话）",
  !webOut[0].includes("只算了另一个库"),
  webOut[0],
);
check(
  "要说清英文库的分数照常算",
  webOut[0].includes("英文库的分数照常算"),
  webOut[0],
);

/* ---------------------------------------------------------------
   [7] 混合场景：顺序和位置
   --------------------------------------------------------------- */

console.log("\n[7] 混合场景：合成句站在第一次出现的那个位置");

const mixed = [
  "你粘的第 3 行太短，跳过了。",
  sourceFail("主张一", "arXiv", "arXiv 超过 15 秒没回话"),
  sourceFail("主张二", "arXiv", "arXiv 超过 15 秒没回话"),
  "第 2 条主张的措辞和原文对不上，已按原文改回。",
];
const mixedOut = collapseWarnings(mixed);
check("4 条变 3 条", mixedOut.length === 3, `实际 ${mixedOut.length}`);
check(
  "第一条还是你粘的文献那条",
  mixedOut[0] === "你粘的第 3 行太短，跳过了。",
  mixedOut[0],
);
check(
  "第二条是合成句（原来 arXiv 第一次出现的位置）",
  mixedOut[1].includes("arXiv") && mixedOut[1].includes("2 条"),
  mixedOut[1],
);
check(
  "第三条还是措辞那条",
  mixedOut[2] === "第 2 条主张的措辞和原文对不上，已按原文改回。",
  mixedOut[2],
);

/* ---------------------------------------------------------------
   [8] 一份 8 条主张全挂的真实形状
   --------------------------------------------------------------- */

console.log("\n[8] 8 条主张全挂，黄框从 8 行变 1 行");

const eight = Array.from({ length: 8 }, (_, i) =>
  sourceFail(`第 ${i + 1} 条主张的内容`, "arXiv", "arXiv 超过 15 秒没回话"),
);
const eightOut = collapseWarnings(eight);
check("8 条合成 1 条", eightOut.length === 1, `实际 ${eightOut.length}`);
check("说 8 条", eightOut[0].includes("8 条"), eightOut[0]);

const eightPlusWeb = [
  ...eight,
  ...Array.from({ length: 8 }, (_, i) => webFail(`第 ${i + 1} 条主张的内容`, "请求超时")),
];
const eightPlusOut = collapseWarnings(eightPlusWeb);
check("16 条合成 2 条", eightPlusOut.length === 2, `实际 ${eightPlusOut.length}`);

/* ---------------------------------------------------------------
   [9] 认不出来的警告必须原样留着
   --------------------------------------------------------------- */

console.log("\n[9] 认不出来的警告原样留着");

const weird = [
  "「这条主张」查 SomeNewSource 时没成功（炸了），这条主张的分数只算了另一个库。",
  "「这条主张」查 arXiv 时没成功（炸了），这条主张的分数只算了另一个库。",
  "「这条主张」查 arXiv 时没成功（炸了），这条主张的分数只算了另一个库。",
];
const weirdOut = collapseWarnings(weird);
check("认不出的源不进合并组", weirdOut.length === 2, `实际 ${weirdOut.length}`);
check(
  "认不出的那条一个字没改",
  weirdOut[0] === weird[0],
  weirdOut[0],
);
check(
  "arXiv 那两条合成了一条",
  weirdOut[1].includes("2 条"),
  weirdOut[1],
);

/* ---------------------------------------------------------------
   [10] 原因里本身带括号
   --------------------------------------------------------------- */

console.log("\n[10] 原因里带括号，不能截断");

/*
  arXiv 的 429 报错原文是「arXiv 说我们查太快了（429），这次跳过」，
  外面再套一层就是嵌套括号。用非贪婪匹配会在内层那个 `）` 处截断，
  合出来的句子会缺一半 —— 这条断言就是钉住这个坑。
*/
const nested = [
  sourceFail("主张一", "arXiv", "arXiv 说我们查太快了（429），这次跳过"),
  sourceFail("主张二", "arXiv", "arXiv 说我们查太快了（429），这次跳过"),
];
const nestedOut = collapseWarnings(nested);
check("2 条合成 1 条", nestedOut.length === 1, `实际 ${nestedOut.length}`);
check(
  "原因完整（含内层括号和「这次跳过」）",
  nestedOut[0].includes("（429），这次跳过"),
  nestedOut[0],
);
check(
  "括号是配平的",
  (nestedOut[0].match(/（/g) ?? []).length === (nestedOut[0].match(/）/g) ?? []).length,
  nestedOut[0],
);

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;

/**
 * 手工粘贴的中文文献。
 *
 * 为什么需要这一层：知网没有面向个人的 API（只有机构采购），
 * arXiv 是理工预印本库（实测 `all:vocational` 全站只有 88 篇），
 * Crossref 里中文职教论文也稀。英文库查不到中文选题，
 * 这不代表"没人做过"，只代表"我们的库看不见"。
 *
 * 所以让用户把自己已经知道的那些中文文献粘进来 ——
 * 他比任何接口都清楚自己专业里有谁做过什么。
 *
 * 这一层只做一件事：**把一团自由文本变成一组干净的标题**。
 * 不打分、不判断相关性，那是 lib/overlap.ts 的事。
 *
 * 输入是脏的，这一点必须认：
 *   用户会从知网复制一整段、会带编号、会带"被引量：4"、
 *   会写成"标题 - 期刊名 2024"、会一行粘三篇。
 * 所以这里的策略是**尽量认出来，认不出来的宁可跳过并告诉他**，
 * 绝不猜 —— 猜错一个标题会让分数悄悄偏掉，而用户看不出偏在哪。
 */

/* ---------------------------------------------------------------
   1. 常量
   --------------------------------------------------------------- */

/** 标题短于这个长度就当没写（"研究"两个字构不成一篇文献）。 */
export const MIN_TITLE_LENGTH = 6;

/** 一次最多认这么多条，防有人粘一整篇参考文献目录。 */
export const MAX_REFS = 50;

/** 原文上限，超过就截断并警告（跟提纲的 8000 同一个数量级）。 */
export const MAX_RAW_LENGTH = 8000;

/* ---------------------------------------------------------------
   2. 类型
   --------------------------------------------------------------- */

export type ManualRef = {
  /** 洗干净的标题 */
  title: string;
  /** 期刊名或会议名，认不出来是空串 */
  venue: string;
  /** 四位年份，认不出来是空串 */
  year: string;
};

export type ManualParseOutcome = {
  refs: ManualRef[];
  /** 给人看的警告，一条一句 */
  warnings: string[];
};

/* ---------------------------------------------------------------
   3. 行首编号
   --------------------------------------------------------------- */

/**
 * 行首那些"这是第几条"的标记。
 *
 * 要认的写法（都是从真知网导出和手写里见过的）：
 *   1.  1、  1)  1）  (1)  [1]  ① ②  一、  二、
 * 注意 `1.` 后面必须跟空白或直接跟汉字 —— 不然后面会误伤
 * "1.5 倍"这种正文。这里只在行首匹配，风险已经很小。
 */
const LEADING_MARKER =
  /^\s*(?:\[\s*\d+\s*\]|[(（]\s*\d+\s*[)）]|\d+\s*[.、．)）]\s*|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*|[一二三四五六七八九十]{1,3}\s*[、.]\s*)/;

/**
 * 行首的项目符号。
 *
 * 必须跟 LEADING_MARKER 分开、并且先剥。
 * 为什么：`- 标题` 和 `1. 标题` 是两种独立的写法，用户可能只用其中一种。
 * 第一版把项目符号写进 LEADING_MARKER 的可选前缀里，
 * 结果 `- 高职…` 剥完 `- ` 之后还必须匹配到一个编号才整体成立，
 * 匹配失败连 `- ` 都不剥 —— 项目符号原样留进了标题里。
 * 拆成两步之后，"有符号剥符号，有编号剥编号，都没有就不动"。
 */
const LEADING_BULLET = /^\s*[-–—*·•]\s*/;

/** 「被引量：4」这类元信息，出现几次都删掉。 */
const CITED_MARKER = /\s*[(（]?\s*被引[量数]?\s*[:：]?\s*\d+\s*[)）]?/g;

/**
 * 标题和出处之间的分隔符。
 *
 * 只认带空格的短横线和竖线 —— 中文标题里本身就可能出现 "-"
 * （"短视频+N"、"产教融合-校企合作"），不带空格的不能当分隔符。
 * 逗号不在这里认：中文标题里逗号太常见，宁可把出处留在标题里
 * （多几个词只会让相似度略高一点，可以解释），也不要切错标题
 * （切错会把一篇真论文变成一条认不出来的碎句子）。
 */
const SEPARATOR = /\s+[-–—]\s+|\s*[｜|]\s*/;

/** 结尾括号里的年份：（2024） (2024)。 */
const TRAILING_YEAR_PAREN = /[（(]\s*((?:19|20)\d{2})\s*[）)]\s*$/;

/** 结尾裸写的年份：`… 2024` / `… 2024年`。 */
const TRAILING_YEAR_BARE = /[\s,，、]\s*((?:19|20)\d{2})\s*年?\s*$/;

/** 一整段里的四位年份，用来从"期刊名 2024"这种尾部抠年份。 */
const ANY_YEAR = /(?:19|20)\d{2}/;

/* ---------------------------------------------------------------
   4. 一条怎么解析
   --------------------------------------------------------------- */

/**
 * 解析一行。
 *
 * 返回 null 表示这一行不算一条文献（空行、太短、洗完之后啥也不剩）。
 * 调用方负责记警告 —— 这里不记，因为它不知道原行是第几行。
 */
function parseLine(rawLine: string): ManualRef | null {
  let line = rawLine.trim();
  if (line === "") return null;

  // 行首项目符号，再剥编号（两步，顺序固定）
  line = line.replace(LEADING_BULLET, "").trim();
  line = line.replace(LEADING_MARKER, "").trim();

  // 「被引量：4」
  line = line.replace(CITED_MARKER, "").trim();

  // 结尾括号年份
  let year = "";
  const parenYear = line.match(TRAILING_YEAR_PAREN);
  if (parenYear) {
    year = parenYear[1];
    line = line.slice(0, parenYear.index ?? 0).trim();
  }

  // 切成「标题」和「出处」两段
  let title = line;
  let rest = "";

  const parts = line.split(SEPARATOR).filter((part) => part.trim() !== "");
  if (parts.length >= 2) {
    title = parts[0].trim();
    rest = parts.slice(1).join(" ").trim();
  }

  // 出处尾部裸写的年份
  if (year === "" && rest !== "") {
    const bareYear = rest.match(TRAILING_YEAR_BARE);
    if (bareYear) {
      year = bareYear[1];
      rest = rest.slice(0, bareYear.index ?? 0).trim();
    }
  }

  // 没有分隔符时，标题自己可能带着裸年份
  if (year === "" && rest === "") {
    const bareYear = title.match(TRAILING_YEAR_BARE);
    if (bareYear) {
      year = bareYear[1];
      title = title.slice(0, bareYear.index ?? 0).trim();
    }
  }

  // 出处里如果还夹着年份（"中国职业技术教育 2023" 被切成两段时可能漏），再抠一次
  if (year === "" && rest !== "" && ANY_YEAR.test(rest)) {
    const m = rest.match(ANY_YEAR);
    if (m) year = m[0];
  }

  // 去掉标题两侧残留的括号、书名号、引号
  title = title
    .replace(/^[《〈「『"'"']+/, "")
    .replace(/[》〉」』"'"']+$/, "")
    .replace(/[，,、;；:：]+$/, "")
    .trim();

  const venue = rest
    .replace(/^[《〈「『"'"']+/, "")
    .replace(/[》〉」』"'"']+$/, "")
    .trim();

  if ([...title].length < MIN_TITLE_LENGTH) return null;

  return { title, venue, year };
}

/* ---------------------------------------------------------------
   5. 主函数
   --------------------------------------------------------------- */

/** 去重用的归一化：小写、只留字母数字和汉字。跟 lib/overlap.ts 的 normalizeTitle 同一套思路。 */
export function normalizeManualTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "")
    .trim();
}

/**
 * 把用户粘的一团文本解析成一组文献。
 *
 * 三条原则：
 *   1. **认不出来就跳过并说一声**，不猜。宁可少算一篇，
 *      也不要往池子里塞一个拼错的标题 —— 那会让分数悄悄偏掉。
 *   2. **按标题去重**。用户经常把同一篇粘两遍（一次带期刊名一次不带）。
 *   3. **上限 50 条**。粘一整篇参考文献目录不是这个功能的用法，
 *      而且几百条文献会让每条主张都撞上点什么，分数失去意义。
 */
export function parseManualRefs(raw: string): ManualParseOutcome {
  const warnings: string[] = [];

  if (typeof raw !== "string") {
    return { refs: [], warnings };
  }

  let text = raw;
  if (text.length > MAX_RAW_LENGTH) {
    text = text.slice(0, MAX_RAW_LENGTH);
    warnings.push(
      `粘的内容超过 ${MAX_RAW_LENGTH} 字，只看了前面那部分。文献多的话分几次查更准。`,
    );
  }

  const refs: ManualRef[] = [];
  const seen = new Set<string>();
  let tooShort = 0;

  for (const line of text.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (parsed === null) {
      // 只有编号或只有符号的行不算"太短"，那是格式不是内容，不用提醒用户
      const bare = line.replace(LEADING_BULLET, "").replace(LEADING_MARKER, "").trim();
      if (bare !== "") {
        tooShort += 1;
      }
      continue;
    }

    const key = normalizeManualTitle(parsed.title);
    if (key === "") continue;
    if (seen.has(key)) continue;

    if (refs.length >= MAX_REFS) {
      warnings.push(`最多认 ${MAX_REFS} 条，后面的没算。分几次查更准。`);
      break;
    }

    seen.add(key);
    refs.push(parsed);
  }

  if (tooShort > 0) {
    warnings.push(
      `有 ${tooShort} 行太短，没当成文献（少于 ${MIN_TITLE_LENGTH} 个字）。` +
        `如果那是编号或说明文字，忽略这条提醒就行。`,
    );
  }

  return { refs, warnings };
}

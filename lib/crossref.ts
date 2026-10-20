/**
 * Crossref 检索：查期刊论文有没有人做过。
 *
 * 为什么 arXiv 之外还要 Crossref：
 * arXiv 是理工预印本库，实测 all:vocational 全站只有 88 篇 ——
 * 职教、艺术教育、课程改革这类选题在 arXiv 上基本查不到。
 * Crossref 收的是正式发表的期刊论文（教育学、社科、艺术都覆盖），
 * 而且是唯一能拿到 DOI 的地方，DOI 是论文的身份证，写进报告才可核验。
 *
 * 两个源的分工：
 *   arXiv    → 新，快，偏理工，能看出"最近有没有人正在做"
 *   Crossref → 全，正式，能看出"这个方向有没有被发表过"
 * 只用一个都会误判，所以第 13 步要两个都查。
 */

const CROSSREF_ENDPOINT = "https://api.crossref.org/works";

/**
 * Crossref 的礼貌池（polite pool）要求请求里带联系方式。
 * 带了之后进"礼貌池"，限速宽松、响应更快；不带会被降级到公共池。
 * 官方建议放在 User-Agent 和 mailto 参数里各一次。
 *
 * 这里从环境变量读，没配就用一个占位地址 ——
 * 占位地址也能进礼貌池（Crossref 只做登记不验证），
 * 但正式发布时应该换成真实联系方式，这是对公共服务的礼貌。
 */
const CONTACT_EMAIL = process.env.CROSSREF_MAILTO || "soft-spot@example.com";

/** 单次请求超时。 */
const TIMEOUT_MS = 20000;

/** 默认取几条。 */
const DEFAULT_ROWS = 5;

/**
 * 空响应重试次数。
 *
 * 实测 Crossref 会间歇性返回 200 但 body 长度为 0（不是 429，也不是报错）。
 * 连续查五个词时大约每两三个就会撞上一次。
 * 这不是我们代码的问题，但如果不重试，用户就会看到"这个方向没人做过"的假结论。
 * 所以必须重试，而且要等几秒 —— 立刻重试还是 0 字节。
 */
const EMPTY_RETRY = 2;
const EMPTY_RETRY_DELAY_MS = 4000;

/** 一条期刊论文记录。 */
export type CrossrefHit = {
  /** 论文唯一编号，形如 "10.1080/13636820.2023.1234567" */
  doi: string;
  title: string;
  /** 四位年份。取不到时是空字符串。 */
  year: string;
  authors: string[];
  /** 期刊/会议名。Crossref 里叫 container-title，取不到时是空字符串。 */
  journal: string;
  /** 给人点的链接，指向 doi.org */
  url: string;
};

/**
 * 检索结果。和 arXiv 一样分两种「没结果」：
 *   ok: true  + hits: []  → 查了，真没人做过
 *   ok: false             → 没查成（超时/限流/返回空）
 */
export type CrossrefOutcome =
  | {
      ok: true;
      hits: CrossrefHit[];
      /**
       * ⚠️ 这个数不能当"别人做过多少"用。
       *
       * 实测：query.bibliographic 随便三个词就有 300 多万条，
       * query.title 一个词 vocational 有 59713 条 —— 它其实是模糊匹配的规模，
       * 几乎等于整个库。拿它当重合度分母，所有主张都会被判成"撞车"。
       *
       * 保留它只为了两个用途：
       *   1. 调试时看查询是不是太宽
       *   2. 判断"这次查询是不是完全没命中"（=0 才算）
       * 第 12 步算分时用 hits 的内容相似度，不用这个数。
       */
      totalResults: number;
      warnings: string[];
    }
  | { ok: false; error: string };

type SearchOptions = {
  rows?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Crossref 的 title / container-title 是数组（历史遗留），
 * 而且可能是空数组、可能第一项是 null。统一压成一个字符串。
 */
function firstString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) {
        return item.trim();
      }
    }
  }
  return "";
}

/**
 * 从 published.date-parts 里抠年份。
 *
 * 结构是 [[2025, 9, 1]]，但真实数据里有各种残缺：
 *   [[2023]]        → 只有年
 *   [[null]]        → 全空
 *   []              → 空数组
 *   [[2023, null]]  → 月是 null
 * 所以不能直接取 [0][0]，必须判类型。
 */
function extractYear(published: unknown): string {
  if (!published || typeof published !== "object") return "";
  const dateParts = (published as { "date-parts"?: unknown })["date-parts"];
  if (!Array.isArray(dateParts) || !Array.isArray(dateParts[0])) return "";

  const year = dateParts[0][0];
  if (typeof year !== "number" || !Number.isFinite(year)) return "";

  const asString = String(Math.trunc(year));
  return /^\d{4}$/.test(asString) ? asString : "";
}

/**
 * 作者：Crossref 里每项可能是 { given, family } 也可能只有 { name }（机构作者）。
 * 拼成"名 姓"，都取不到就跳过。
 */
function parseAuthors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const authors: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const author = item as { given?: unknown; family?: unknown; name?: unknown };

    if (typeof author.name === "string" && author.name.trim()) {
      authors.push(author.name.trim());
      continue;
    }

    const given = typeof author.given === "string" ? author.given.trim() : "";
    const family = typeof author.family === "string" ? author.family.trim() : "";
    const full = [given, family].filter(Boolean).join(" ");
    if (full) authors.push(full);
  }

  return authors;
}

/**
 * 这些 type 不是论文，是论文里的零件。
 *
 * 实测（拿方法论词当 query.bibliographic 去查）8 条结果里有 4 条是 component：
 *
 *   type=component | Table 5: Inter-rater reliability analysis.
 *   type=component | Supplement 2. Leave-one-out cross-validation of the predictive model
 *   type=component | Figure 5: Model performance of test dataset
 *
 * 这些是论文内部的表格和附录。Crossref 给它们单独发了 DOI，所以是合法记录，
 * 但它们不是「有人做过这个研究」，是「某篇论文里有一张表」。
 *
 * 为什么必须挡掉：它们的标题里全是方法论词（inter-rater reliability、
 * leave-one-out cross-validation），跟「我打算用这个方法」这类主张共有词特别多，
 * 于是拿到很高的相似度。实测某条主张的最像记录就是「Table 5: Inter-rater
 * reliability analysis.」—— 年份空、期刊空，却把这条主张从 46 分顶到 66 分，
 * 还白送了「4 篇沾边」的广度加分。
 *
 * 这是横轴虚高的一个真实来源，也是纯 bug：一张表格不能证明别人做过你的研究。
 */
const NON_PAPER_TYPES = new Set([
  "component",
  "reference-entry",
  "peer-review",
  "grant",
  "dataset",
  "journal-issue",
  "journal-volume",
  "report-component",
  "standard",
]);

/**
 * 第二道网：有些碎片记录的 type 标得不对，但标题一看就是零件。
 *
 * 要求「表/图/附录」这类词后面紧跟数字，避免误伤
 * 「Figure and Ground in Visual Perception」这种真论文标题。
 */
const FRAGMENT_TITLE =
  /^(?:table|figure|fig\.?|supplement(?:al|ary)?|appendix|scheme|chart|box)\b[\s.:]*\d/i;

/**
 * 这条记录像不像一篇论文。
 *
 * 两道判定：type 不在黑名单里，且标题不是表格/附录碎片。
 * 不要求有期刊名或年份 —— 预印本本来就可能只有年份没有期刊，
 * 那是合法的论文，不该被当成碎片扔掉。
 *
 * 导出是为了能被自检脚本直接调用：这条规则只跟记录的形状有关，
 * 不需要联网就能验，不该塞进那个要真查 Crossref 的脚本里。
 */
export function looksLikePaper(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const item = raw as Record<string, unknown>;

  const type = typeof item.type === "string" ? item.type.trim().toLowerCase() : "";
  if (NON_PAPER_TYPES.has(type)) return false;

  const title = firstString(item.title);
  if (!title) return false;
  if (FRAGMENT_TITLE.test(title)) return false;

  return true;
}

/** 把一条 item 解析成 CrossrefHit。缺 DOI 或标题就返回 null。 */
function parseItem(raw: unknown): CrossrefHit | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;

  const doi = typeof item.DOI === "string" ? item.DOI.trim() : "";
  const title = firstString(item.title);

  // DOI 和标题是底线。没有 DOI 的记录没法核验，等于没法用。
  if (!doi || !title) return null;

  return {
    doi,
    title: title.replace(/\s+/g, " "),
    year: extractYear(item.published),
    authors: parseAuthors(item.author),
    journal: firstString(item["container-title"]),
    url: `https://doi.org/${doi}`,
  };
}

/** 发一次请求，返回解析好的 JSON 或一个错误说明。 */
async function requestOnce(
  url: string,
): Promise<{ ok: true; body: unknown } | { ok: false; error: string; empty: boolean }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": `soft-spot/0.1 (mailto:${CONTACT_EMAIL})`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, error: `Crossref 超过 ${TIMEOUT_MS / 1000} 秒没回话`, empty: false };
    }
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `连不上 Crossref：${detail}`, empty: false };
  }

  if (!response.ok) {
    if (response.status === 429) {
      return { ok: false, error: "Crossref 说请求太频繁（429）", empty: false };
    }
    if (response.status >= 500) {
      return { ok: false, error: `Crossref 服务端出错（${response.status}）`, empty: false };
    }
    return { ok: false, error: `Crossref 返回 ${response.status}`, empty: false };
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    return { ok: false, error: "Crossref 的响应读到一半断了", empty: false };
  }

  /*
     实测：Crossref 会间歇性返回 200 + 空 body。
     这不是限流（限流会返回 429），也不是我们请求写错了，
     是它自己的偶发问题。标记成 empty: true，交给上层重试。
  */
  if (!text.trim()) {
    return { ok: false, error: "Crossref 返回了空内容", empty: true };
  }

  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, error: "Crossref 返回的不是合法 JSON", empty: false };
  }
}

/**
 * 查一次 Crossref。
 *
 * 传进去的是英文关键词。
 *
 * 关于中文：实测 Crossref 里**确实有中文期刊**（中国的期刊注册了 DOI 就会进来），
 * 用「高职 短视频 教学」查能查出《高职院校非遗多语种短视频传播效果研究》这种真论文。
 * 但准确度不稳 —— 「镜头语言 教学」会混进汉语言教学、生态语言学的论文，
 * 因为它按词面匹配，不理解"镜头语言"是个专业术语。
 * 所以中文查询当加分项用：查得准是惊喜，查不准也不影响主流程，
 * 真正的兜底还是第 19 步让用户自己粘中文文献。
 *
 * 这个函数永远不抛异常，所有失败都变成 ok: false。
 */
export async function searchCrossref(
  query: string,
  options: SearchOptions = {},
): Promise<CrossrefOutcome> {
  const trimmed = query.trim();

  if (!trimmed) {
    return { ok: false, error: "检索词是空的，没东西可查" };
  }

  const rows = Math.min(Math.max(options.rows ?? DEFAULT_ROWS, 1), 20);

  /*
     只查 select 里这几列，不拉整个记录。
     Crossref 单条完整记录可能有几十 KB（含参考文献列表），
     拉 5 条就几百 KB，而我们只需要这几个字段。

     type 是第 25 步加的：没有它就分不出「一篇论文」和「某篇论文里的一张表」，
     而后者会把横轴分数抬高一整档（见 NON_PAPER_TYPES 的注释）。
  */
  const select = ["DOI", "title", "author", "published", "container-title", "type"].join(",");

  const url =
    `${CROSSREF_ENDPOINT}?query.bibliographic=${encodeURIComponent(trimmed)}` +
    `&rows=${rows}&select=${select}&mailto=${encodeURIComponent(CONTACT_EMAIL)}`;

  const warnings: string[] = [];
  let body: unknown = null;
  let lastError = "";

  for (let attempt = 0; attempt <= EMPTY_RETRY; attempt += 1) {
    const result = await requestOnce(url);

    if (result.ok) {
      body = result.body;
      break;
    }

    lastError = result.error;

    // 只有"空内容"值得重试，超时和 429 重试也白搭
    if (!result.empty || attempt === EMPTY_RETRY) {
      return { ok: false, error: result.error };
    }

    warnings.push(`Crossref 返回空内容，${EMPTY_RETRY_DELAY_MS / 1000} 秒后重试`);
    await sleep(EMPTY_RETRY_DELAY_MS);
  }

  if (!body) {
    return { ok: false, error: lastError || "Crossref 没有返回内容" };
  }

  const message = (body as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    return { ok: false, error: "Crossref 返回的结构里没有 message 字段" };
  }

  const msg = message as { items?: unknown; "total-results"?: unknown };
  const items = Array.isArray(msg.items) ? msg.items : [];
  const totalResults = typeof msg["total-results"] === "number" ? msg["total-results"] : 0;

  const hits: CrossrefHit[] = [];
  let dropped = 0;

  for (const item of items) {
    /*
       先判是不是论文，再解析字段。
       顺序很重要：碎片记录也可能有 DOI 和标题，parseItem 会照收，
       所以不能靠 parseItem 返回 null 来过滤。
    */
    if (!looksLikePaper(item)) {
      dropped += 1;
      continue;
    }

    const hit = parseItem(item);
    if (hit) {
      hits.push(hit);
    } else {
      warnings.push("Crossref 返回了 1 条缺 DOI 或标题的记录，已跳过");
    }
  }

  /*
     挡掉了几条要说出来。
     不说的话，用户看到「5 条里只回来 1 条」会以为是网络问题；
     说出来他才知道是 Crossref 把论文里的表格也编了号。
  */
  if (dropped > 0) {
    warnings.push(
      `Crossref 回来的 ${items.length} 条里有 ${dropped} 条是论文里的表格或附录（不是论文本身），已跳过`,
    );
  }

  return { ok: true, hits, totalResults, warnings };
}

/**
 * 查一组检索词，串行跑。
 *
 * 为什么串行：Crossref 对短时间连续请求会返回空内容（实测），
 * 串行 + 每次之间停 1 秒，能显著降低撞空响应的概率。
 * 内部已经有空响应重试，这里的间隔是第二道保险。
 */
const MIN_INTERVAL_MS = 1000;
let lastRequestAt = 0;

export async function searchCrossrefMany(
  queries: string[],
  options: SearchOptions = {},
): Promise<{ query: string; outcome: CrossrefOutcome }[]> {
  const results: { query: string; outcome: CrossrefOutcome }[] = [];

  for (const query of queries) {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }
    lastRequestAt = Date.now();

    results.push({ query, outcome: await searchCrossref(query, options) });
  }

  return results;
}

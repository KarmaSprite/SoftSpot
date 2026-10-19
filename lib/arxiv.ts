/**
 * arXiv 检索：拿英文关键词去查「这个想法别人做过没有」。
 *
 * 为什么选 arXiv：
 * 免费、不用 key、不用注册，返回的是标准 Atom XML。
 * 它的代价是只覆盖预印本（理工科为主），
 * 教育学、艺术类的期刊论文基本查不到 —— 这个缺口由 Crossref 补（第 10 步），
 * 再不行由用户自己粘中文文献补（第 19 步）。
 *
 * 为什么不用 XML 库：
 * 我们只读五个字段（id / title / summary / published / author），
 * Atom 的 entry 结构固定得像 CSV。引一个解析器要多几百 KB，
 * 而且真出错时它抛的堆栈比我们自己的正则报错更难懂。
 */

const ARXIV_ENDPOINT = "https://export.arxiv.org/api/query";

/**
 * arXiv 官方要求：同一 IP 每 3 秒最多一次请求。
 * 官方原话是 "no more than one request every three seconds"，
 * 超了会被限速甚至临时封 IP。
 *
 * 这里用模块级变量记「上一次请求是什么时候」，
 * 而不是让调用方自己 sleep —— 因为调用方有好几个（第 13 步要并发降级），
 * 限速这种事必须收在一个地方，否则总有人忘。
 *
 * 注意：这个变量只在同一个 Node 进程里有效。
 * 开发环境下 Next 的模块是常驻的，所以够用；
 * 真部署到多实例的话，限速得挪到外部（比如 Redis）。
 */
const MIN_INTERVAL_MS = 3000;
let lastRequestAt = 0;

/** 单次请求超时。arXiv 偶尔很慢，15 秒还没回就当它挂了。 */
const TIMEOUT_MS = 15000;

/** 默认一次取几条。5 条够用来判断"有没有人做过"，多了只是噪声。 */
const DEFAULT_MAX_RESULTS = 5;

/** arXiv 要求带 User-Agent，否则可能直接 403。 */
const USER_AGENT = "pre-defense/0.1 (academic outline checker; contact: local demo)";

/** 一条检索结果。 */
export type ArxivHit = {
  /** 去掉版本号的 arXiv id，例如 "2608.06932" */
  id: string;
  title: string;
  summary: string;
  /** 发布年份，四位数字字符串。取不到时是空字符串。 */
  year: string;
  authors: string[];
  /** 给人点的链接 */
  url: string;
};

/**
 * 检索结果。
 *
 * 这里刻意区分两种「没结果」：
 *   ok: true  + hits: []  → 查了，真没人做过。这是好消息，要告诉用户。
 *   ok: false             → 没查成（超时/限速/挂了）。这是坏消息，也要说实话。
 * 把两者混成一种，用户就会把"我不知道"读成"没人做过"，
 * 那这份报告的结论就是假的。
 */
export type ArxivOutcome =
  | { ok: true; hits: ArxivHit[]; totalResults: number; warnings: string[] }
  | { ok: false; error: string };

type SearchOptions = {
  maxResults?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 等到离上一次请求满 3 秒。
 *
 * 只等不退：如果上一次请求是 10 秒前，这里算出负数，就不等了。
 * 注意要更新 lastRequestAt 在真正发请求之前，
 * 否则两个并发调用会同时通过检查、同时发出去。
 */
async function respectRateLimit(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) {
    await sleep(wait);
  }
  lastRequestAt = Date.now();
}

/** XML 里那几个转义字符。arXiv 的标题里经常出现 &amp; 和 &#39;。 */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    // &amp; 必须放最后，否则 "&amp;lt;" 会被先解成 "<" 再多解一次
    .replace(/&amp;/g, "&");
}

/**
 * 抠出一个标签里的文本。
 *
 * 为什么必须处理「找不到」：arXiv 偶尔会返回缺 published 的 entry
 * （早期预印本没有这个字段）。缺了就是缺了，返回空串，
 * 让上层决定要不要提示，而不是在这里抛异常把整次检索废掉。
 */
function pickTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? decodeEntities(match[1]).trim() : "";
}

/** 标题和摘要里会有硬换行和连续空格，压成单空格，否则表格里会断得很难看。 */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 把一条 <entry> 解析成 ArxivHit。解析不出来就返回 null，由调用方跳过。 */
function parseEntry(entryXml: string): ArxivHit | null {
  const rawId = pickTag(entryXml, "id");
  const title = collapseWhitespace(pickTag(entryXml, "title"));

  // id 和标题是底线：缺任何一个这条就没法用
  if (!rawId || !title) {
    return null;
  }

  // http://arxiv.org/abs/2608.06932v1 → 2608.06932
  const idMatch = rawId.match(/abs\/(.+?)(?:v\d+)?$/);
  const id = idMatch ? idMatch[1] : rawId;

  // <author><name>X</name></author> 可能出现零到多次
  const authors: string[] = [];
  const authorRe = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g;
  let authorMatch: RegExpExecArray | null;
  while ((authorMatch = authorRe.exec(entryXml)) !== null) {
    const name = collapseWhitespace(decodeEntities(authorMatch[1]));
    if (name) authors.push(name);
  }

  const published = pickTag(entryXml, "published");
  const year = /^\d{4}/.test(published) ? published.slice(0, 4) : "";

  return {
    id,
    title,
    summary: collapseWhitespace(pickTag(entryXml, "summary")),
    year,
    authors,
    url: `https://arxiv.org/abs/${id}`,
  };
}

/**
 * 把整段 Atom 拆成 entry 再逐条解析。
 * 拆不出来时返回空数组，而不是抛错 —— 调用方会把它当成"没有结果"，
 * 但那和"解析失败"不是一回事，所以这里会额外返回一个警告。
 */
function parseFeed(xml: string): { hits: ArxivHit[]; totalResults: number; warnings: string[] } {
  const warnings: string[] = [];

  /*
     totalResults 是"这个查询在全站命中多少篇"，跟"我们取回了几条"是两件事。
     这个数很重要：命中 3 篇和命中 30 万篇是完全不同的信号。
     第 12 步算重合度时要拿它当分母，光看取回的 5 条会严重低估。
     取不到就当 0，并记一条警告 —— 但不要因此判整次检索失败。
  */
  const totalMatch = xml.match(/<opensearch:totalResults[^>]*>(\d+)</);
  const totalResults = totalMatch ? Number(totalMatch[1]) : 0;
  if (!totalMatch && xml.includes("<feed")) {
    warnings.push("arXiv 没返回命中总数，重合度只能按取回的条数估算");
  }

  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g);

  if (!entries) {
    // arXiv 查不到东西时返回的是合法 feed，只是没有 entry。
    // 但如果连 <feed> 都没有，那就是我们拿到的不是 Atom，得说一声。
    if (!xml.includes("<feed")) {
      warnings.push("arXiv 返回的不是 Atom 格式，可能是接口地址变了");
    }
    return { hits: [], totalResults, warnings };
  }

  const hits: ArxivHit[] = [];
  for (const entry of entries) {
    const hit = parseEntry(entry);
    if (hit) {
      hits.push(hit);
    } else {
      warnings.push("arXiv 返回了 1 条解析不出来的记录，已跳过");
    }
  }

  return { hits, totalResults, warnings };
}

/**
 * 查一次 arXiv。
 *
 * 传进去的是英文关键词，比如 `"short video" AND education`。
 * 中文直接传进去查不到东西 —— 中文要先由 L2-A（第 11 步）翻成英文。
 *
 * 实测过的查询语法（arXiv 用的是自己的 Solr 方言）：
 *   all:"action research" AND all:education  → 17 条  ✅ 短语 + AND 可用
 *   all:"action research" AND all:vocational →  0 条  ← 真没交集，不是写法错
 *   all:action AND all:research AND all:vocational → 2 条  ← 拆开反而有量
 * 也就是说 AND 是严格的（拿回的 160 条里绝大多数只命中 2 个词是摘要里的变形），
 * 但**短语要求整串原样出现**，中文翻出来的英文短语越长，命中越少。
 * 所以第 11 步写检索词时要给"拆开的关键词"和"整串短语"两种，都查一遍取并集。
 *
 * 这个函数永远不抛异常：所有失败都变成 ok: false。
 * 理由和第 13 步一致 —— 一个检索源挂掉不该让整份报告生不出来。
 */
export async function searchArxiv(
  query: string,
  options: SearchOptions = {},
): Promise<ArxivOutcome> {
  const trimmed = query.trim();

  if (!trimmed) {
    return { ok: false, error: "检索词是空的，没东西可查" };
  }

  const maxResults = Math.min(Math.max(options.maxResults ?? DEFAULT_MAX_RESULTS, 1), 20);

  // search_query 里允许 AND / OR 这种运算符，所以不能整个 encodeURIComponent，
  // 只能把用户给的词按空格和引号原样放进去，其余部分自己拼。
  // 这里用 encodeURIComponent 处理引号外的空格，保留引号和运算符。
  const encodedQuery = encodeURIComponent(trimmed).replace(/%20/g, "+");
  const url = `${ARXIV_ENDPOINT}?search_query=${encodedQuery}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;

  await respectRateLimit();

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/atom+xml",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, error: `arXiv 超过 ${TIMEOUT_MS / 1000} 秒没回话，这次跳过` };
    }
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `连不上 arXiv：${detail}` };
  }

  if (!response.ok) {
    if (response.status === 429) {
      return { ok: false, error: "arXiv 说我们查太快了（429），这次跳过" };
    }
    if (response.status >= 500) {
      return { ok: false, error: `arXiv 服务端出错（${response.status}），这次跳过` };
    }
    return { ok: false, error: `arXiv 返回 ${response.status}，这次跳过` };
  }

  let xml: string;
  try {
    xml = await response.text();
  } catch {
    return { ok: false, error: "arXiv 的响应读到一半断了，这次跳过" };
  }

  const { hits, totalResults, warnings } = parseFeed(xml);
  return { ok: true, hits, totalResults, warnings };
}

/**
 * 查一组检索词，串行跑。
 *
 * 为什么串行：arXiv 限速是按 IP 算的，并发只会撞 429。
 * 串行的代价是 3 个词要 6 秒以上，但换来的是稳定。
 * 第 13 步会让 arXiv 和 Crossref 并发 —— 那是跨源并发，各自守各自的限速，不冲突。
 */
export async function searchArxivMany(
  queries: string[],
  options: SearchOptions = {},
): Promise<{ query: string; outcome: ArxivOutcome }[]> {
  const results: { query: string; outcome: ArxivOutcome }[] = [];

  for (const query of queries) {
    results.push({ query, outcome: await searchArxiv(query, options) });
  }

  return results;
}

/**
 * DeepSeek 官方联网搜索 —— 用来补中文文献。
 *
 * 为什么需要这一层：
 * 第 9、10 步接的 arXiv 和 Crossref 都是英文学术库。
 * arXiv 是理工预印本库，实测 `all:vocational` 全站只有 88 篇；
 * Crossref 里中文期刊有，但准确度不稳。
 * 而知网、万方、维普这些真正存中文职教论文的地方，都没有面向个人的 API
 * （只有机构采购，第三方转售要实名和应用场景审核），所以接不了。
 *
 * 能补上这个缺口的只有网页搜索：实测拿「高职院校 短视频 教学改革 研究」去查，
 * 直接返回《高职院校短视频创作课程混合式教学改革策略》
 * 《短视频融入高职院校思政课教学策略研究-淮南职业技术学院学报2025年02期》——
 * 这些正是前两个库查不到的中文期刊。
 *
 * 但这一层是**加餐**，不是主菜。所以：
 *   1. 没配 key 必须能干净地跳过，不能拖垮整个流程
 *   2. 查不到、查失败都只记一句警告，绝不影响 arXiv/Crossref 给出的分数
 *   3. 它单独算一个源，不计入「有几个源答话了」的主判定
 *
 * 为什么不用 SDK：跟 lib/deepseek.ts 一样，直接 fetch。
 * 少一个依赖就少一个能崩的地方。
 */

/* ---------------------------------------------------------------
   1. 常量
   --------------------------------------------------------------- */

import type { RetrievalQuery } from "./schema.ts";

export const SEARCH_ENDPOINT = "https://api.deepseek.com/v1/tools/search";

/**
 * 单价：5 元 / 千次 = 0.005 元 / 次。
 *
 * 跟 token 计费不同，搜索是**按次**算的，跟返回多少条无关。
 * 所以一次分析里查几次就能精确算出花了几毛钱。
 */
export const PRICE_PER_CALL = 0.005;

/**
 * 一次取几条。
 *
 * 6 条是权衡：返回 10 条时后面几条常常是同一个学校的不同新闻，
 * 对"别人做过吗"没有新增信息，但会让用户多读四段废话。
 * 取 6 条既够看出趋势，又不至于把报告撑爆。
 */
export const DEFAULT_COUNT = 6;

/**
 * 官方限速 5 QPS，按账号算。
 *
 * 留一半余量取 250ms —— 这个接口跟 arXiv 不一样，它很快（实测 1 秒内），
 * 所以间隔设小一点也不会明显拖慢整体。
 */
export const MIN_INTERVAL_MS = 250;

/** 超时 15 秒。搜索比模型快得多，15 秒还没回就是真卡住了。 */
export const DEFAULT_TIMEOUT_MS = 15_000;

/* ---------------------------------------------------------------
   2. 类型
   --------------------------------------------------------------- */

/** 一条搜索结果，字段是实测出来的（见下面的 SearchResponse）。 */
export type WebHit = {
  /** 归一化后的 url，用来去重 */
  key: string;
  title: string;
  /** 摘要片段，显示给人看。不参与相似度计算 */
  snippet: string;
  url: string;
  /** 站点名，可能是 null（实测有） */
  site: string;
  /** 权威度，实测 3-4。只记录不筛选 */
  authority: number;
  /** 发布时间，可能是空串 */
  date: string;
};

/**
 * 搜索的结局。
 *
 * **skipped 和 error 必须分开**，这是这个文件最重要的设计：
 *   - skipped: true  = 没配 key，这次主动不查（正常情况，用户可能是故意的）
 *   - skipped: false = 配了 key 但查失败了（要提醒用户）
 * 混成一种，没配 key 的用户会在报告里看到"中文搜索失败"，
 * 以为程序坏了，其实是他自己没配。
 */
export type WebSearchOutcome =
  | { ok: true; hits: WebHit[]; rawCount: number; warnings: string[] }
  | { ok: false; error: string; skipped: boolean };

export type WebSearchOptions = {
  apiKey?: string;
  count?: number;
  timeoutMs?: number;
  /**
   * 可注入的 fetch。
   *
   * 跟 lib/search.ts 的 Searchers 一个思路：降级逻辑最需要测的就是
   * "接口挂了会怎样"，而真让它挂掉要等 15 秒超时。
   * 注入之后，一个直接 reject 的假函数就能模拟超时，自检不用联网也不用花钱。
   */
  fetchImpl?: typeof fetch;
};

/* ---------------------------------------------------------------
   3. 接口返回的形状
   --------------------------------------------------------------- */

/**
 * 实测的响应结构（2026-10 探测）：
 *
 * {
 *   "results": [{
 *     "title": "...",
 *     "site_name": "Univs" | null,
 *     "site_icon": "https://cdn.deepseek.com/...",
 *     "authority": 3,
 *     "rerank_score": 1.98,
 *     "date": "2025-12-29T16:00:00+00:00",
 *     "url": "https://...",
 *     "summary": "...(很长，1000+ 字)",
 *     "snippet": "...(短)",
 *     "content": ""            ← 实测永远是空串
 *   }]
 * }
 *
 * 注意没有 total 字段 —— 这个接口不告诉你"全站一共多少条"，
 * 所以不能像 Crossref 那样拿命中数当规模参考。
 */
type SearchResponse = {
  results?: (
    | {
        title?: string;
        site_name?: string | null;
        authority?: number;
        date?: string;
        url?: string;
        summary?: string;
        snippet?: string;
        content?: string;
      }
    | null
  )[];
  error?: { message?: string; type?: string };
};

/* ---------------------------------------------------------------
   4. 配置检查
   --------------------------------------------------------------- */

/**
 * key 配了没有。
 *
 * 只判空和长度，不判格式 —— 格式对不对要真发一次请求才知道，
 * 在这里拦反而会把"格式看着怪但其实能用"的 key 挡在外面。
 */
export function isWebSearchConfigured(apiKey?: string): boolean {
  const key = (apiKey ?? process.env.DEEPSEEK_API_KEY ?? "").trim();
  return key.length > 0;
}

/* ---------------------------------------------------------------
   5. 限速
   --------------------------------------------------------------- */

/**
 * 模块级变量记上次请求时间。
 *
 * 跟 lib/arxiv.ts 一样：先更新变量再等待，这样两个并发调用
 * 不会同时看到"刚查过"然后一起等、一起发。
 */
let lastRequestAt = 0;

async function respectRateLimit(): Promise<void> {
  const now = Date.now();
  const wait = lastRequestAt + MIN_INTERVAL_MS - now;
  lastRequestAt = Math.max(now, lastRequestAt + MIN_INTERVAL_MS);
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/* ---------------------------------------------------------------
   6. url 归一化 + 去重
   --------------------------------------------------------------- */

/**
 * 归一化 url。
 *
 * 为什么需要：同一篇文章被不同站点转载时标题一样、url 不同，
 * 光按 title 去重会漏（标题会带站点前缀），光按 url 去重会重复。
 * 这里先把明显等价的形式抹平：
 *   - 去掉协议（http / https 当成一回事）
 *   - 去掉末尾斜杠
 *   - 去掉锚点（#1、#51#10 这种，实测 DeepSeek 返回的 url 常带）
 *   - 去掉开头的 www.
 * 剩下的部分当 key。
 */
export function normalizeUrl(url: string): string {
  let out = url.trim().toLowerCase();
  out = out.replace(/^https?:\/\//, "");
  out = out.replace(/^www\./, "");
  out = out.replace(/#.*$/, "");
  out = out.replace(/\/+$/, "");
  return out;
}

/**
 * 去重。
 *
 * 先按归一化 url，再按标题（标题太短的不参与，避免「课程简介」这种误伤）。
 * 跟 lib/overlap.ts 的 dedupeHits 是同一套思路。
 */
export function dedupeWebHits(hits: WebHit[]): WebHit[] {
  const seenKey = new Set<string>();
  const seenTitle = new Set<string>();
  const result: WebHit[] = [];

  for (const hit of hits) {
    const titleKey = normalizeTitle(hit.title);
    if (seenKey.has(hit.key)) continue;
    if (titleKey.length >= 12 && seenTitle.has(titleKey)) continue;

    seenKey.add(hit.key);
    if (titleKey.length >= 12) seenTitle.add(titleKey);
    result.push(hit);
  }

  return result;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "")
    .trim();
}

/* ---------------------------------------------------------------
   6.5 拼查询词 + 洗标题 + 判断是不是论文
   --------------------------------------------------------------- */

/**
 * 查询词后缀。
 *
 * 实测出来的差别（2026-10，同一主题三组对照）：
 *   `镜头语言 叙事能力 高职`            → 学银在线课程页、教材征订页、《短视频剪辑与制作》教案
 *   `镜头语言 叙事能力 高职 研究 论文`  → 万方《电影镜头语言的美学研究》、
 *                                        维普《摄像作品中的镜头语言与叙事方式分析》、
 *                                        Napstic《Vlog镜头语言与电影镜头语言的叙事差异化研究》
 *
 * 光给核心词，查回来的是**课程和教材**，那不是「别人做过这个研究」的证据。
 * 加上「研究 论文」，才把结果往文献那一侧拽。
 *
 * 这是搜索接口的特性：它做的是网页检索，不是学术库检索，
 * 只能靠查询词里的语气去影响它把哪一类页面排在前面。
 */
export const WEB_QUERY_SUFFIX = "研究 论文";

/**
 * 拼一条中文查询词。
 *
 * 用 intent.zhQuery 而不是主张原文：
 * 那个字段是 L2-A 翻译时模型挑出来的核心中文词（2-4 个），
 * 比一整句主张更适合当检索词 —— 原文里的「采用」「提升」「的方式」
 * 这些词会把检索结果带偏。
 *
 * 后缀去重：zhQuery 里已经含「研究」或「论文」时不再加，
 * 否则会拼出「行动研究 研究 论文 研究」，同一个词重复三次反而稀释了权重。
 */
export function buildWebQuery(intent: RetrievalQuery): string {
  const base = intent.zhQuery.trim().replace(/\s+/g, " ");

  const parts = [base];
  for (const word of WEB_QUERY_SUFFIX.split(" ")) {
    if (!base.includes(word)) parts.push(word);
  }

  return parts.join(" ");
}

/**
 * 洗网页标题。
 *
 * 实测 DeepSeek 返回的标题长这样（都是真样本）：
 *   「短视频融入高职院校思政课教学策略研究-淮南职业技术学院学报2025年02期-手机知网」
 *   「高职院校短视频创作课程混合式教学改革策略 - 高职院校短视频创作课程混合式教学改」
 *   「高职院校「短视频+N」网络育人模式的实践路径探索 - 期刊文献+」
 *   「高职动画剧本创作课程信息化教学设计与实践：提升原创叙事能力与镜头语言素养 - CSD」
 *   「某论文标题（被引量：4）」
 *
 * 不清洗直接算相似度会出事：`手机知网`、`期刊文献`、`CSD` 这些词
 * 跟主张毫无关系，却会凭空加上覆盖率。而且「标题 - 标题」这种重复
 * 会让同一批词算两遍，把密度那一项顶高。
 *
 * 处理四类：
 *   1. `被引量：4` 这类元信息
 *   2. 尾部站名（循环剥，因为「- A - 手机知网」要剥两下）
 *   3. 「标题 - 标题」的重复
 *   4. 「-期刊名2025年02期」这类期刊信息尾巴
 */
export function cleanTitle(raw: string): string {
  let s = raw.trim();

  // 1. 元信息
  s = s.replace(/被引量[：:]\s*\d+/g, "").trim();
  // 元信息被删空之后剩下的空括号
  s = s.replace(/[（(]\s*[)）]/g, "").trim();

  // 2. 尾部站名。循环剥，最多三次
  const SITE_TAIL =
    /[\s\-—|｜·]*[\s(（]*(手机知网|知网|维普网|万方|龙源期刊网|钛学术|学术之家|期刊文献\+|期刊文献|CSDN|Napstic|Scilit|收藏)[)）]?\s*$/i;

  for (let i = 0; i < 3; i += 1) {
    const next = s.replace(SITE_TAIL, "").trim();
    if (next === s) break;
    s = next;
  }

  // 尾部被截断的英文站名（实测 CSDN 被截成 CSD）
  s = s.replace(/[\s\-—|｜·]+[A-Za-z]{2,8}\s*$/, "").trim();

  // 3. 「标题 - 标题」重复
  const dash = s.indexOf(" - ");
  if (dash > 6) {
    const head = s.slice(0, dash).trim();
    const tail = s.slice(dash + 3).trim();
    if (tail.startsWith(head.slice(0, 10))) {
      s = head;
    }
  }

  // 4. 「-期刊名2025年02期」这类尾巴，留着会污染相似度
  s = s.replace(/[\-—]\s*[^\-—]{0,30}?\d{4}\s*年\s*\d{1,2}\s*期.*$/, "").trim();

  // 收尾：清掉两端残留的分隔符
  return s.replace(/^[\s\-—|｜·]+|[\s\-—|｜·]+$/g, "").trim();
}

/**
 * 学术库站名。命中这些就当「论文」处理，不打折。
 *
 * 为什么要判这个：一篇正式发表的论文和一篇 CSDN 笔记，
 * 对「别人做过吗」是不同强度的证据。但也不能只看站点 ——
 * 有些论文的标题出现在非学术站点上（比如学校官网转载的学报目录）。
 */
const ACADEMIC_SITES = [
  "知网",
  "cnki",
  "维普",
  "万方",
  "龙源",
  "钛学术",
  "学术之家",
  "读秀",
  "超星",
  "cnjournals",
  "期刊界",
  "napstic",
  "scilit",
  "researchgate",
  "semantic scholar",
];

/** 标题里出现这些词，也当论文处理。 */
const PAPER_TITLE_MARKERS = ["学报", "期刊", "论文", "研究综述", "文献综述"];

/**
 * 这条结果是不是「论文」。
 *
 * 只用来决定打不打折（1.0 还是 0.7），不用来过滤 ——
 * 把普通网页直接丢掉是不对的：一篇 CSDN 笔记如果标题跟你的主张几乎一字不差，
 * 那它确实是「有人做过」的证据，只是没那么硬。
 *
 * 参数只要「站点名 + 标题」两样，不要求完整的 WebHit ——
 * 因为 lib/overlap.ts 里拿到的是抹平后的 UnifiedHit（站点名在 venue 字段上），
 * 那边把两样挑出来传进来就行，不用为了一个判断函数再拼一个假 WebHit。
 */
export function looksLikePaper(hit: { site: string; title: string }): boolean {
  const site = hit.site.toLowerCase();
  if (ACADEMIC_SITES.some((name) => site.includes(name))) return true;

  const title = hit.title;
  return PAPER_TITLE_MARKERS.some((marker) => title.includes(marker));
}

/* ---------------------------------------------------------------
   7. 解析响应
   --------------------------------------------------------------- */

function pickText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 把一条原始结果转成 WebHit。
 *
 * 缺 url 或标题的直接丢掉 —— 没有 url 就没法给人点开看，
 * 没有标题就没法比相似度，留着只会占位。
 *
 * 参数类型里带 `null`：实测这种接口的数组里真会出现 null 元素，
 * 类型上写严了（只写对象）看着干净，但运行时照样会崩。
 * 外部数据一律当"可能是任何东西"处理，多判一次比崩一次强。
 *
 * 摘要优先用 snippet，其次 summary 截断，最后 content。
 * 实测 content 永远是空串，但留着兜底不影响。
 */
function parseResult(
  raw: NonNullable<SearchResponse["results"]>[number] | null | undefined,
): WebHit | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;

  const url = pickText(raw.url);
  const title = pickText(raw.title);
  if (url === "" || title === "") return null;

  const snippet = pickText(raw.snippet) || pickText(raw.summary).slice(0, 200) || pickText(raw.content);

  return {
    key: normalizeUrl(url),
    title,
    snippet,
    url,
    site: pickText(raw.site_name) || "（未知站点）",
    authority: typeof raw.authority === "number" ? raw.authority : 0,
    date: pickText(raw.date),
  };
}

/* ---------------------------------------------------------------
   8. 错误分类
   --------------------------------------------------------------- */

/**
 * 把 HTTP 状态码翻成人话。
 *
 * 跟 lib/deepseek.ts 的 describeHttpError 分开写而不是复用：
 * 那边是聊天接口的错误语境（模型名写错、输出被截断），
 * 这边是搜索接口的（query 为空）。文案完全不同，硬复用会写出
 * "模型名写错了"这种在这条路径上根本不成立的提示。
 */
function describeHttpError(status: number, detail: string): string {
  const tail = detail ? `（DeepSeek 原话：${detail}）` : "";

  if (status === 401) {
    return `联网搜索说 key 不对（401）。它跟聊天接口用同一个 DEEPSEEK_API_KEY，去 .env.local 检查一下${tail}`;
  }
  if (status === 402) {
    return `联网搜索余额不足（402）。搜索按 5 元/千次单独计费，去 platform.deepseek.com 充值${tail}`;
  }
  if (status === 429) {
    return `联网搜索说查太快了（429），这次跳过。等几秒再点一次${tail}`;
  }
  if (status === 400) {
    return `联网搜索不接受这个请求（400），通常是查询词为空或者太长${tail}`;
  }
  if (status >= 500) {
    return `联网搜索服务端出错（${status}），这次跳过${tail}`;
  }
  return `联网搜索失败（${status}）${tail}`;
}

/* ---------------------------------------------------------------
   9. 主函数
   --------------------------------------------------------------- */

/**
 * 查一次中文文献。
 *
 * 传进来的 query 直接用第 11 步模型产出的 `intent.zhQuery` ——
 * 那个字段当初的设计理由是"给人看的，让用户能检查翻译对不对"，
 * 现在正好拿它去查中文库。模型挑的核心中文词，比拿主张原文整句去搜准得多。
 *
 * 三种结局：
 *   - 没配 key        → { ok: false, skipped: true }   调用方静默跳过
 *   - 配了但查失败    → { ok: false, skipped: false }  调用方记一句警告
 *   - 查成功（含 0 条）→ { ok: true, hits: [] }         正常结论
 */
export async function searchChinese(
  query: string,
  options: WebSearchOptions = {},
): Promise<WebSearchOutcome> {
  const trimmed = query.trim();
  if (trimmed === "") {
    return { ok: false, error: "搜索词是空的，没法查", skipped: false };
  }

  const apiKey = (options.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "").trim();

  /*
     没配 key 不是错误，是"这个加餐今天没有"。
     所以 skipped 为 true，调用方据此静默跳过 —— 不写警告、不拉低可信度。
  */
  if (apiKey === "") {
    return {
      ok: false,
      error: "没配 DEEPSEEK_API_KEY，联网搜索这一步跳过",
      skipped: true,
    };
  }

  const count = Math.max(1, Math.min(20, options.count ?? DEFAULT_COUNT));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;

  await respectRateLimit();

  const payload = { query: trimmed, count };

  let res: Response;
  try {
    res = await doFetch(SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      return {
        ok: false,
        error: `联网搜索超过 ${Math.round(timeoutMs / 1000)} 秒没回话，这次跳过`,
        skipped: false,
      };
    }
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: `连不上联网搜索接口：${detail}。这次跳过`,
      skipped: false,
    };
  }

  if (!res.ok) {
    /** 先读文本再尝试解析 —— 报错时响应体可能不是 JSON。 */
    let detail = "";
    try {
      const raw = await res.text();
      try {
        const parsed = JSON.parse(raw) as SearchResponse;
        detail = parsed.error?.message ?? raw.slice(0, 200);
      } catch {
        detail = raw.slice(0, 200);
      }
    } catch {
      /** 连响应体都读不出来，就只报状态码。 */
    }

    return { ok: false, error: describeHttpError(res.status, detail), skipped: false };
  }

  let data: SearchResponse;
  try {
    data = (await res.json()) as SearchResponse;
  } catch {
    return {
      ok: false,
      error: "联网搜索返回的不是 JSON，可能被网络中间截断了，这次跳过",
      skipped: false,
    };
  }

  const rawResults = data.results ?? [];
  const parsed: WebHit[] = [];
  for (const item of rawResults) {
    const hit = parseResult(item);
    if (hit !== null) parsed.push(hit);
  }

  const hits = dedupeWebHits(parsed);

  /*
     注意这里即使 hits 是空数组也返回 ok: true。
     "查了，一条都没有"和"没查成"是两件事 —— 前者是结论，后者是故障。
     这条原则跟 lib/search.ts 里那个 trustworthy 判定是同一个道理。
  */
  const warnings: string[] = [];
  if (hits.length === 0) {
    warnings.push(`联网搜索没有查到「${trimmed}」相关的中文文献`);
  }

  return { ok: true, hits, rawCount: rawResults.length, warnings };
}

/* ---------------------------------------------------------------
   10. 花多少钱
   --------------------------------------------------------------- */

/** 把查询次数换算成人民币。搜索按次计费，跟返回多少条无关。 */
export function estimateSearchCost(calls: number): number {
  return Math.round(calls * PRICE_PER_CALL * 10_000) / 10_000;
}

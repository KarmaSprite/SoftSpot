/**
 * 调 DeepSeek 的唯一出口。
 *
 * 为什么单独一个文件，而不是在 route.ts 里直接 fetch：
 *
 * 1. 第 7、8 步写抽取和质询的时候，模型调用是"当参数传进去"的
 *    （lib/extract.ts 里的 ModelCaller）。当时传的是假模型，所以没 key 也能测。
 *    现在只要在这里做一个符合 ModelCaller 签名的实现塞进去，
 *    那两层代码一个字都不用改 —— 这就是当初把调用做成参数的价值。
 *
 * 2. 错误处理是这个文件里最长的部分，比正常流程还长。
 *    把它和业务逻辑混在一起，route.ts 会变成一坨看不懂的 if/else。
 *
 * 3. 计费。每次调用花了多少 token 要能统计出来，
 *    否则用户点十下按钮，不知道花了多少钱。
 */

import type { ModelCaller } from "./extract.ts";

/* ---------------------------------------------------------------
   1. 常量
   --------------------------------------------------------------- */

export const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";

/**
 * 模型名。
 *
 * 注意：DeepSeek 现在的模型列表是 deepseek-flash 和 deepseek-v4-pro，
 * "deepseek-chat" 是官方的别名，会路由到 deepseek-flash。
 * 用别名而不是写死 deepseek-flash，是因为官方以后调整底层模型时别名不变。
 * （实测返回体里的 model 字段确实是 "deepseek-flash"。）
 */
export const DEFAULT_MODEL = "deepseek-chat";

/**
 * 超时 90 秒。
 *
 * 为什么这么长：一次质询要生成 1-2 个问题带 3 条及格线，
 * 输出长度上千 token，慢的时候要二三十秒。
 * 设太短会把"模型还在想"误判成"卡死了"。
 * 但也不能不设 —— 没有超时的话，网络半断不断时浏览器会一直转圈。
 */
export const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * 失败重试次数。
 *
 * 只对"可能自己好起来"的错误重试（限速 429、服务端 5xx、网络抖动）。
 * key 错了、余额不足、模型名不对这些重试一百次也是一样的结果，
 * 重试只会让用户多等一倍时间，所以直接报错。
 */
const DEFAULT_MAX_RETRIES = 1;

/** 重试前等一会儿，给限速留出恢复时间。 */
const RETRY_DELAY_MS = 1_200;

/**
 * 单次输出的 token 上限。
 *
 * 4096 是够用的：20 条主张的抽取结果大约 1500 token，
 * 一条主张的 2 个问题带及格线大约 400 token。
 * 真撞到这个上限会走下面 finish_reason === "length" 那条分支，
 * 报一句人话，而不是让用户看到一个"JSON 解析失败"的怪错误。
 */
const MAX_TOKENS = 4096;

/**
 * 温度 0.2 而不是 0。
 *
 * 0 会让模型每次都选同一个词，抽取结果最稳定，但遇到边界情况会死板地
 * 把同一句话反复判成同一类。0.2 保留一点点随机性，同时几乎不影响一致性。
 * 这是个诊断工具，不需要创意，稳定比多样重要。
 */
const TEMPERATURE = 0.2;

/* ---------------------------------------------------------------
   2. 类型
   --------------------------------------------------------------- */

/** 累计用量。给 route.ts 拼进响应，让用户知道这次花了多少。 */
export type Usage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
};

export type ModelClientOptions = {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

export type ModelClient = {
  /** 签名和 lib/extract.ts 里的 ModelCaller 完全一致，可以直接传进去。 */
  call: ModelCaller;
  /** 到目前为止累计用了多少 token。返回的是快照，不是引用。 */
  getUsage: () => Usage;
};

/** DeepSeek 的响应体里我们关心的那几个字段。 */
type ChatResponse = {
  choices?: {
    message?: { content?: string };
    finish_reason?: string;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; type?: string };
};

/* ---------------------------------------------------------------
   3. 错误分类
   --------------------------------------------------------------- */

/**
 * 内部用的"可以重试"标记。
 *
 * 为什么不直接用 Error：
 * 重试循环要判断"这个错该不该再试一次"，靠比对错误文案太脆
 * （改一个字就失效）。用子类，判断就是一次 instanceof，改文案也不影响。
 */
class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableError";
  }
}

/**
 * 把 HTTP 状态码翻译成用户能照着做的话。
 *
 * 为什么值得花这么多行：DeepSeek 原始报错长这样 ——
 *   {"error":{"message":"Authentication Fails, Your api key: ****test is invalid"}}
 * 直接把这句话甩给用户，他不知道该改哪儿。
 * 401 就去查 key，402 就去充值，429 就等一会儿，这三种情况动作完全不同。
 */
function describeHttpError(status: number, detail: string): { message: string; retryable: boolean } {
  const tail = detail ? `（DeepSeek 原话：${detail}）` : "";

  if (status === 401) {
    return {
      message: `DeepSeek 说 key 不对（401）。检查 .env.local 里的 DEEPSEEK_API_KEY，或者去 platform.deepseek.com 重新生成一个${tail}`,
      retryable: false,
    };
  }
  if (status === 402) {
    return {
      message: `DeepSeek 账户余额不足（402）。去 platform.deepseek.com 充值后再试${tail}`,
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      message: `DeepSeek 说请求太频繁（429），已经自动重试过一次还是不行。等几秒再点一次${tail}`,
      retryable: true,
    };
  }
  if (status === 400) {
    return {
      message: `DeepSeek 说这个请求它不接受（400），通常是模型名写错了或者参数不对${tail}`,
      retryable: false,
    };
  }
  if (status >= 500) {
    return {
      message: `DeepSeek 服务端出错了（${status}）。这不是你的问题，等一会儿再试${tail}`,
      retryable: true,
    };
  }
  return {
    message: `调用 DeepSeek 失败（${status}）${tail}`,
    retryable: false,
  };
}

/* ---------------------------------------------------------------
   4. 单次请求
   --------------------------------------------------------------- */

type RequestConfig = {
  apiKey: string;
  model: string;
  timeoutMs: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 发一次请求，成功就返回模型输出的文本。
 *
 * 注意这里返回的是**原始文本**，不做任何 JSON 解析。
 * 解析和校验是 lib/parse.ts 和 zod 的活。
 * 分开的好处：模型返回格式不对时，报错能准确指出"是解析那一步坏了"，
 * 而不是笼统的"调用失败"。
 */
async function requestOnce(
  system: string,
  user: string,
  config: RequestConfig,
): Promise<{ text: string; usage: ChatResponse["usage"] }> {
  const payload = {
    model: config.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    /**
     * 告诉 DeepSeek "只准返回 JSON"。
     *
     * 实测有效：不开这个参数时模型有时会先说一句"好的，以下是结果："，
     * 开了之后第一个字符就是 {。
     * 但**不能依赖它** —— lib/parse.ts 里的兜底逻辑照样要留着，
     * 因为这个参数只保证"是合法 JSON"，不保证"符合我们的 schema"。
     */
    response_format: { type: "json_object" },
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    stream: false,
  };

  let res: Response;
  try {
    res = await fetch(DEEPSEEK_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
      /**
       * AbortSignal.timeout 比自己写 setTimeout + controller.abort 短得多，
       * 而且不会忘清理定时器（忘了清理会让 Node 进程多挂 90 秒才退出）。
       */
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (e) {
    /**
     * 走到这里只有两种可能：超时，或者根本连不上。
     * 两种都值得重试一次 —— 网络抖动是暂时的。
     */
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new RetryableError(
        `等了 ${Math.round(config.timeoutMs / 1000)} 秒，DeepSeek 还没返回。可能是网络慢，也可能这次请求卡住了，再点一次试试。`,
      );
    }
    const detail = e instanceof Error ? e.message : String(e);
    throw new RetryableError(
      `连不上 api.deepseek.com：${detail}。检查一下网络，如果用了代理，确认代理开着。`,
    );
  }

  if (!res.ok) {
    /** 先把响应体读成文本再尝试解析 —— 报错时响应体可能不是 JSON。 */
    let detail = "";
    try {
      const raw = await res.text();
      try {
        const parsed = JSON.parse(raw) as ChatResponse;
        detail = parsed.error?.message ?? raw.slice(0, 200);
      } catch {
        detail = raw.slice(0, 200);
      }
    } catch {
      /** 连响应体都读不出来，就只报状态码。 */
    }

    const { message, retryable } = describeHttpError(res.status, detail);
    if (retryable) throw new RetryableError(message);
    throw new Error(message);
  }

  let data: ChatResponse;
  try {
    data = (await res.json()) as ChatResponse;
  } catch {
    throw new RetryableError("DeepSeek 返回的不是 JSON，可能是网络中间被截断了，再点一次试试。");
  }

  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new RetryableError("DeepSeek 返回了空内容，再点一次试试。");
  }

  /**
   * finish_reason === "length" 表示输出被 max_tokens 截断了。
   *
   * 这条检查很重要：截断之后拿到的是一段"不完整的 JSON"，
   * 如果不管它，错误会跑到解析那一层，报成
   * "JSON 里第 1234 个字符附近有语法错误" —— 用户根本看不出是输出超长。
   * 在这里拦住，就能直接说"内容太长被截断了"。
   */
  if (data.choices?.[0]?.finish_reason === "length") {
    throw new Error(
      `模型输出到 ${MAX_TOKENS} token 上限被截断了，结果不完整。先把提纲删短一点（去掉文献综述和参考文献），再试一次。`,
    );
  }

  return { text: content, usage: data.usage };
}

/* ---------------------------------------------------------------
   5. 对外的客户端
   --------------------------------------------------------------- */

/**
 * 造一个模型客户端。
 *
 * 用法：
 *   const client = createModelClient({ apiKey: process.env.DEEPSEEK_API_KEY });
 *   const result = await extractClaims(outline, client.call);
 *   const used = client.getUsage();
 *
 * 为什么是工厂函数而不是导出一个全局的 call：
 * 全局单例会把"这次的用量"和"上次的用量"混在一起，
 * 用户点第二次时看到的 token 数是累计值，没法知道这一次花了多少。
 * 每次请求造一个新的，用量自然就隔离了。
 */
export function createModelClient(options: ModelClientOptions): ModelClient {
  const apiKey = options.apiKey.trim();
  const model = options.model ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);

  const config: RequestConfig = { apiKey, model, timeoutMs };

  const usage: Usage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    calls: 0,
  };

  const call: ModelCaller = async (system, user) => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        /** 重试之间等一下。第二次等得更久一点，因为 429 需要时间恢复。 */
        await sleep(RETRY_DELAY_MS * attempt);
      }

      try {
        const { text, usage: reported } = await requestOnce(system, user, config);

        usage.calls += 1;
        usage.promptTokens += reported?.prompt_tokens ?? 0;
        usage.completionTokens += reported?.completion_tokens ?? 0;
        usage.totalTokens += reported?.total_tokens ?? 0;

        return text;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));

        /**
         * 不可重试的错误立刻抛出去。
         * 注意：这里抛的是原始 Error，不是 RetryableError，
         * 调用方（lib/extract.ts）会把它包成"调用模型失败：xxx"。
         */
        if (!(e instanceof RetryableError)) throw lastError;
      }
    }

    throw lastError ?? new Error("调用模型失败，但没有拿到具体原因");
  };

  return {
    call,
    /**
     * 返回快照而不是 usage 本身。
     * 直接把对象交出去，调用方一改就会污染这里记的数，
     * 而且是那种"当时看着对、过一会儿才发现不对"的 bug。
     */
    getUsage: () => ({ ...usage }),
  };
}

/* ---------------------------------------------------------------
   6. 花多少钱
   --------------------------------------------------------------- */

/**
 * DeepSeek 的计价（元 / 百万 token）。
 *
 * 注意：这两个数会变，官方调价这里要跟着改。
 * 现在的值取自 2026 年 10 月的公开价目表。
 * 界面上只显示"约"，因为这个估算不含缓存命中折扣，会略高于实际账单。
 */
export const PRICE_INPUT_PER_MILLION = 1;
export const PRICE_OUTPUT_PER_MILLION = 4;

/** 把 token 用量换算成人民币，保留 4 位小数（一次分析不到 1 分钱，位少了看不出来）。 */
export function estimateCost(usage: Usage): number {
  const input = (usage.promptTokens / 1_000_000) * PRICE_INPUT_PER_MILLION;
  const output = (usage.completionTokens / 1_000_000) * PRICE_OUTPUT_PER_MILLION;
  return Math.round((input + output) * 10_000) / 10_000;
}

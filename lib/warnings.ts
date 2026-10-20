/**
 * 把重复的警告合成一条。
 *
 * ## 为什么需要这个
 *
 * 一条主张查两个库，一份 8 条主张的提纲最多能产出 16 条警告。
 * 实测 arXiv 抽风的时候，8 条主张全部超时 —— 报告顶上就挂了 8 条
 * 长得几乎一样的话：
 *
 *   「现有研究多用问卷自报…」查 arXiv 时没成功（arXiv 超过 15 秒没回话），这条主张的分数只算了另一个库。
 *   「学生课前在线学习…」查 arXiv 时没成功（arXiv 超过 15 秒没回话），这条主张的分数只算了另一个库。
 *   …（重复 6 遍）
 *
 * 这有两个坏处：
 *   1. 用户读不出「到底是 8 个不同的问题，还是同一件事发生了 8 次」。
 *      他会以为报告到处是毛病，而真实情况是一个源挂了。
 *   2. 真正只发生一次的问题（比如「你粘的第 3 行太短」）被淹在中间，没人看见。
 *
 * 所以：**同一个源、同一个原因、发生在 2 条以上主张上，合成一条**，
 * 并明确说出「影响了几条」。只发生一次的保持原样 —— 那才需要具体到哪一条。
 *
 * ## 为什么按源 + 原因分组，而不是按源分组
 *
 * arXiv 可能对 c1 超时、对 c2 返回 429，这是两件事，
 * 合成一条会把「查太快」这个可修复的信息抹掉。
 */

/** 一条警告里能认出来的「哪个源、什么原因」。 */
type SourceFailure = {
  source: string;
  reason: string;
};

/**
 * 从一句警告里认出源和原因。
 *
 * 只认我们自己写的那几种句式，认不出来就返回 null ——
 * 认不出来说明它不是源故障（可能是「你粘的第 3 行太短」这种），
 * 那种必须原样保留。
 */
function parseSourceFailure(warning: string): SourceFailure | null {
  /*
    原因本身可能带括号 —— arXiv 的报错就是
    「arXiv 说我们查太快了（429），这次跳过」，外面再套一层就成了嵌套括号。
    所以不能用非贪婪的 `（(.+?)）`，那样会在内层那个 `）` 处截断，
    合出来的句子会缺一个右括号。
    改成：认死我们自己的尾巴，让 `.+` 贪婪地吃到最后一个 `）`。
  */
  const failed = warning.match(
    /查\s*(arXiv|Crossref|中文网页)\s*时没成功（(.+)），这条主张的分数只算了另一个库。$/,
  );
  if (failed) {
    return { source: failed[1], reason: failed[2] };
  }

  const webFailed = warning.match(
    /补查中文文献时没成功（(.+)）。英文库的分数照常算，只是少了一个参考。$/,
  );
  if (webFailed) {
    return { source: "中文网页", reason: webFailed[1] };
  }

  return null;
}

/** 合成之后那句话，按源换说法。 */
function buildGrouped(failure: SourceFailure, count: number): string {
  if (failure.source === "中文网页") {
    return `中文网页补查有 ${count} 条主张没成功（${failure.reason}）。英文库的分数照常算，只是少了中文这一路参考。`;
  }
  return `${failure.source} 这次有 ${count} 条主张没查成（${failure.reason}），这些主张的分数只算了另一个库。`;
}

/**
 * 主函数：把一批警告里的重复源故障合起来。
 *
 * 输出的顺序按「第一次出现」排，不重新排序 ——
 * 警告的顺序本身在传递信息：先出现的往往是先发生的。
 */
export function collapseWarnings(warnings: string[]): string[] {
  const groups = new Map<string, { failure: SourceFailure; count: number; firstAt: number }>();
  const parsed: Array<SourceFailure | null> = [];

  for (const [index, warning] of warnings.entries()) {
    const failure = parseSourceFailure(warning);
    parsed.push(failure);
    if (!failure) continue;

    const key = `${failure.source}\u0000${failure.reason}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { failure, count: 1, firstAt: index });
    }
  }

  const out: string[] = [];

  for (const [index, warning] of warnings.entries()) {
    const failure = parsed[index];

    // 认不出来的警告原样保留
    if (!failure) {
      out.push(warning);
      continue;
    }

    const group = groups.get(`${failure.source}\u0000${failure.reason}`);
    if (!group) {
      out.push(warning);
      continue;
    }

    // 只发生一次：保留原句，它具体到哪一条主张，更有用
    if (group.count === 1) {
      out.push(warning);
      continue;
    }

    // 多次：只在第一次出现的位置放合成句，后面的跳过
    if (group.firstAt === index) {
      out.push(buildGrouped(group.failure, group.count));
    }
  }

  return out;
}

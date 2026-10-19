/**
 * 二维打分的自检。
 *
 * 这里所有期望值都是**手算出来的**，不是跑一遍把结果抄回来 ——
 * 抄回来的测试只能证明"代码没变"，证明不了"算得对"。
 *
 * 手算方法：
 *   覆盖率 = 共有词数 / 主张词数
 *   密度   = 共有词数 / min(文献词数, 40)
 *   相似度 = 0.65 × 覆盖率 + 0.35 × 密度
 *
 * 跑法：npm run check:similarity
 */

import {
  defensibilityFromRisk,
  pairScore,
  scoreCorpus,
  stemEnglish,
  tokenize,
  tokenizeChinese,
  tokenizeEnglish,
} from "../lib/similarity.ts";
import {
  claimTokens,
  dedupeHits,
  fromArxiv,
  fromCrossref,
  hitTokens,
  normalizeTitle,
  scoreOverlap,
} from "../lib/overlap.ts";

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

function near(actual, expected, tolerance = 0.001) {
  return Math.abs(actual - expected) <= tolerance;
}

/** 直接造词袋，跳过分词，这样期望值能精确手算。 */
function bag(en, zh = []) {
  return { en, zh };
}

console.log("\n=== 二维打分自检 ===\n");

// ---------- 1. 英文分词 ----------

console.log("[1] 英文分词：去停用词、去标点、词尾归一");
{
  const tokens = tokenizeEnglish("Video, Reflection and Transformation: Action Research");
  console.log(`  ${tokens.join(" / ")}`);

  check("and 被当停用词去掉", !tokens.includes("and"), tokens.join(" / "));
  check("research 被当停用词去掉", !tokens.includes("research"), tokens.join(" / "));
  check("video 留下", tokens.includes("video"));
  check("transformation 留下", tokens.includes("transformation"));
  check("标点没留下", tokens.every((t) => /^[a-z0-9]+$/.test(t)), tokens.join(" / "));
  check("没有重复词", new Set(tokens).size === tokens.length, tokens.join(" / "));

  check("learning 归到 learn", stemEnglish("learning") === "learn", stemEnglish("learning"));
  check("studies 归到 study", stemEnglish("studies") === "study", stemEnglish("studies"));
  check("boxes 归到 box", stemEnglish("boxes") === "box", stemEnglish("boxes"));
  check("class 不动（双 s 不是复数）", stemEnglish("class") === "class", stemEnglish("class"));
  check("vocational 不动（不是词尾 s）", stemEnglish("vocational") === "vocational", stemEnglish("vocational"));
}

// ---------- 2. 中文双字切 ----------

console.log("\n[2] 中文按双字切：不用词典也能切出可比的词");
{
  const tokens = tokenizeChinese("高职学生");
  console.log(`  「高职学生」→ ${tokens.join(" / ")}`);

  check("切出 3 个双字词", tokens.length === 3, tokens.join(" / "));
  check("有「高职」", tokens.includes("高职"));
  check("有「学生」", tokens.includes("学生"));

  const withStop = tokenizeChinese("我的学生");
  console.log(`  「我的学生」→ ${withStop.join(" / ")}`);
  check("含停用字的双字词被丢掉", withStop.length === 1 && withStop[0] === "学生", withStop.join(" / "));

  const single = tokenizeChinese("好");
  check("单字切不出双字词", single.length === 0, single.join(" / "));

  const mixed = tokenize("高职 vocational education");
  check("中英混排两边都切到", mixed.en.length === 2 && mixed.zh.length === 1, `en=${mixed.en.join(",")} zh=${mixed.zh.join(",")}`);
}

// ---------- 3. 单篇相似度：手算核对 ----------

console.log("\n[3] 单篇相似度：手算核对公式");
{
  // 完全一样：覆盖率 3/3=1，密度 3/3=1 → 0.65 + 0.35 = 1.0
  const same = pairScore(bag(["a", "b", "c"]), bag(["a", "b", "c"]));
  check("完全一样 = 1.0", near(same.score, 1.0), String(same.score));

  // 毫无重合
  const none = pairScore(bag(["a", "b"]), bag(["x", "y"]));
  check("毫无重合 = 0", near(none.score, 0), String(none.score));

  // 主张 4 词，文献 2 词，重合 2 词：覆盖率 2/4=0.5，密度 2/2=1
  // → 0.65×0.5 + 0.35×1 = 0.325 + 0.35 = 0.675
  const half = pairScore(bag(["a", "b", "c", "d"]), bag(["a", "b"]));
  check("重合一半 = 0.675", near(half.score, 0.675), String(half.score));
  check("覆盖率 0.5", near(half.detail.coverage, 0.5), String(half.detail.coverage));
  check("密度 1", near(half.detail.density, 1), String(half.detail.density));
  check("共有的词是 a 和 b", half.detail.matched.join(",") === "a,b", half.detail.matched.join(","));

  // 密度窗口：文献 100 词、命中 4 词，覆盖率 4/4=1，密度 4/min(100,40)=0.1
  // → 0.65×1 + 0.35×0.1 = 0.65 + 0.035 = 0.685
  const longDoc = pairScore(
    bag(["a", "b", "c", "d"]),
    bag(["a", "b", "c", "d", ...Array.from({ length: 96 }, (_, i) => `w${i}`)]),
  );
  check("长文献不会因为长就变像 = 0.685", near(longDoc.score, 0.685), String(longDoc.score));
  check("密度被 40 词窗口压住 = 0.1", near(longDoc.detail.density, 0.1), String(longDoc.detail.density));

  // 中英各算一次取高的：英文没重合，中文全重合
  const zhBetter = pairScore(bag(["a"], ["高职", "学生"]), bag([], ["高职", "学生"]));
  check("英文 0 分时用中文分顶上 = 1.0", near(zhBetter.score, 1.0), String(zhBetter.score));

  // 两边都空
  const empty = pairScore(bag([]), bag([]));
  check("两边都空 = 0", near(empty.score, 0), String(empty.score));
}

// ---------- 4. 对一批文献打分 + 广度加分 ----------

console.log("\n[4] 对一批文献：取最像的，撞得多再加分");
{
  const claim = bag(["a", "b", "c"]);

  // 主张 3 词，文献 2 词，重合 2 词：覆盖率 2/3≈0.667，密度 2/2=1
  // → 0.65×0.667 + 0.35×1 = 0.433 + 0.35 = 0.783 → ×100 = 78
  //
  // 三篇都撞上：strongCount 3 → 广度加分 min((3-1)×4, 12) = 8 → 78 + 8 = 86
  const three = scoreCorpus(claim, [bag(["a", "b"]), bag(["a", "b"]), bag(["a", "b"])]);
  check("三篇都撞上 = 86", three.score === 86, String(three.score));
  check("strongCount = 3", three.strongCount === 3, String(three.strongCount));

  // 一篇：strongCount 1 → 加分 min(0×4,12)=0 → 78
  const one = scoreCorpus(claim, [bag(["a", "b"])]);
  check("只有一篇撞上 = 78", one.score === 78, String(one.score));

  // 六篇：加分 min(5×4,12)=12 → 78 + 12 = 90
  const six = scoreCorpus(claim, Array.from({ length: 6 }, () => bag(["a", "b"])));
  check("撞得再多也只加 12 分 = 90", six.score === 90, String(six.score));

  // 一篇都不相关
  const unrelated = scoreCorpus(claim, [bag(["x", "y"]), bag(["p", "q"])]);
  check("全不相关 = 0", unrelated.score === 0, String(unrelated.score));
  check("没有最像的", unrelated.bestIndex === -1);

  // 空文献列表
  const noDocs = scoreCorpus(claim, []);
  check("一篇文献都没有 = 0 且不崩", noDocs.score === 0 && noDocs.best === null);
}

// ---------- 5. 第二维：答得上来吗 ----------

console.log("\n[5] 第二维：最危险的那个问题决定这条主张稳不稳");
{
  check("最危险 92 分 → 稳度 8", defensibilityFromRisk([92]) === 8, String(defensibilityFromRisk([92])));
  check("只看最高的，不被低的拉高", defensibilityFromRisk([92, 20, 15]) === 8, String(defensibilityFromRisk([92, 20, 15])));
  check("最危险 0 分 → 稳度 100", defensibilityFromRisk([0]) === 100, String(defensibilityFromRisk([0])));
  check("没被质询过 → 50（不知道，不是满分）", defensibilityFromRisk([]) === 50, String(defensibilityFromRisk([])));
  check("危险分超 100 也不会变负", defensibilityFromRisk([130]) === 0, String(defensibilityFromRisk([130])));
}

// ---------- 6. 去重 ----------

console.log("\n[6] 去重：同一篇论文两个库都有，只算一次");
{
  const arxiv = fromArxiv({
    id: "2608.06932",
    title: "Video Reflection and Transformation in Vocational Education",
    summary: "",
    year: "2026",
    authors: ["A"],
    url: "https://arxiv.org/abs/2608.06932",
  });
  const crossref = fromCrossref({
    doi: "10.1080/13636820.2023.1234567",
    title: "Video, Reflection and Transformation: In Vocational Education",
    year: "2023",
    authors: ["A"],
    journal: "Journal of Vocational Education",
    url: "https://doi.org/10.1080/13636820.2023.1234567",
  });

  const deduped = dedupeHits([arxiv, crossref]);
  check("标题归一化后认成同一篇，只剩 1 条", deduped.length === 1, String(deduped.length));
  check("保留的是先来的那条（arXiv）", deduped[0].source === "arxiv", deduped[0].source);

  check(
    "归一化标题去掉标点和大小写",
    normalizeTitle("Video, Reflection!") === "videoreflection",
    normalizeTitle("Video, Reflection!"),
  );

  const short1 = { ...arxiv, key: "k1", title: "Editorial" };
  const short2 = { ...arxiv, key: "k2", title: "Editorial" };
  check("短标题不参与标题去重（避免误伤）", dedupeHits([short1, short2]).length === 2);
}

// ---------- 7. 词袋怎么取 ----------

console.log("\n[7] 词袋：文献只取标题，主张取翻译出来的术语");
{
  const hit = {
    source: "arxiv",
    key: "arxiv:1",
    title: "Shot Language Training for Digital Media Students",
    year: "2024",
    authors: [],
    venue: "arXiv",
    url: "",
  };
  const tokens = hitTokens(hit);
  console.log(`  文献词：${tokens.en.join(" / ")}`);
  check("标题里的词都切到了", tokens.en.includes("shot") && tokens.en.includes("language"), tokens.en.join(","));
  check("arXiv 这个词也进了词袋", tokens.en.includes("arxiv"), tokens.en.join(","));

  const claim = {
    id: "c1",
    text: "用镜头语言训练提升高职学生的视频叙事能力",
    type: "method",
    location: "第 1 段",
    overlap: 50,
    defensibility: 50,
  };
  const intent = {
    claimId: "c1",
    phrase: "shot language",
    keywords: ["shot language", "video narrative", "vocational education"],
    zhQuery: "镜头语言 视频叙事 高职",
  };
  const claimBag = claimTokens(claim, intent);
  console.log(`  主张英文词：${claimBag.en.join(" / ")}`);
  console.log(`  主张中文词：${claimBag.zh.join(" / ")}`);
  check("英文词来自翻译", claimBag.en.includes("shot") && claimBag.en.includes("narrative"), claimBag.en.join(","));
  check("中文词来自原文", claimBag.zh.includes("镜头") && claimBag.zh.includes("高职"), claimBag.zh.join(","));
  check("没有重复", new Set(claimBag.en).size === claimBag.en.length);

  // 没有翻译结果时不能崩
  const noIntent = claimTokens(claim, null);
  check("没有检索意图时英文词为空", noIntent.en.length === 0, noIntent.en.join(","));
  check("没有检索意图时中文词仍有", noIntent.zh.length > 0, noIntent.zh.join(","));
}

// ---------- 8. 合成总分 ----------

console.log("\n[8] 合成总分：一个源都没答话时，分数必须说明不可信");
{
  const claim = {
    id: "c1",
    text: "用镜头语言训练提升高职学生的视频叙事能力",
    type: "method",
    location: "第 1 段",
    overlap: 50,
    defensibility: 50,
  };
  const intent = {
    claimId: "c1",
    phrase: "shot language",
    keywords: ["shot language", "video narrative", "vocational education"],
    zhQuery: "镜头语言 视频叙事 高职",
  };

  const dead = scoreOverlap({
    claim,
    intent,
    arxivHits: [],
    crossrefHits: [],
    sourcesAnswered: 0,
  });
  check("零源答话 → 0 分", dead.score === 0, String(dead.score));
  check("零源答话 → 明说分数不算数", dead.reason.includes("不算数"), dead.reason);

  const emptyButAnswered = scoreOverlap({
    claim,
    intent,
    arxivHits: [],
    crossrefHits: [],
    sourcesAnswered: 2,
  });
  check("查了但没查到 → 0 分", emptyButAnswered.score === 0, String(emptyButAnswered.score));
  check("查了但没查到 → 说清是查过没有", emptyButAnswered.reason.includes("一篇都没查到"), emptyButAnswered.reason);

  // 真撞上一篇
  const hit = fromCrossref({
    doi: "10.1080/13636820.2023.1234567",
    title: "Shot Language Training for Vocational Digital Media Students",
    year: "2023",
    authors: ["B"],
    journal: "Journal of Vocational Education",
    url: "https://doi.org/10.1080/13636820.2023.1234567",
  });
  const hitResult = scoreOverlap({
    claim,
    intent,
    arxivHits: [],
    crossrefHits: [
      {
        doi: "10.1080/13636820.2023.1234567",
        title: "Shot Language Training for Vocational Digital Media Students",
        year: "2023",
        authors: ["B"],
        journal: "Journal of Vocational Education",
        url: hit.url,
      },
    ],
    sourcesAnswered: 2,
  });
  console.log(`  撞上一篇 → ${hitResult.score} 分`);
  console.log(`  理由：${hitResult.reason}`);
  check("有分数", hitResult.score > 0, String(hitResult.score));
  check("有最像的那一篇", hitResult.bestHit !== null);
  check("理由里带论文标题", hitResult.reason.includes("Shot Language"), hitResult.reason);
  check("共有的词不是空的", hitResult.matched.length > 0, hitResult.matched.join(","));
}

// ---------- 9. 三个真实样本 ----------

console.log("\n[9] 三个真实样本：完全无关 / 同一领域 / 同一句话");
{
  const claim = {
    id: "c1",
    text: "用镜头语言训练提升高职学生的视频叙事能力",
    type: "method",
    location: "第 1 段",
    overlap: 50,
    defensibility: 50,
  };
  const intent = {
    claimId: "c1",
    phrase: "shot language",
    keywords: ["shot language", "video narrative", "vocational education"],
    zhQuery: "镜头语言 视频叙事 高职",
  };

  const samples = [
    {
      label: "完全无关（量子化学）",
      title: "Density Functional Theory Calculations of Transition Metal Catalysts",
    },
    {
      label: "同一领域（职教 + 视频）",
      title: "Video Reflection and Transformation: Action Research in Vocational Education",
    },
    {
      label: "同一句话",
      title: "Shot Language Training to Improve Video Narrative Ability of Vocational Students",
    },
  ];

  for (const sample of samples) {
    const result = scoreOverlap({
      claim,
      intent,
      arxivHits: [],
      crossrefHits: [
        {
          doi: `10.0000/${encodeURIComponent(sample.label)}`,
          title: sample.title,
          year: "2024",
          authors: [],
          journal: "",
          url: "",
        },
      ],
      sourcesAnswered: 2,
    });
    console.log(`  ${sample.label.padEnd(22)} → ${String(result.score).padStart(3)} 分   共有：${result.matched.slice(0, 5).join(",") || "无"}`);
  }

  const scores = samples.map((sample) =>
    scoreOverlap({
      claim,
      intent,
      arxivHits: [],
      crossrefHits: [
        { doi: `x/${sample.title.length}`, title: sample.title, year: "2024", authors: [], journal: "", url: "" },
      ],
      sourcesAnswered: 2,
    }).score,
  );

  check("无关的那篇最低", scores[0] < scores[1], scores.join(" < "));
  check("同一句话那篇最高", scores[2] > scores[1], scores.join(" < "));
  check("同一句话那篇过 60", scores[2] >= 60, String(scores[2]));
  check("无关那篇低于 25", scores[0] < 25, String(scores[0]));
}

// ---------- 汇总 ----------

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);

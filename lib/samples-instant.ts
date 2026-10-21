/**
 * 离线示例：三条完整的真模型响应，冻结在这里。
 *
 * 为什么要冻结而不是每次真跑：
 * 演示现场没有网络、或者余额不够、或者只想快速给人看几份不同的报告时，
 * 真跑一次要 30 秒加四分钱。冻结之后点一下就有，不联网不花钱。
 *
 * 为什么数据一字未改：
 * 报告顶上会写「这份报告是存好的示例结果，不是刚刚算的」，
 * 下面的耗时和花费照实显示 —— 那是当时真跑一次的记录。
 * 如果为了好看去改那些数字，这句话就成了假话。
 *
 * 为什么提纲原文也一起存：
 * 出结果后页面顶部要显示「你在诊断哪份提纲」。
 * 离线示例没有真的走一遍请求，这份原文就是唯一的凭据。
 *
 * 名字 / 分数 / 说明 / 提纲原文一律从 lib/samples.ts 取，
 * 冻结数据只贡献 payload —— 同一个东西在两处显示成两个分数，
 * 是最容易被当场抓到的那种错。
 *
 * 数据来源：2026-10-21 用 deepseek-chat 真跑，
 * 三条合计 0.1575 元、96.1 秒。
 */

import type { Claim, Question } from "./types.ts";

/**
 * 「把这份离线结果直接摆出来」这个动作，走的是浏览器事件。
 *
 * 跟 lib/samples.ts 里的 FILL_OUTLINE_EVENT 是同一个理由：
 * 测试面板挂在 app/layout.tsx 上，输入框和报告在 app/page.tsx 里，
 * 父组件想改子组件的 state 只能靠 context 或者全局状态，一个事件最轻。
 *
 * 为什么不复用 FILL_OUTLINE_EVENT：
 * 那个事件只填文字、故意不自动开跑（跑一次要花钱）。
 * 这个事件恰恰相反 —— 它的全部意义就是「别跑，把存好的结果拿出来」。
 * 两件事用两个事件名，比在一个事件里塞一个开关字段清楚。
 */
export const LOAD_INSTANT_EVENT = "pre-defense:load-instant";

/** 请页面直接把第 index 份离线结果摆出来。 */
export function requestInstantResult(index: number): void {
  window.dispatchEvent(new CustomEvent(LOAD_INSTANT_EVENT, { detail: index }));
}

/** 一份冻结下来的完整响应，字段跟 /api/analyze 一一对应。 */
export type InstantPayload = {
  claims: Claim[];
  questions: Question[];
  warnings: string[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    calls: number;
  };
  costYuan: number;
  model: string;
  scoresArePlaceholder: boolean;
  blindClaimIds: string[];
  manualRefCount: number;
  manualRefsEnabled: boolean;
  evidence: {
    claimId: string;
    score: number;
    reason: string;
    dimensions: { name: string; score: number; hits: string[] }[];
  }[];
  /**
   * 每条主张的检索明细。
   *
   * 为什么要存这一段：主张表点开要看「最像的那一篇」，
   * 那个标题来自检索结果，不是模型生成的。不存下来的话，
   * 离线示例的展开区就只能说「当时没存」，演示时少掉最有说服力的一块。
   *
   * 为什么字段跟 /api/analyze 一条不差地全写出来：
   * 这是从真实响应里冻结下来的字面量，少写一个字段 TypeScript 就报
   * "多了个属性"。少写等于让类型去描述一个并不存在的精简响应，
   * 下次真跑出来的数据就跟类型对不上了。
   */
  search: {
    claimId: string;
    /** 这次检索可不可信（一个库都没答话时为 false） */
    trustworthy: boolean;
    score: number;
    reason: string;
    totalHits: number;
    /** 每个库各自答话没有、查回几篇 */
    sources: {
      name: string;
      answered: boolean;
      hitCount: number;
      error: string;
    }[];
    bestHit: {
      /**
       * 去重用的唯一键（arXiv id / DOI / 归一化 url）。
       * 界面不显示它，但 /api/analyze 的响应里带着，
       * 冻结数据照原样存 —— 类型少写一个字段，
       * 下次真跑出来的响应就会报"多了个 key"，那是类型在说谎。
       */
      key: string;
      source: string;
      title: string;
      year: string;
      authors: string[];
      venue: string;
      url: string;
    } | null;
    matched: string[];
    /** 中文网页那一步怎么了：off / skipped / ok / failed */
    webStatus: string;
    webHitCount: number;
    manualHitCount: number;
  }[];
  elapsedMs: number;
};

/** 一条离线示例：按钮上显示的东西 + 点下去要摊出来的完整响应。 */
export type InstantSample = {
  /** 按钮上的名字，跟 lib/samples.ts 里同名那条一致 */
  name: string;
  /** 总体评分，跟报告顶部那个数是同一个公式算的 */
  quality: number;
  /** 一句话说明这条演示什么 */
  note: string;
  /** 当时贴进去的提纲原文 */
  outline: string;
  /** 冻结的响应 */
  payload: InstantPayload;
};

/**
 * 三条示例，按分数从高到低排。
 *
 * 为什么是这三条：第一条 76 分落在最高档（演示「写得好的开题长什么样」），
 * 第二条 67 分能跑出主场（演示「你的主场」那一块有东西可看），
 * 第三条 23 分七条主张全落在「最该改」那个角（演示报告最难看的样子）。
 * 三条放一起，正好是这套工具从高分到不及格的整条线。
 */
export const INSTANT_SAMPLES: InstantSample[] = [
  {
    name: "教育学·烹饪实训",
    quality: 76,
    note: "每一句都写了做多少、怎么做、谁来做、信度多少 —— 落在「新颖而且扎实」这一档",
    outline: "一、研究背景\n高校烹饪与营养教育专业的刀工实训长期靠教师凭经验判断学生练得够不够，实训室原料损耗也只有领用和结余两个数，中间哪个环节浪费了多少没人分类统计过。某高校烹饪与营养教育专业 2024 年秋季学期 4 个班 16 周台账显示，原料领用 1860 公斤、成品 1209 公斤，损耗率 35.0%，但这个数字把清洗、解冻、修整和刀工成形混在一起算，看不出刀工本身占多少。\n二、研究问题\n在高校烹饪与营养教育专业的刀工实训中，把 640 条台账按清洗、解冻、修整、刀工成形 4 个阶段分开称重之后，刀工成形这一段在总损耗里占多少？这个占比和 128 名学生 3 次刀工测评的成绩之间，相关系数是多少？\n三、研究内容\n1. 采集 4 个班 16 周台账 640 条，覆盖 8 类原料，每一条都按 4 个阶段分别称重记录，形成分阶段损耗台账。\n2. 依据《中式烹调师职业技能标准》自编损耗分类编码表，含 4 类 12 项，两名实训教师双盲独立编码 640 条记录，评分者一致性 Kappa 为 0.83。\n3. 前 8 周只记领用和结余两个数，后 8 周加记 4 个阶段的分项重量，2 个平行班全程只记总数作为参照，比对 320 条记录的阶段占比变化。\n4. 同步采集 128 名学生 3 次刀工测评成绩，测评用自编量表，含 5 个维度 20 个评分点，双人评分，评分者一致性 Kappa 为 0.81。\n四、预期成果\n形成一份覆盖 640 条台账记录、128 名学生的分阶段损耗统计报告，给出刀工成形段的损耗占比，以及与刀工测评成绩的相关系数。",
    payload: {
      "claims": [
        {
          "id": "c1",
          "text": "高校烹饪与营养教育专业的刀工实训长期靠教师凭经验判断学生练得够不够，实训室原料损耗也只有领用和结余两个数，中间哪个环节浪费了多少没人分类统计过",
          "type": "problem",
          "location": "研究背景 第 1 段",
          "overlap": 42,
          "defensibility": 61
        },
        {
          "id": "c2",
          "text": "这个数字把清洗、解冻、修整和刀工成形混在一起算，看不出刀工本身占多少",
          "type": "problem",
          "location": "研究背景 第 1 段",
          "overlap": 42,
          "defensibility": 52
        },
        {
          "id": "c3",
          "text": "把 640 条台账按清洗、解冻、修整、刀工成形 4 个阶段分开称重之后，刀工成形这一段在总损耗里占多少",
          "type": "method",
          "location": "研究问题 第 1 段",
          "overlap": 42,
          "defensibility": 58
        },
        {
          "id": "c4",
          "text": "每一条都按 4 个阶段分别称重记录，形成分阶段损耗台账",
          "type": "method",
          "location": "研究内容 第 1 条",
          "overlap": 46,
          "defensibility": 52
        },
        {
          "id": "c5",
          "text": "依据《中式烹调师职业技能标准》自编损耗分类编码表，含 4 类 12 项，两名实训教师双盲独立编码 640 条记录",
          "type": "method",
          "location": "研究内容 第 2 条",
          "overlap": 49,
          "defensibility": 84
        },
        {
          "id": "c6",
          "text": "前 8 周只记领用和结余两个数，后 8 周加记 4 个阶段的分项重量，2 个平行班全程只记总数作为参照，比对 320 条记录的阶段占比变化",
          "type": "method",
          "location": "研究内容 第 3 条",
          "overlap": 40,
          "defensibility": 66
        },
        {
          "id": "c7",
          "text": "同步采集 128 名学生 3 次刀工测评成绩，测评用自编量表，含 5 个维度 20 个评分点，双人评分",
          "type": "method",
          "location": "研究内容 第 4 条",
          "overlap": 56,
          "defensibility": 75
        },
        {
          "id": "c8",
          "text": "形成一份覆盖 640 条台账记录、128 名学生的分阶段损耗统计报告，给出刀工成形段的损耗占比，以及与刀工测评成绩的相关系数",
          "type": "expectation",
          "location": "预期成果 第 1 段",
          "overlap": 42,
          "defensibility": 82
        }
      ],
      "questions": [
        {
          "id": "q1",
          "claimId": "c1",
          "question": "你说「长期靠教师凭经验判断」和「没人分类统计过」，这是你调查了多所高校得出的，还是只凭这一所学校的印象？样本有多大？",
          "why": "这是整篇研究的立论前提——如果别的学校早就在用分阶段称重或评分量表，你的「空白」就不成立，研究问题里的「占比是多少」就变成重复劳动。老师问这句是在验证问题是否真实存在，答不上来等于承认选题依据是印象而非证据。",
          "checklist": [
            "能说出具体调查了几所学校、什么时间、用什么方式（访谈/问卷/查台账）确认「没人分类统计」",
            "能举出至少 1 个反例或边界情况（比如某校有类似做法但未公开），并说明你的研究与它的区别",
            "如果确实只调查了 1 所学校，能坦承这是个案研究，并把结论限定在「该校」而非「高校」层面"
          ],
          "risk": 95
        },
        {
          "id": "q2",
          "claimId": "c1",
          "question": "你背景里写的 35.0% 损耗率是把清洗、解冻、修整、刀工成形混在一起算的，那你怎么确定「刀工成形」这一段就是问题所在，而不是解冻或修整浪费更多？",
          "why": "这条主张暗含一个归因判断：浪费主要出在刀工环节、且教师凭经验判断不准。但 35.0% 是混合数，如果分阶段称重后发现刀工只占 5%、解冻占 20%，你整篇研究的靶心就打偏了。老师问这个是在检验你有没有在开题阶段就预设了结论。",
          "checklist": [
            "能说明为什么优先怀疑刀工成形段（比如已有预实验数据、教师访谈、或原料特性），而不是仅凭「刀工是实训核心」的直觉",
            "能承认如果分阶段数据显示刀工占比很低，研究问题需要调整，并说出调整方向",
            "能区分「刀工成形段损耗占比」和「刀工技能不足导致的损耗」是两个不同概念，不把前者直接等同于后者"
          ],
          "risk": 75
        },
        {
          "id": "q3",
          "claimId": "c2",
          "question": "你说 35% 这个数字把四个阶段混在一起、看不出刀工占多少——那你怎么确定刀工成形这一段在总损耗里占的比例大到值得单独拎出来研究？有没有先做过小样本的预称重，还是凭经验觉得它占比大？",
          "why": "这条主张是整个研究的立论起点：如果刀工成形段的损耗只占总损耗的百分之几，那把它单独拆出来统计、再和 128 名学生的测评成绩做相关，整篇论文的必要性就站不住了。老师问这句是在检验你有没有在开题前用数据确认过『刀工这一段确实是大头』，而不是先有结论再去找证据。答不上来会暴露研究问题是从直觉推出来的，不是从数据里长出来的。",
          "checklist": [
            "能报出一个预实验或试称重的具体数字：比如某几周、某几个班先按 4 阶段称过，刀工成形段占总损耗的百分比是多少",
            "能说清这个预称重是在哪个班、哪几周做的，样本量大概多少条记录",
            "如果还没做预称重，能当场承认这是开题后要补的第一步，并说明打算先称多少条来验证这个前提"
          ],
          "risk": 95
        },
        {
          "id": "q4",
          "claimId": "c2",
          "question": "清洗、解冻、修整、刀工成形这四段，同一条原料在流程上是前后串起来的，比如解冻流失的水分会不会被算进后面的修整损耗里？你称重时怎么保证四段之间不重复计算、也不漏算？",
          "why": "分阶段称重听起来清楚，但原料在四个环节之间是连续传递的，前一段的失水、沥水会改变后一段的起始重量。如果四段重量加不回去等于领用减结余，那『刀工成形占多少』这个占比本身就是错的，后面和成绩做相关也白做。老师问这个是在检验你的称重方案有没有做过物料平衡校验，答不上来说明 640 条台账的称重口径可能从根上就不闭合。",
          "checklist": [
            "能说明每一段称重的时间点和状态（比如解冻后沥水多久再称、修整前后是否同一容器去皮）",
            "能给出一个物料平衡的校验办法：四段损耗之和与领用减结余的差额控制在多少以内算合格",
            "能讲清解冻失水这类非刀工损耗在编码时归到哪一类，不会混进刀工成形段"
          ],
          "risk": 75
        },
        {
          "id": "q5",
          "claimId": "c3",
          "question": "你说把每条台账按清洗、解冻、修整、刀工成形4个阶段分开称重，那同一条记录里，比如一块萝卜从清洗到切成丝，中间经过几个阶段、每个阶段各掉多少，你是怎么在操作上切开的？称的是哪个时间点的重量？",
          "why": "这是整个分阶段损耗数据能不能成立的操作前提。如果作者答不上来每个阶段怎么界定起止、称重是在哪个环节做的，那640条记录的分项重量就是事后估的或者按比例摊的，不是真称出来的，后面所有占比和相关系数都建立在假数据上。老师问这个是在验证：这个数据到底存不存在。",
          "checklist": [
            "能说清每个阶段的起止动作（比如清洗阶段从原料入水到沥干，称的是入水前和沥干后的重量差）",
            "能说明称重由谁在什么时间点执行、用的是哪台秤、精度多少",
            "能承认哪些原料或哪些阶段在操作上无法干净切开，并说明怎么处理（合并、剔除还是标注）"
          ],
          "risk": 95
        },
        {
          "id": "q6",
          "claimId": "c3",
          "question": "后8周加记4个阶段分项重量，前8周只记领用和结余，那你怎么保证后8周的分阶段数据不是被『加记』这个动作本身改变的？比如学生或记录员知道在称刀工段，行为会不会不一样？",
          "why": "这是前后8周对比设计里的测量效应问题。如果作者没考虑加记分项本身会改变记录行为和操作行为，那后8周刀工段占比的变化就分不清是真实损耗结构还是观察者效应，320条对比记录的结论会被直接质疑。老师问这个是在看作者有没有意识到自己的干预改变了被测对象。",
          "checklist": [
            "能说出至少一个具体的测量效应来源（如记录员更关注刀工段、学生知道被称重后更注意下料）",
            "能说明用什么办法控制或估计这个效应（如平行班参照、记录员轮换、不告知具体称重阶段）",
            "能承认如果控制不了，前后对比的结论只能作为描述性参考而不是因果推断"
          ],
          "risk": 75
        },
        {
          "id": "q7",
          "claimId": "c4",
          "question": "一条台账要分 4 个阶段称重，清洗前后、解冻前后、修整前后、刀工成形前后各称一次——解冻环节原料带着血水、清洗环节带着水，你怎么保证这 4 次称的是同一批原料的『干重』？如果每次称的基准不一样，分阶段占比还能直接相加吗？",
          "why": "这是分阶段称重法最容易被当场戳穿的地方：解冻会出水、清洗会吸水，如果每次称重不统一基准，4 个阶段的重量差就不是损耗而是水分变化，整份分阶段台账的加总逻辑会当场崩掉。老师问这个，是在检验你有没有真正做过预实验、有没有定义清楚『损耗』的称重口径。",
          "checklist": [
            "能说出每个阶段称重前统一控水/沥干的具体操作（如固定沥水时间、用同一台秤、同一容器去皮）",
            "能说明解冻失水是单独记录还是并入解冻阶段损耗，并解释为什么这样处理",
            "能给出预实验中同一原料重复称重的误差范围，证明阶段差大于称重误差"
          ],
          "risk": 95
        },
        {
          "id": "q8",
          "claimId": "c4",
          "question": "640 条台账、每条 4 个阶段、8 类原料，16 周里每节课都要停下来称 4 次——这个称重动作是谁来做、一节课要多花多少时间？如果让实训教师顺手记，他们愿意配合 16 周吗？",
          "why": "这条主张的可行性完全压在『每一条都分 4 阶段称重』上，但刀工实训节奏快、原料多，称重会打断教学流程。老师问这个，是在检验你有没有算过人力成本、有没有和实训室谈过落地方式；答不上来，这条数据采集方案就只是纸面设计。",
          "checklist": [
            "能说出称重由谁执行（学生分组轮值/实训教师/研究助理），并说明是否影响正常教学",
            "能估算单条台账分 4 阶段称重额外增加的时间，并给出 16 周内可承受的理由",
            "能说明如果某节课漏称或补称，台账如何处理，是否有备用记录流程"
          ],
          "risk": 75
        },
        {
          "id": "q9",
          "claimId": "c5",
          "question": "你说依据《中式烹调师职业技能标准》自编了 4 类 12 项的编码表，那标准里到底哪一条对应你哪一类？比如「修整」和「刀工成形」的边界，标准原文是怎么划的？",
          "why": "编码表是你整个损耗归因的测量工具，如果 4 类 12 项和标准之间只是「参考」而不是逐条对应，老师会直接质疑这套分类是你自己拍的，后面刀工成形占比多少就失去了依据。",
          "checklist": [
            "能拿出编码表与《标准》条目的逐条对照表，至少说明每一类是从标准哪一项衍生出来的",
            "能举一个具体原料（如土豆）说明同一操作在「修整」和「刀工成形」之间怎么判定归属",
            "承认标准中没有直接对应的项，并说明补充依据是什么"
          ],
          "risk": 75
        },
        {
          "id": "q10",
          "claimId": "c5",
          "question": "两名实训教师双盲编码 640 条，Kappa 0.83 是整体算的还是分阶段算的？如果「刀工成形」这一段的 Kappa 明显低于其他三段，你怎么处理？",
          "why": "Kappa 0.83 是整体值，但你的核心结论恰恰依赖「刀工成形」这一段占比，如果这一段恰恰是编码分歧最大的，整体 Kappa 会掩盖关键分类的不可靠，老师会追问分段一致性。",
          "checklist": [
            "能报出 4 个阶段各自的 Kappa 或一致率，而不只是整体 0.83",
            "对分歧集中的类别有预设处理规则（如第三人仲裁或合并类别）",
            "能说明分歧记录是否会影响刀工成形占比的最终数值"
          ],
          "risk": 55
        },
        {
          "id": "q11",
          "claimId": "c6",
          "question": "前 8 周只记总数、后 8 周才分阶段记，那你怎么排除「后 8 周损耗占比变化」是季节、课程进度或学生熟练度自然变化造成的，而不是你加记分项本身带来的？",
          "why": "这是前后测单组设计的经典硬伤：没有对实验班做同步的「分阶段记录」对照，平行班又只记总数，无法提供阶段占比的基线。答不上来，整个「比对 320 条记录阶段占比变化」的因果推断就废了，老师会直接质疑这条研究内容能不能支撑研究问题。",
          "checklist": [
            "能说清平行班为什么不能提供阶段占比基线，并承认这是设计局限",
            "能提出至少一个补救方案（如后 8 周对平行班抽样补记分项、或用前 8 周原料结构做协变量控制）",
            "能明确说明在论文里会把「阶段占比变化」写成描述性结果而非因果结论"
          ],
          "risk": 95
        },
        {
          "id": "q12",
          "claimId": "c6",
          "question": "后 8 周加记 4 个阶段的分项重量，称重动作本身会不会改变实训操作——比如学生为了称重把原料分堆、放慢节奏，反而让刀工成形段的损耗和平时不一样？",
          "why": "这是测量本身引入的副作用（霍桑效应/程序效应）。如果称重流程干扰了正常实训，后 8 周的数据就不能代表真实损耗，整个分阶段台账的外部效度会被质疑。老师会追问你有没有意识到这个偏差、有没有控制手段。",
          "checklist": [
            "能描述称重由谁在什么时点做、是否嵌入正常流程而不打断学生操作",
            "能说出至少一个检验该偏差是否存在的方法（如对比平行班同期总损耗率有无异常跳变）",
            "能承认若偏差存在，结论只能限定在「有称重介入的实训条件」下"
          ],
          "risk": 75
        },
        {
          "id": "q13",
          "claimId": "c7",
          "question": "你这个自编量表 5 个维度 20 个评分点，具体是哪些维度？和《中式烹调师职业技能标准》里的刀工考核项是怎么对应的？",
          "why": "自编量表的维度如果和职业技能标准对不上，后面算出来的刀工测评成绩就没有外部效度，老师会质疑你测的到底是不是『刀工水平』。而且 20 个评分点怎么分配到 5 个维度、每个维度权重多少，直接决定成绩的分布，答不上来整个相关分析的分母就不可信。",
          "checklist": [
            "能逐条说出 5 个维度的名称，并指出每个维度对应职业技能标准里的哪一项考核要求",
            "能解释 20 个评分点在 5 个维度上的分配依据（是等权还是按标准里的分值比例）",
            "能说明量表是否经过预试或专家效度检验，如果没有，承认这是自编量表的局限"
          ],
          "risk": 75
        },
        {
          "id": "q14",
          "claimId": "c7",
          "question": "128 名学生 3 次测评，双人评分——两次评分不一致的时候怎么处理？是取平均、讨论定分，还是第三人仲裁？",
          "why": "Kappa 0.81 只说明两次评分整体一致性高，但具体到某一条记录上两人给了不同分数时，处理规则会直接影响每个学生的最终成绩。如果规则不统一，同一个分数在不同学生身上含义不同，后面和损耗占比做相关时，误差会直接吃掉可能存在的相关信号。",
          "checklist": [
            "能明确说出分歧处理规则（取平均/讨论定分/第三人仲裁），并说明为什么选这一种",
            "能给出 3 次测评中实际出现分歧的记录比例，而不只是总体 Kappa",
            "能说明分歧处理后的最终成绩是否还保留原始两次评分，以备复核"
          ],
          "risk": 55
        },
        {
          "id": "q15",
          "claimId": "c8",
          "question": "你预期要给出刀工成形损耗占比和刀工测评成绩的相关系数，那如果算出来相关系数只有 0.1 甚至不显著，你这份报告还成立吗？你事先有没有一个判定标准，说什么样的相关系数才算支持你的预期？",
          "why": "这是预期成果里最核心的可证伪性问题。如果作者没有预设判定标准，答辩老师会认为这个研究只是‘算出一个数’，而不是在检验一个假设——算出来是什么就是什么，那研究结论就无法证伪，预期成果也就没有意义。",
          "checklist": [
            "能说出一个事先设定的相关系数阈值（比如 r≥0.3 或 r≥0.5）或显著性水平（p<0.05），并说明依据",
            "能明确回答‘如果 r 不显著，我会怎么解释、报告怎么写’，而不是含糊说‘再看情况’",
            "能承认相关不等于因果，并说明即使相关显著也不会直接推断刀工损耗导致成绩差异"
          ],
          "risk": 75
        },
        {
          "id": "q16",
          "claimId": "c8",
          "question": "你只有 128 名学生、4 个班，其中 2 个平行班后 8 周才加记分项重量，那算刀工成形损耗占比和成绩的相关系数时，你是用全部 128 人还是只用加记分项的那部分学生？样本量够不够支撑你报一个稳定的相关系数？",
          "why": "这条预期成果把‘640 条台账’和‘128 名学生’并列，但台账记录数和学生人数不是一回事。答辩老师会追问：相关系数的实际样本量到底是多少？如果只有部分学生有分阶段数据，样本量可能远小于 128，相关系数的置信区间会很宽，报出来的数不稳定。",
          "checklist": [
            "能说清相关系数实际用的学生样本量是多少（是 128 还是更少），并解释为什么",
            "能给出该样本量下相关系数的置信区间或统计功效的大致判断",
            "能说明如果样本量不足，会如何调整预期成果的表述（比如只报描述性占比，不强行报相关系数）"
          ],
          "risk": 55
        }
      ],
      "warnings": [],
      "usage": {
        "promptTokens": 28766,
        "completionTokens": 4783,
        "totalTokens": 33549,
        "calls": 17
      },
      "costYuan": 0.0479,
      "model": "deepseek-chat",
      "scoresArePlaceholder": false,
      "blindClaimIds": [],
      "manualRefCount": 0,
      "manualRefsEnabled": true,
      "evidence": [
        {
          "claimId": "c1",
          "score": 58,
          "reason": "这条主张交代了一部分依据，还缺细节。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 50,
              "hits": [
                "两个",
                "提纲里有：两个",
                "提纲里有：4个",
                "提纲里有：16周",
                "提纲里有：35.0%",
                "提纲里有：640条",
                "提纲里有：128名",
                "提纲里有：3次",
                "提纲里有：一条",
                "提纲里有：两名",
                "提纲里有：8周",
                "提纲里有：2个",
                "提纲里有：320条",
                "提纲里有：5个",
                "提纲里有：20个",
                "提纲里有：一份"
              ]
            },
            {
              "name": "有没有方法",
              "score": 50,
              "hits": [
                "统计",
                "提纲里有：评分者一致性",
                "提纲里有：编码表",
                "提纲里有：量表",
                "提纲里有：双盲",
                "提纲里有：统计",
                "提纲里有：编码",
                "提纲里有：测评"
              ]
            },
            {
              "name": "有没有出处",
              "score": 50,
              "hits": [
                "统计"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 100,
              "hits": [
                "专业",
                "实训",
                "（句子够长）"
              ]
            }
          ]
        },
        {
          "claimId": "c2",
          "score": 49,
          "reason": "这条主张交代了一部分依据，还缺细节。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 50,
              "hits": [
                "提纲里有：两个",
                "提纲里有：4个",
                "提纲里有：16周",
                "提纲里有：35.0%",
                "提纲里有：640条",
                "提纲里有：128名",
                "提纲里有：3次",
                "提纲里有：一条",
                "提纲里有：两名",
                "提纲里有：8周",
                "提纲里有：2个",
                "提纲里有：320条",
                "提纲里有：5个",
                "提纲里有：20个",
                "提纲里有：一份"
              ]
            },
            {
              "name": "有没有方法",
              "score": 50,
              "hits": [
                "提纲里有：评分者一致性",
                "提纲里有：编码表",
                "提纲里有：量表",
                "提纲里有：双盲",
                "提纲里有：统计",
                "提纲里有：编码",
                "提纲里有：测评"
              ]
            },
            {
              "name": "有没有出处",
              "score": 50,
              "hits": [
                "提纲里有：统计",
                "提纲里有：记录"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 40,
              "hits": [
                "（句子够长）"
              ]
            }
          ]
        },
        {
          "claimId": "c3",
          "score": 55,
          "reason": "这条主张交代了一部分依据，还缺细节。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 70,
              "hits": [
                "640条",
                "4个"
              ]
            },
            {
              "name": "有没有方法",
              "score": 50,
              "hits": [
                "提纲里有：评分者一致性",
                "提纲里有：编码表",
                "提纲里有：量表",
                "提纲里有：双盲",
                "提纲里有：统计",
                "提纲里有：编码",
                "提纲里有：测评"
              ]
            },
            {
              "name": "有没有出处",
              "score": 50,
              "hits": [
                "提纲里有：统计",
                "提纲里有：记录"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 40,
              "hits": [
                "（句子够长）"
              ]
            }
          ]
        },
        {
          "claimId": "c4",
          "score": 49,
          "reason": "这条主张交代了一部分依据，还缺说得具体吗。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 70,
              "hits": [
                "一条",
                "4个"
              ]
            },
            {
              "name": "有没有方法",
              "score": 50,
              "hits": [
                "提纲里有：评分者一致性",
                "提纲里有：编码表",
                "提纲里有：量表",
                "提纲里有：双盲",
                "提纲里有：统计",
                "提纲里有：编码",
                "提纲里有：测评"
              ]
            },
            {
              "name": "有没有出处",
              "score": 50,
              "hits": [
                "记录"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 0,
              "hits": []
            }
          ]
        },
        {
          "claimId": "c5",
          "score": 79,
          "reason": "这条主张自带样本、方法和出处，答辩时能顺着它往下问。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 70,
              "hits": [
                "两名",
                "640条"
              ]
            },
            {
              "name": "有没有方法",
              "score": 100,
              "hits": [
                "编码表",
                "双盲",
                "编码"
              ]
            },
            {
              "name": "有没有出处",
              "score": 50,
              "hits": [
                "记录"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 100,
              "hits": [
                "实训",
                "（句子够长）"
              ]
            }
          ]
        },
        {
          "claimId": "c6",
          "score": 64,
          "reason": "这条主张交代了一部分依据，还缺细节。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 100,
              "hits": [
                "8周",
                "两个",
                "4个",
                "2个",
                "320条"
              ]
            },
            {
              "name": "有没有方法",
              "score": 50,
              "hits": [
                "提纲里有：评分者一致性",
                "提纲里有：编码表",
                "提纲里有：量表",
                "提纲里有：双盲",
                "提纲里有：统计",
                "提纲里有：编码",
                "提纲里有：测评"
              ]
            },
            {
              "name": "有没有出处",
              "score": 50,
              "hits": [
                "记录"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 40,
              "hits": [
                "（句子够长）"
              ]
            }
          ]
        },
        {
          "claimId": "c7",
          "score": 67,
          "reason": "这条主张交代了一部分依据，还缺细节。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 100,
              "hits": [
                "128名",
                "3次",
                "5个",
                "20个"
              ]
            },
            {
              "name": "有没有方法",
              "score": 60,
              "hits": [
                "量表",
                "测评"
              ]
            },
            {
              "name": "有没有出处",
              "score": 50,
              "hits": [
                "提纲里有：统计",
                "提纲里有：记录"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 40,
              "hits": [
                "（句子够长）"
              ]
            }
          ]
        },
        {
          "claimId": "c8",
          "score": 76,
          "reason": "这条主张自带样本、方法和出处，答辩时能顺着它往下问。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 100,
              "hits": [
                "一份",
                "640条",
                "128名"
              ]
            },
            {
              "name": "有没有方法",
              "score": 50,
              "hits": [
                "统计",
                "测评",
                "提纲里有：评分者一致性",
                "提纲里有：编码表",
                "提纲里有：量表",
                "提纲里有：双盲",
                "提纲里有：统计",
                "提纲里有：编码",
                "提纲里有：测评"
              ]
            },
            {
              "name": "有没有出处",
              "score": 100,
              "hits": [
                "统计",
                "记录"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 40,
              "hits": [
                "（句子够长）"
              ]
            }
          ]
        }
      ],
      "search": [
        {
          "claimId": "c1",
          "trustworthy": true,
          "score": 42,
          "reason": "沾一点边。最像的是2019 年「Skills for human development: transforming voc…」，但共有的词不多。大概率是同一个大领域里的另一件事。",
          "totalHits": 11,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 5,
              "error": ""
            },
            {
              "name": "中文网页",
              "answered": true,
              "hitCount": 6,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.1080/13636820.2019.1627065",
            "title": "Skills for human development: transforming vocational education and training",
            "year": "2019",
            "authors": [
              "Gavin Moodie"
            ],
            "venue": "Journal of Vocational Education &amp; Training",
            "url": "https://doi.org/10.1080/13636820.2019.1627065"
          },
          "matched": [
            "skill",
            "train",
            "education",
            "vocational"
          ],
          "webStatus": "ok",
          "webHitCount": 6,
          "manualHitCount": 0
        },
        {
          "claimId": "c2",
          "trustworthy": true,
          "score": 42,
          "reason": "沾一点边。最像的是2019 年「Skills for human development: transforming voc…」，但共有的词不多。大概率是同一个大领域里的另一件事。",
          "totalHits": 11,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 5,
              "error": ""
            },
            {
              "name": "中文网页",
              "answered": true,
              "hitCount": 6,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.1080/13636820.2019.1627065",
            "title": "Skills for human development: transforming vocational education and training",
            "year": "2019",
            "authors": [
              "Gavin Moodie"
            ],
            "venue": "Journal of Vocational Education &amp; Training",
            "url": "https://doi.org/10.1080/13636820.2019.1627065"
          },
          "matched": [
            "skill",
            "education",
            "vocational",
            "train"
          ],
          "webStatus": "ok",
          "webHitCount": 6,
          "manualHitCount": 0
        },
        {
          "claimId": "c3",
          "trustworthy": true,
          "score": 42,
          "reason": "沾一点边。最像的是2019 年「Skills for human development: transforming voc…」，但共有的词不多。大概率是同一个大领域里的另一件事。",
          "totalHits": 11,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 5,
              "error": ""
            },
            {
              "name": "中文网页",
              "answered": true,
              "hitCount": 6,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.1080/13636820.2019.1627065",
            "title": "Skills for human development: transforming vocational education and training",
            "year": "2019",
            "authors": [
              "Gavin Moodie"
            ],
            "venue": "Journal of Vocational Education &amp; Training",
            "url": "https://doi.org/10.1080/13636820.2019.1627065"
          },
          "matched": [
            "skill",
            "education",
            "vocational",
            "train"
          ],
          "webStatus": "ok",
          "webHitCount": 6,
          "manualHitCount": 0
        },
        {
          "claimId": "c4",
          "trustworthy": true,
          "score": 46,
          "reason": "沾一点边。最像的是2019 年「Food loss and waste and food security」，但共有的词不多。大概率是同一个大领域里的另一件事。",
          "totalHits": 10,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 5,
              "error": ""
            },
            {
              "name": "中文网页",
              "answered": true,
              "hitCount": 5,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.4337/9781788975391.00006",
            "title": "Food loss and waste and food security",
            "year": "2019",
            "authors": [],
            "venue": "Food Loss and Food Waste",
            "url": "https://doi.org/10.4337/9781788975391.00006"
          },
          "matched": [
            "food",
            "waste",
            "loss"
          ],
          "webStatus": "ok",
          "webHitCount": 5,
          "manualHitCount": 0
        },
        {
          "claimId": "c5",
          "trustworthy": true,
          "score": 49,
          "reason": "沾一点边。最像的是2019 年「The Inter-Rater Reliability of Technical Skill…」，但共有的词不多。大概率是同一个大领域里的另一件事。",
          "totalHits": 8,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 2,
              "error": ""
            },
            {
              "name": "中文网页",
              "answered": true,
              "hitCount": 6,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.1016/j.jsurg.2019.01.001",
            "title": "The Inter-Rater Reliability of Technical Skills Assessment and Retention of Rater Training",
            "year": "2019",
            "authors": [
              "Nada Gawad",
              "Amanda Fowler",
              "Richard Mimeault",
              "Isabelle Raiche"
            ],
            "venue": "Journal of Surgical Education",
            "url": "https://doi.org/10.1016/j.jsurg.2019.01.001"
          },
          "matched": [
            "inter",
            "rater",
            "reliability",
            "education",
            "skill",
            "train"
          ],
          "webStatus": "ok",
          "webHitCount": 6,
          "manualHitCount": 0
        },
        {
          "claimId": "c6",
          "trustworthy": true,
          "score": 40,
          "reason": "沾一点边。最像的是2019 年「Food loss and waste and food security」，但共有的词不多。大概率是同一个大领域里的另一件事。",
          "totalHits": 9,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 3,
              "error": ""
            },
            {
              "name": "中文网页",
              "answered": true,
              "hitCount": 6,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.4337/9781788975391.00006",
            "title": "Food loss and waste and food security",
            "year": "2019",
            "authors": [],
            "venue": "Food Loss and Food Waste",
            "url": "https://doi.org/10.4337/9781788975391.00006"
          },
          "matched": [
            "food",
            "waste",
            "loss"
          ],
          "webStatus": "ok",
          "webHitCount": 6,
          "manualHitCount": 0
        },
        {
          "claimId": "c7",
          "trustworthy": true,
          "score": 56,
          "reason": "有重合。最像的是2022 年「Comparison of Inter-Rater Reliability Techniqu…」，2 篇沾边。别人做过相邻的事，但没做到你这个位置 —— 答辩时要把\"我跟它差在哪\"讲清楚。",
          "totalHits": 4,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 4,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.21449/ijate.993805",
            "title": "Comparison of Inter-Rater Reliability Techniques in Performance-Based Assessment",
            "year": "2022",
            "authors": [
              "Sinem ARSLAN MANCAR",
              "Hamide Deniz GÜLLEROĞLU"
            ],
            "venue": "International Journal of Assessment Tools in Education",
            "url": "https://doi.org/10.21449/ijate.993805"
          },
          "matched": [
            "assessment",
            "education",
            "inter",
            "rater",
            "reliability",
            "performance"
          ],
          "webStatus": "off",
          "webHitCount": 0,
          "manualHitCount": 0
        },
        {
          "claimId": "c8",
          "trustworthy": true,
          "score": 42,
          "reason": "沾一点边。最像的是2019 年「Skills for human development: transforming voc…」，但共有的词不多。大概率是同一个大领域里的另一件事。",
          "totalHits": 11,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 5,
              "error": ""
            },
            {
              "name": "中文网页",
              "answered": true,
              "hitCount": 6,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.1080/13636820.2019.1627065",
            "title": "Skills for human development: transforming vocational education and training",
            "year": "2019",
            "authors": [
              "Gavin Moodie"
            ],
            "venue": "Journal of Vocational Education &amp; Training",
            "url": "https://doi.org/10.1080/13636820.2019.1627065"
          },
          "matched": [
            "skill",
            "train",
            "education",
            "vocational"
          ],
          "webStatus": "ok",
          "webHitCount": 6,
          "manualHitCount": 0
        }
      ],
      "elapsedMs": 34996
    },
  },
  {
    name: "教育学·学习分析",
    quality: 67,
    note: "研究设计写得很完整：样本量、点击流条数、编码信度、量表出处都有 —— 能跑出主场",
    outline: "一、研究背景\n混合式教学在高校课程中已广泛推开，但多数实践只报告满意度与成绩，很少追问\"学生课前在平台上到底做了什么\"。学习管理系统沉淀了大量行为日志，这些日志与课堂表现之间的关系尚未被充分利用。现有研究多用问卷自报的学习投入，缺少对真实行为序列的刻画。\n二、研究问题\n在本科教育学专业\"课程与教学论\"混合式课程中，学生课前在线学习的行为序列模式，能否预测其在课堂研讨环节的发言质量？\n三、研究内容\n1. 梳理学习分析领域中使用行为日志刻画学习投入的常用指标与分析方法。\n2. 采集并编码学生课前在线学习的行为日志，识别典型行为序列模式。\n3. 检验行为序列模式与课堂发言质量之间的关联。\n四、研究方法\n采用混合方法设计，选取本校教育学专业两个平行班共 128 名学生作为样本（实验班 64 人、对照班 64 人），持续一个学期共 16 周。行为数据来自课程学习管理平台的后台日志，共采集 128 名学生的点击流记录 4 万余条；采用滞后序列分析（lag sequential analysis）识别行为模式。课堂发言质量由两名研究者依据自编编码表独立编码，评分者一致性 Kappa 为 0.82；学习投入自报数据使用《大学生学习投入量表》（UWES-S 中文版，信度 α=0.89）作为交叉验证，前后测各施测一次。\n五、预期成果\n形成一套基于行为日志的课前学习投入刻画方法，并给出行为序列与课堂发言质量关联的实证证据。",
    payload: {
      "claims": [
        {
          "id": "c1",
          "text": "多数实践只报告满意度与成绩，很少追问“学生课前在平台上到底做了什么”。",
          "type": "problem",
          "location": "研究背景 第 1 段",
          "overlap": 66,
          "defensibility": 61
        },
        {
          "id": "c2",
          "text": "现有研究多用问卷自报的学习投入，缺少对真实行为序列的刻画。",
          "type": "problem",
          "location": "研究背景 第 1 段",
          "overlap": 51,
          "defensibility": 49
        },
        {
          "id": "c3",
          "text": "学生课前在线学习的行为序列模式，能否预测其在课堂研讨环节的发言质量？",
          "type": "problem",
          "location": "研究问题 第 1 段",
          "overlap": 66,
          "defensibility": 52
        },
        {
          "id": "c4",
          "text": "采集并编码学生课前在线学习的行为日志，识别典型行为序列模式。",
          "type": "method",
          "location": "研究内容 第 2 条",
          "overlap": 50,
          "defensibility": 58
        },
        {
          "id": "c5",
          "text": "采用滞后序列分析（lag sequential analysis）识别行为模式。",
          "type": "method",
          "location": "研究方法 第 1 段",
          "overlap": 50,
          "defensibility": 58
        },
        {
          "id": "c6",
          "text": "学习投入自报数据使用《大学生学习投入量表》（UWES-S 中文版，信度 α=0.89）作为交叉验证，前后测各施测一次。",
          "type": "method",
          "location": "研究方法 第 1 段",
          "overlap": 43,
          "defensibility": 72
        },
        {
          "id": "c7",
          "text": "形成一套基于行为日志的课前学习投入刻画方法，并给出行为序列与课堂发言质量关联的实证证据。",
          "type": "expectation",
          "location": "预期成果 第 1 段",
          "overlap": 54,
          "defensibility": 52
        }
      ],
      "questions": [
        {
          "id": "q1",
          "claimId": "c1",
          "question": "你说「多数实践只报告满意度与成绩」，这个判断是怎么得出来的？你系统检索过哪些文献、覆盖了多少门课，还是只凭自己看到的几篇论文和身边课程的经验？",
          "why": "这是整份开题的立论起点——如果「研究空白」只是印象而非证据，后面所有工作就失去了必要性。老师一定会追问这个空白是否真实存在，答不上来等于承认问题是被构造出来的。",
          "checklist": [
            "能说出检索的数据库、时间范围、关键词，以及筛出的文献大致数量",
            "能举出至少 2-3 篇确实只报告满意度/成绩、未分析行为日志的典型研究作为例证",
            "能承认「很少」不等于「没有」，并说明自己与已有行为日志研究的区别在哪"
          ],
          "risk": 95
        },
        {
          "id": "q2",
          "claimId": "c1",
          "question": "「学生课前在平台上到底做了什么」——平台日志能记录到的「做」是什么粒度？看视频、点课件、发帖这些点击行为，能等同于你后面要关联的「学习投入」吗？",
          "why": "这条主张暗含一个假设：日志里的行为就是有价值的「学习过程」。但点击流可能只反映登录和翻页，无法区分深度阅读与挂机刷时长。如果这个对应关系不成立，用行为序列预测发言质量的整条逻辑链就断了。",
          "checklist": [
            "能说清日志字段具体包含哪些行为类型，哪些是平台记录不到的",
            "能解释为什么所选行为指标可以代表「投入」而不是「操作痕迹」，最好有文献依据",
            "能说明如果日志粒度不足，打算用什么方式（如结合自报量表或课堂观察）补足"
          ],
          "risk": 75
        },
        {
          "id": "q3",
          "claimId": "c2",
          "question": "你说现有研究多用问卷自报、缺少真实行为序列的刻画，这个判断是你系统检索后得出的，还是凭印象？如果老师追问『学习分析领域用点击流做序列分析的文章你读过几篇』，你打算怎么答？",
          "why": "这是整篇开题的立论基础——如果这个『缺口』不成立，后面的研究问题就没有存在理由。老师大概率自己读过 lag sequential analysis 相关文献，会当场检验你是否真的做过综述。答不上来意味着你在用『填补空白』的套话掩盖文献准备不足。",
          "checklist": [
            "能说出至少 2-3 篇确实用问卷自报学习投入的代表性研究，并指出它们的具体局限（不是笼统说『主观』）",
            "能说出至少 1-2 篇已经用 LMS 日志做行为序列分析的研究，并解释它们为什么没有回答你的研究问题",
            "承认『缺少』是相对的——是缺少『行为序列与课堂发言质量』这一特定关联的刻画，而不是整个领域没人用行为日志"
          ],
          "risk": 95
        },
        {
          "id": "q4",
          "claimId": "c2",
          "question": "问卷自报的学习投入和日志记录的行为，测的其实是两个东西——你凭什么认为前者『不够真实』而不是『测了另一个维度』？如果自报投入和日志行为不一致，你打算信哪个？",
          "why": "这条主张暗含一个价值判断：自报数据不如行为数据真实。但学习投入本身包含情感、认知维度，问卷恰恰能捕捉日志看不到的东西。老师会追问这个二分法是否成立。答不好说明你对『学习投入』的构念效度没有想清楚，后面用 UWES-S 做交叉验证的逻辑也会跟着塌。",
          "checklist": [
            "能区分行为投入、情感投入、认知投入三个维度，并说明日志主要覆盖哪一维、问卷覆盖哪几维",
            "能解释为什么在你的研究问题里行为序列比自报投入更贴切（因为要预测的是课堂发言这一外显行为）",
            "能说明当两者不一致时你的处理策略——是视为测量误差，还是视为有意义的分离，并给出理由"
          ],
          "risk": 75
        },
        {
          "id": "q5",
          "claimId": "c3",
          "question": "你把「行为序列模式」和「课堂发言质量」放在一个预测关系里，但这两个东西都是你自己编码出来的——行为序列的切分规则和发言质量的编码表，会不会其实是同一套教学理念的两种写法，导致关联是定义出来的而不是发现的？",
          "why": "这是整份研究立论的关键：如果两个变量的操作性定义共享了同一套价值判断（比如都把「高频交互、深度提问」算作好），那算出来的关联只是编码表内部一致性的投影，不是行为日志对课堂表现的预测。答不上来，整个「能否预测」的问题就变成了循环论证，老师会直接质疑这条研究问题还成不成立。",
          "checklist": [
            "能说清行为序列的切分规则（哪些点击算一个「模式」、时间窗口怎么定）和发言质量编码表的维度是各自独立制定的，并给出至少一个两者可能不一致的具体例子",
            "能指出如果两个编码体系共享了某个维度，你打算怎么在分析中控制或检验这种共线",
            "能承认这是相关而非预测，并说明为什么在相关层面这个发现仍有价值"
          ],
          "risk": 95
        },
        {
          "id": "q6",
          "claimId": "c3",
          "question": "你说要「预测」发言质量，但两个平行班一个实验班一个对照班，实验班和对照班在课前在线学习的安排上是不是本来就不一样？如果是，你测出来的行为序列差异到底反映的是学生投入，还是你给两个班布置的任务不同？",
          "why": "这条问题追的是归因：如果实验班和对照班的在线学习任务设计不同，行为日志的差异首先反映的是课程设计差异，而不是学生投入差异，那么「行为序列预测发言质量」这个因果方向就站不住。答不上来，老师会认为你连最基本的组间可比性都没处理。",
          "checklist": [
            "能明确说明两个班在课前在线学习任务、平台使用要求上是否一致，若不一致，差异具体在哪",
            "能给出至少一种处理方式（如把班级作为控制变量、或只在班内做序列与发言质量的关联），并解释为什么这样能剥离课程设计的影响",
            "能说清如果两个班任务确实不同，你的结论适用范围要收窄到什么程度"
          ],
          "risk": 75
        },
        {
          "id": "q7",
          "claimId": "c4",
          "question": "你说用滞后序列分析识别行为模式，那 4 万条点击流里，每个学生平均 300 多条，够不够跑出稳定的序列转移？你打算怎么处理那些点击量特别少的学生？",
          "why": "滞后序列分析对每个学生的行为序列长度有要求，点击流太少的学生根本形不成有意义的转移矩阵。如果答不上来，说明你没算过数据够不够，也没想过样本里会有『潜水』学生，整个行为模式识别可能只对一部分活跃学生成立，结论的普适性直接打折。",
          "checklist": [
            "能说出滞后序列分析对单个学生最少需要多少条行为记录，并给出你数据里满足这个门槛的学生比例",
            "能说明对点击量过低的学生是剔除、合并还是单独分析，并解释为什么这样处理不会引入偏差",
            "能拿出至少一个预实验或模拟数据，证明 4 万条点击流在 128 人规模下跑出的转移矩阵是稳定的"
          ],
          "risk": 75
        },
        {
          "id": "q8",
          "claimId": "c4",
          "question": "你编码行为日志时，是把点击流直接映射成『观看视频』『做测验』这类类别，还是按时间窗口切分成序列片段？这个编码规则是谁定的，有没有信效度检验？",
          "why": "行为日志的编码规则直接决定后面识别出什么模式。如果规则是拍脑袋定的，没有编码手册和一致性检验，那识别出的『典型序列』可能只是你主观切分的结果，换个人编码就是另一套模式，整个研究内容 2 的产出就不可复现。",
          "checklist": [
            "能拿出书面的编码规则或编码手册，说明每个行为类别对应哪些具体日志字段和操作定义",
            "能说明编码规则是参考已有文献还是自行开发，如果是自行开发，有没有请第二人独立编码并报告一致性",
            "能解释时间窗口的切分依据（比如按会话超时 30 分钟切分），并说明不同切分方式会不会改变识别出的模式"
          ],
          "risk": 55
        },
        {
          "id": "q9",
          "claimId": "c5",
          "question": "滞后序列分析要算行为间的转移显著性，你 128 个学生一学期 4 万条点击，平均每人 300 多条，但分到 16 周、每周的课前任务上，单个学生每周的行为序列够长吗？如果序列太短，滞后序列分析算出来的 z 值还稳吗？",
          "why": "滞后序列分析对序列长度和事件频次有最低要求，序列太短时转移频次稀疏，z 值会剧烈波动，识别出的『典型模式』可能只是噪声。答不上来会暴露你其实没算过每个学生每周的有效序列长度，方法可行性存疑。",
          "checklist": [
            "能说出你按什么时间窗口切分序列（如每次课前任务一个序列），并给出每个序列的平均事件数",
            "能说明当序列长度低于多少时你会合并或剔除，并给出依据",
            "能承认如果序列普遍偏短，滞后序列分析可能不适用，并说出备选方案"
          ],
          "risk": 75
        },
        {
          "id": "q10",
          "claimId": "c5",
          "question": "你识别出的行为序列模式，怎么保证不是平台界面设计逼出来的固定路径？比如学生必须先点视频再点测验，这种转移显著是学习行为还是系统导航？",
          "why": "滞后序列分析会把平台强制或引导的点击顺序识别为显著转移，如果不区分系统约束行为和自主选择行为，所谓『典型模式』可能只是界面导航的镜像，与学习投入无关。答不上来会暴露你把平台结构当成了学习规律。",
          "checklist": [
            "能指出哪些转移是平台强制顺序（如必须看完视频才能解锁测验），并说明如何在分析中排除或标记",
            "能举出至少一个你预期是自主选择而非系统约束的转移，并说明判断依据",
            "能说明你会不会用对照班（或不同平台版本）来验证模式不是界面设计导致的"
          ],
          "risk": 55
        },
        {
          "id": "q11",
          "claimId": "c6",
          "question": "UWES-S 测的是学习投入的活力、奉献、专注，你拿它跟点击流做交叉验证，具体验证的是哪个构念？如果自报投入高但点击流很稀疏，你判哪个是对的？",
          "why": "交叉验证不是把两份数据摆在一起就算数。UWES-S 是自报的心理状态量表，点击流是行为痕迹，两者测的根本不是同一个东西。答不上来会暴露你其实没想清楚这两份数据在分析里各自扮演什么角色，老师会怀疑整个混合方法设计是拼凑的。",
          "checklist": [
            "能说清 UWES-S 的哪个维度（活力/奉献/专注）与哪类行为指标（如登录频次、资源访问深度）在构念上对应",
            "能预设自报与行为不一致时的解释框架（如自报高但行为少可能反映策略性投入或社会赞许偏差），而不是简单说‘以行为数据为准’",
            "能说明交叉验证的结论将如何影响后续滞后序列分析的解释边界"
          ],
          "risk": 75
        },
        {
          "id": "q12",
          "claimId": "c6",
          "question": "前后测各一次，中间隔了 16 周，你打算怎么处理自报投入的自然波动和测验效应？如果后测分数普遍偏高，你怎么区分是课程起作用还是学生摸清了量表？",
          "why": "前后测设计最容易犯的错就是把变化全归给干预。UWES-S 是自报量表，学生第二次填的时候已经知道题目在问什么，后测偏高几乎是必然的。答不上来会暴露你没考虑测验效应和成熟效应，交叉验证的结论就站不住。",
          "checklist": [
            "能说出至少一种控制测验效应的做法（如打乱题项顺序、加入社会赞许性简表、或明确承认该局限并说明如何影响结论）",
            "能区分‘课程导致的投入变化’与‘重复施测导致的分数漂移’，并说明在分析中如何拆开",
            "能说明前后测数据在整体研究里到底用来支持哪一条结论，而不是笼统说‘作为交叉验证’"
          ],
          "risk": 55
        },
        {
          "id": "q13",
          "claimId": "c7",
          "question": "你说要给出「行为序列与课堂发言质量关联」的实证证据，但两个班是实验班和对照班，如果对照班没做同样的课前在线学习，你这条关联到底是在哪个班的数据上算的？",
          "why": "这条预期成果的措辞是「关联」，但研究设计里写的是实验班/对照班分组。如果对照班没有同等的在线学习行为日志，那关联分析只能做实验班 64 人，样本量直接砍半；如果两个班都有日志但教学设计不同，那行为序列的分布本身就被分组污染了。老师会追问你到底在哪个子样本上估计这条关联，答不上来意味着「实证证据」这四个字没有对应的分析方案。",
          "checklist": [
            "能明确说出关联分析是在实验班、对照班还是合并样本上做的，并解释为什么这样选",
            "能说清对照班的课前在线学习安排是什么，其行为日志是否与实验班可比",
            "如果只用实验班 64 人，能给出这个样本量下滞后序列分析与关联检验的可行性依据"
          ],
          "risk": 95
        },
        {
          "id": "q14",
          "claimId": "c7",
          "question": "课堂发言质量是两人用自编编码表打的分，行为序列是平台日志，你怎么排除「发言质量高的人本来就更爱发言、也更爱点平台」这种第三变量，让这条关联不只是一句相关？",
          "why": "预期成果写的是「关联」，但答辩老师会把它当因果证据来审。发言质量和在线行为可能同时受学习动机、先前成绩、性格等变量驱动，如果不控制这些，算出来的关联很可能只是「好学生什么都好」的另一种说法。答不上来会暴露这条实证证据的解释力非常有限，甚至可能被质疑整个预期成果的价值。",
          "checklist": [
            "能列出至少 2 个需要控制的混淆变量（如先前学业成绩、自报学习投入、发言意愿），并说明数据里有没有这些变量",
            "能说清在分析中打算怎么处理这些混淆变量（分层、协变量纳入模型等）",
            "能坦承这条证据是相关性质而非因果，并说明相关结论在什么范围内仍然有用"
          ],
          "risk": 75
        }
      ],
      "warnings": [],
      "usage": {
        "promptTokens": 23459,
        "completionTokens": 4079,
        "totalTokens": 27538,
        "calls": 15
      },
      "costYuan": 0.0398,
      "model": "deepseek-chat",
      "scoresArePlaceholder": false,
      "blindClaimIds": [],
      "manualRefCount": 0,
      "manualRefsEnabled": true,
      "evidence": [
        {
          "claimId": "c1",
          "score": 58,
          "reason": "这条主张交代了一部分依据，还缺细节。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 50,
              "hits": [
                "提纲里有：两个",
                "提纲里有：128名",
                "提纲里有：64人",
                "提纲里有：一个",
                "提纲里有：16周",
                "提纲里有：两名",
                "提纲里有：一次"
              ]
            },
            {
              "name": "有没有方法",
              "score": 50,
              "hits": [
                "提纲里有：评分者一致性",
                "提纲里有：前后测",
                "提纲里有：对照班",
                "提纲里有：编码表",
                "提纲里有：量表",
                "提纲里有：问卷",
                "提纲里有：问卷",
                "提纲里有：分析",
                "提纲里有：编码",
                "提纲里有：实验"
              ]
            },
            {
              "name": "有没有出处",
              "score": 50,
              "hits": [
                "提纲里有：数据",
                "提纲里有：样本",
                "提纲里有：记录"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 100,
              "hits": [
                "平台",
                "（句子够长）"
              ]
            }
          ]
        },
        {
          "claimId": "c2",
          "score": 46,
          "reason": "这条主张交代了一部分依据，还缺说得具体吗。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 50,
              "hits": [
                "提纲里有：两个",
                "提纲里有：128名",
                "提纲里有：64人",
                "提纲里有：一个",
                "提纲里有：16周",
                "提纲里有：两名",
                "提纲里有：一次"
              ]
            },
            {
              "name": "有没有方法",
              "score": 60,
              "hits": [
                "问卷",
                "问卷"
              ]
            },
            {
              "name": "有没有出处",
              "score": 50,
              "hits": [
                "提纲里有：数据",
                "提纲里有：样本",
                "提纲里有：记录"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 0,
              "hits": []
            }
          ]
        },
        {
          "claimId": "c3",
          "score": 49,
          "reason": "这条主张交代了一部分依据，还缺细节。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 50,
              "hits": [
                "提纲里有：两个",
                "提纲里有：128名",
                "提纲里有：64人",
                "提纲里有：一个",
                "提纲里有：16周",
                "提纲里有：两名",
                "提纲里有：一次"
              ]
            },
            {
              "name": "有没有方法",
              "score": 50,
              "hits": [
                "提纲里有：评分者一致性",
                "提纲里有：前后测",
                "提纲里有：对照班",
                "提纲里有：编码表",
                "提纲里有：量表",
                "提纲里有：问卷",
                "提纲里有：问卷",
                "提纲里有：分析",
                "提纲里有：编码",
                "提纲里有：实验"
              ]
            },
            {
              "name": "有没有出处",
              "score": 50,
              "hits": [
                "提纲里有：数据",
                "提纲里有：样本",
                "提纲里有：记录"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 40,
              "hits": [
                "（句子够长）"
              ]
            }
          ]
        },
        {
          "claimId": "c4",
          "score": 49,
          "reason": "这条主张交代了一部分依据，还缺细节。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 50,
              "hits": [
                "提纲里有：两个",
                "提纲里有：128名",
                "提纲里有：64人",
                "提纲里有：一个",
                "提纲里有：16周",
                "提纲里有：两名",
                "提纲里有：一次"
              ]
            },
            {
              "name": "有没有方法",
              "score": 50,
              "hits": [
                "编码",
                "提纲里有：评分者一致性",
                "提纲里有：前后测",
                "提纲里有：对照班",
                "提纲里有：编码表",
                "提纲里有：量表",
                "提纲里有：问卷",
                "提纲里有：问卷",
                "提纲里有：分析",
                "提纲里有：编码",
                "提纲里有：实验"
              ]
            },
            {
              "name": "有没有出处",
              "score": 50,
              "hits": [
                "提纲里有：数据",
                "提纲里有：样本",
                "提纲里有：记录"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 40,
              "hits": [
                "（句子够长）"
              ]
            }
          ]
        },
        {
          "claimId": "c5",
          "score": 49,
          "reason": "这条主张交代了一部分依据，还缺细节。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 50,
              "hits": [
                "提纲里有：两个",
                "提纲里有：128名",
                "提纲里有：64人",
                "提纲里有：一个",
                "提纲里有：16周",
                "提纲里有：两名",
                "提纲里有：一次"
              ]
            },
            {
              "name": "有没有方法",
              "score": 50,
              "hits": [
                "分析",
                "提纲里有：评分者一致性",
                "提纲里有：前后测",
                "提纲里有：对照班",
                "提纲里有：编码表",
                "提纲里有：量表",
                "提纲里有：问卷",
                "提纲里有：问卷",
                "提纲里有：分析",
                "提纲里有：编码",
                "提纲里有：实验"
              ]
            },
            {
              "name": "有没有出处",
              "score": 50,
              "hits": [
                "提纲里有：数据",
                "提纲里有：样本",
                "提纲里有：记录"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 40,
              "hits": [
                "（句子够长）"
              ]
            }
          ]
        },
        {
          "claimId": "c6",
          "score": 64,
          "reason": "这条主张交代了一部分依据，还缺细节。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 50,
              "hits": [
                "一次",
                "提纲里有：两个",
                "提纲里有：128名",
                "提纲里有：64人",
                "提纲里有：一个",
                "提纲里有：16周",
                "提纲里有：两名",
                "提纲里有：一次"
              ]
            },
            {
              "name": "有没有方法",
              "score": 100,
              "hits": [
                "前后测",
                "量表"
              ]
            },
            {
              "name": "有没有出处",
              "score": 50,
              "hits": [
                "数据"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 40,
              "hits": [
                "（句子够长）"
              ]
            }
          ]
        },
        {
          "claimId": "c7",
          "score": 49,
          "reason": "这条主张交代了一部分依据，还缺细节。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 50,
              "hits": [
                "提纲里有：两个",
                "提纲里有：128名",
                "提纲里有：64人",
                "提纲里有：一个",
                "提纲里有：16周",
                "提纲里有：两名",
                "提纲里有：一次"
              ]
            },
            {
              "name": "有没有方法",
              "score": 50,
              "hits": [
                "提纲里有：评分者一致性",
                "提纲里有：前后测",
                "提纲里有：对照班",
                "提纲里有：编码表",
                "提纲里有：量表",
                "提纲里有：问卷",
                "提纲里有：问卷",
                "提纲里有：分析",
                "提纲里有：编码",
                "提纲里有：实验"
              ]
            },
            {
              "name": "有没有出处",
              "score": 50,
              "hits": [
                "提纲里有：数据",
                "提纲里有：样本",
                "提纲里有：记录"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 40,
              "hits": [
                "（句子够长）"
              ]
            }
          ]
        }
      ],
      "search": [
        {
          "claimId": "c1",
          "trustworthy": true,
          "score": 66,
          "reason": "有重合。最像的是2016 年「Exploring the Effect of Behavioral Engagement …」，4 篇沾边。别人做过相邻的事，但没做到你这个位置 —— 答辩时要把\"我跟它差在哪\"讲清楚。",
          "totalHits": 5,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 5,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.1109/eitt.2016.56",
            "title": "Exploring the Effect of Behavioral Engagement on Learning Achievement in Online Learning Environment: Learning Analytics of Non-degree Online Learning Data",
            "year": "2016",
            "authors": [
              "Shuang Li",
              "Chen Yu",
              "Jingjing Hu",
              "Yao Zhong"
            ],
            "venue": "2016 International Conference on Educational Innovation through Technology (EITT)",
            "url": "https://doi.org/10.1109/eitt.2016.56"
          },
          "matched": [
            "learn",
            "analytic",
            "behavioral",
            "online",
            "engagement",
            "data"
          ],
          "webStatus": "off",
          "webHitCount": 0,
          "manualHitCount": 0
        },
        {
          "claimId": "c2",
          "trustworthy": true,
          "score": 51,
          "reason": "有重合。最像的是2021 年「Sequential engagement-based online learning an…」，2 篇沾边。别人做过相邻的事，但没做到你这个位置 —— 答辩时要把\"我跟它差在哪\"讲清楚。",
          "totalHits": 5,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 5,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.1016/b978-0-12-823410-5.00012-7",
            "title": "Sequential engagement-based online learning analytics and prediction",
            "year": "2021",
            "authors": [
              "Xiangyu Song",
              "Jianxin Li"
            ],
            "venue": "Intelligent Systems and Learning Data Analytics in Online Education",
            "url": "https://doi.org/10.1016/b978-0-12-823410-5.00012-7"
          },
          "matched": [
            "engagement",
            "learn",
            "analytic",
            "sequential",
            "data"
          ],
          "webStatus": "off",
          "webHitCount": 0,
          "manualHitCount": 0
        },
        {
          "claimId": "c3",
          "trustworthy": true,
          "score": 66,
          "reason": "有重合。最像的是2018 年「Discourse Analytics for Classroom Learning」，4 篇沾边。别人做过相邻的事，但没做到你这个位置 —— 答辩时要把\"我跟它差在哪\"讲清楚。",
          "totalHits": 5,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 5,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.1108/978-1-64113-371-520251007",
            "title": "Discourse Analytics for Classroom Learning",
            "year": "2018",
            "authors": [
              "Sherice N. Clarke",
              "Lauren B. Resnick",
              "Carolyn Penstein Rosé"
            ],
            "venue": "Learning Analytics in Education",
            "url": "https://doi.org/10.1108/978-1-64113-371-520251007"
          },
          "matched": [
            "learn",
            "analytic",
            "classroom",
            "discourse"
          ],
          "webStatus": "off",
          "webHitCount": 0,
          "manualHitCount": 0
        },
        {
          "claimId": "c4",
          "trustworthy": true,
          "score": 50,
          "reason": "有重合。最像的是2021 年「Sequential engagement-based online learning an…」，1 篇沾边。别人做过相邻的事，但没做到你这个位置 —— 答辩时要把\"我跟它差在哪\"讲清楚。",
          "totalHits": 1,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 1,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.1016/b978-0-12-823410-5.00012-7",
            "title": "Sequential engagement-based online learning analytics and prediction",
            "year": "2021",
            "authors": [
              "Xiangyu Song",
              "Jianxin Li"
            ],
            "venue": "Intelligent Systems and Learning Data Analytics in Online Education",
            "url": "https://doi.org/10.1016/b978-0-12-823410-5.00012-7"
          },
          "matched": [
            "learn",
            "analytic",
            "sequential",
            "online",
            "engagement"
          ],
          "webStatus": "off",
          "webHitCount": 0,
          "manualHitCount": 0
        },
        {
          "claimId": "c5",
          "trustworthy": true,
          "score": 50,
          "reason": "有重合。最像的是2026 年「Interaction Behavior Characteristics between A…」，2 篇沾边。别人做过相邻的事，但没做到你这个位置 —— 答辩时要把\"我跟它差在哪\"讲清楚。",
          "totalHits": 5,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 5,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.23977/autml.2026.070201",
            "title": "Interaction Behavior Characteristics between Autonomous Vehicles and Pedestrians: A Lag Sequential Analysis Approach",
            "year": "2026",
            "authors": [],
            "venue": "Automation and Machine Learning",
            "url": "https://doi.org/10.23977/autml.2026.070201"
          },
          "matched": [
            "lag",
            "sequential",
            "analysi",
            "behavior",
            "learn"
          ],
          "webStatus": "off",
          "webHitCount": 0,
          "manualHitCount": 0
        },
        {
          "claimId": "c6",
          "trustworthy": true,
          "score": 43,
          "reason": "沾一点边。最像的是2016 年「Validation of the Utrecht Work Engagement Scal…」，但共有的词不多。大概率是同一个大领域里的另一件事。",
          "totalHits": 8,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 2,
              "error": ""
            },
            {
              "name": "中文网页",
              "answered": true,
              "hitCount": 6,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.7763/ijssh.2016.v6.672-676",
            "title": "Validation of the Utrecht Work Engagement Scale (UWES) in the Malaysian Context",
            "year": "2016",
            "authors": [
              "Wan Shahrazad Wan Sulaiman",
              "Nur Aisyah Zahoni"
            ],
            "venue": "International Journal of Social Science and Humanity",
            "url": "https://doi.org/10.7763/ijssh.2016.v6.672-676"
          },
          "matched": [
            "engagement",
            "utrecht",
            "work",
            "scale",
            "validation"
          ],
          "webStatus": "ok",
          "webHitCount": 6,
          "manualHitCount": 0
        },
        {
          "claimId": "c7",
          "trustworthy": true,
          "score": 54,
          "reason": "有重合。最像的是2022 年「Personalized learning analytics intervention a…」，2 篇沾边。别人做过相邻的事，但没做到你这个位置 —— 答辩时要把\"我跟它差在哪\"讲清楚。",
          "totalHits": 5,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 5,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.1007/s10639-022-11291-2",
            "title": "Personalized learning analytics intervention approach for enhancing student learning achievement and behavioral engagement in blended learning",
            "year": "2022",
            "authors": [
              "Christopher C. Y. Yang",
              "Hiroaki Ogata"
            ],
            "venue": "Education and Information Technologies",
            "url": "https://doi.org/10.1007/s10639-022-11291-2"
          },
          "matched": [
            "learn",
            "analytic",
            "behavioral",
            "engagement",
            "blend"
          ],
          "webStatus": "off",
          "webHitCount": 0,
          "manualHitCount": 0
        }
      ],
      "elapsedMs": 31280
    },
  },
  {
    name: "教育学·思辨",
    quality: 23,
    note: "纯观点和体会，方法名是「文献研究法」，最容易被追问「你怎么知道」",
    outline: "一、研究背景\n新时代对高校人才培养提出了更高要求，课程思政作为落实立德树人的重要途径，在各类课程中的融入方式仍有待探索。目前不少课程存在融入生硬、与专业内容脱节的现象。\n二、研究问题\n如何在本科专业课程中实现课程思政元素与专业知识的有机融合？\n三、研究内容\n1. 分析课程思政融入专业课程的现实困境。\n2. 探讨融合的基本原则与实施路径。\n3. 总结若干可推广的经验做法。\n四、研究方法\n本研究拟采用文献研究法，结合日常教学中的经验总结与反思，逐步形成认识。\n五、预期成果\n形成一套课程思政融入专业课程的实施建议，为同类课程提供参考。",
    payload: {
      "claims": [
        {
          "id": "c1",
          "text": "目前不少课程存在融入生硬、与专业内容脱节的现象。",
          "type": "problem",
          "location": "研究背景 第 1 段",
          "overlap": 83,
          "defensibility": 14
        },
        {
          "id": "c2",
          "text": "如何在本科专业课程中实现课程思政元素与专业知识的有机融合？",
          "type": "problem",
          "location": "研究问题",
          "overlap": 72,
          "defensibility": 12
        },
        {
          "id": "c3",
          "text": "分析课程思政融入专业课程的现实困境。",
          "type": "method",
          "location": "研究内容 第 1 条",
          "overlap": 82,
          "defensibility": 22
        },
        {
          "id": "c4",
          "text": "探讨融合的基本原则与实施路径。",
          "type": "method",
          "location": "研究内容 第 2 条",
          "overlap": 76,
          "defensibility": 2
        },
        {
          "id": "c5",
          "text": "总结若干可推广的经验做法。",
          "type": "method",
          "location": "研究内容 第 3 条",
          "overlap": 82,
          "defensibility": 8
        },
        {
          "id": "c6",
          "text": "本研究拟采用文献研究法，结合日常教学中的经验总结与反思，逐步形成认识。",
          "type": "method",
          "location": "研究方法",
          "overlap": 64,
          "defensibility": 16
        },
        {
          "id": "c7",
          "text": "形成一套课程思政融入专业课程的实施建议，为同类课程提供参考。",
          "type": "expectation",
          "location": "预期成果",
          "overlap": 82,
          "defensibility": 21
        }
      ],
      "questions": [
        {
          "id": "q1",
          "claimId": "c1",
          "question": "你说「不少课程存在融入生硬、与专业内容脱节」，这个判断是你自己课堂观察得出的，还是有调查数据？样本是哪些课程、多少人？",
          "why": "这是整份研究的立论起点——如果「问题普遍存在」只是凭印象说的，后面所有困境分析、路径设计都建在沙子上。老师一定会追问证据来源，答不上来等于承认问题是被预设出来的。",
          "checklist": [
            "能说出证据的具体来源（如某次问卷、访谈、听课记录），并给出样本量和时间",
            "能区分「我观察到的」和「文献里报告的」，不把两者混为一谈",
            "如果确实没有系统调查，能坦承这是经验判断，并说明开题后会补一个小范围调查来支撑"
          ],
          "risk": 95
        },
        {
          "id": "q2",
          "claimId": "c1",
          "question": "「融入生硬」和「与专业内容脱节」是两回事，你打算用哪个作为要解决的核心问题？还是说这两个在你看来是同一个毛病？",
          "why": "这两个表述指向不同的病因：前者是教学方法问题，后者是内容设计问题，对应的路径完全不同。如果作者没想清楚，后面的「融合原则」会同时想治两种病，结果哪个都没说透。",
          "checklist": [
            "能明确说出自己主要针对的是哪一个，并解释为什么它更关键",
            "能举一个具体课程例子说明「生硬」和「脱节」在该课程中分别长什么样",
            "如果坚持两者都谈，能说清它们之间的因果关系（是脱节导致生硬，还是反过来）"
          ],
          "risk": 55
        },
        {
          "id": "q3",
          "claimId": "c2",
          "question": "你说要解决「有机融合」的问题，那你能不能先举一个你自己课上「无机融合」的具体例子——哪门课、哪个知识点、你当时怎么讲的、学生什么反应？",
          "why": "这条主张把「融入生硬、与专业内容脱节」当成既定前提，但整份提纲里没有任何一处给出这个判断的来源。老师问这个，是想看你到底是从自己的课堂里真的观察到了这个问题，还是从文件和政策话语里反推出来的。如果你举不出一个具体的、带细节的失败案例，说明这个问题是你「以为存在」的，不是「看见存在」的，整个研究的起点就是空的。",
          "checklist": [
            "能说出至少一个自己亲历的具体教学片段：课程名、章节、思政元素、当时的设计意图",
            "能说清「生硬」体现在哪里——是学生没反应、是提问冷场、还是作业里看出没消化",
            "能承认这个例子是个人经验，而不是把它包装成普遍现象"
          ],
          "risk": 95
        },
        {
          "id": "q4",
          "claimId": "c2",
          "question": "「有机融合」和「无机融合」的界线到底在哪？你能不能给一个判断标准，让别的老师听完也能判断自己那节课是有机还是无机？",
          "why": "你的研究问题整个建立在「有机/无机」这个二分上，但这两个词在提纲里从头到尾没有被定义过。老师会追这个，因为如果连你自己都说不清界线在哪，后面所谓的「实施路径」和「经验做法」就没有靶子——你没法证明你的方案是往「有机」那头走的。这一条答不上来，研究问题本身就不成立。",
          "checklist": [
            "能给出一个可操作的判断维度，比如「思政元素是否由专业内容本身逻辑地引出」而不是「课后附加一段话」",
            "能用一个正例和一个反例把这条标准演示一遍",
            "能说明这个标准是从哪里来的——文献、课堂观察还是同行讨论，而不是当场编的"
          ],
          "risk": 95
        },
        {
          "id": "q5",
          "claimId": "c3",
          "question": "你说要「分析现实困境」，那这些困境是从哪来的？是你自己课上观察到的，还是有调查数据？样本是几门课、多少位老师？",
          "why": "这条是整个研究的事实基础。如果困境只是凭印象或文献转述，后面所有「原则」「路径」「经验」都建在沙子上，老师会直接质疑整篇论文的立论依据。",
          "checklist": [
            "能说清困境来源：是问卷调查、访谈、课堂观察还是文献归纳，并给出具体数量（几门课、几位教师、多少份样本）",
            "能举出至少一个自己教学中的具体案例，说明这个困境是怎么表现出来的，而不是复述「融入生硬」这种笼统说法",
            "如果确实没有一手数据，能坦白说明并解释为什么文献归纳加经验反思足以支撑「分析困境」这一步"
          ],
          "risk": 95
        },
        {
          "id": "q6",
          "claimId": "c3",
          "question": "你列的困境里，哪些是课程思政特有的，哪些其实是任何教学内容融入都会有的通病？你怎么把这两类分开？",
          "why": "老师会担心你把「专业课难教」「学生不感兴趣」这类普遍问题也算成课程思政的困境，导致分析没有针对性。答不上来，说明你还没想清楚这门研究到底要解决什么特殊问题。",
          "checklist": [
            "能指出至少一条只在课程思政融入时才会出现的困境（比如价值引导与知识逻辑的冲突），并说明它为什么不是一般教学问题",
            "能承认有些困境是共通的，并说明你在论文里会怎么处理这部分（剔除、单列还是转化视角）",
            "能解释区分这两类对你后续提「融合原则」有什么实际影响"
          ],
          "risk": 55
        },
        {
          "id": "q7",
          "claimId": "c4",
          "question": "你这条写的是「探讨基本原则与实施路径」，可研究方法只有文献法加个人教学反思——没有课堂实施、没有对照、没有学生反馈，那这个「路径」凭什么说它可行？",
          "why": "这是整份开题最要命的地方：路径是要拿去用的，但你没有任何实践或验证环节，最后只能停在「我认为应该这样融」。老师一听就会追问「你凭什么说这条路走得通」，答不上来这条研究内容就等于空转，甚至会被要求补一轮教学实践再开题。",
          "checklist": [
            "能说清「路径」的产出形式：是几条原则性表述，还是可操作到某一节课某一环节的设计方案",
            "能指出路径中至少一个环节有文献之外的依据（如已有课例、他人实践报告、自己的前期尝试），并说明依据来源",
            "如果确实不做实践验证，能主动把主张收窄为「提出待验证的融合框架」，而不是「实施路径」"
          ],
          "risk": 95
        },
        {
          "id": "q8",
          "claimId": "c4",
          "question": "「基本原则」和「实施路径」是两样东西，你打算怎么从原则推到路径？中间那一步靠什么？",
          "why": "原则好写，路径难产。老师会盯这一步，因为如果原则和路径之间只是「因此应当……」的思辨跳跃，那所谓路径就是原则换了个说法。答不上来会暴露研究内容第 2 条其实是两条内容硬拼在一起，没有内在逻辑。",
          "checklist": [
            "能举一个具体例子：某条原则如何落到某门课某个教学环节的具体做法上",
            "能说明路径的每一条都能回溯到前面某条原则，不是另起炉灶",
            "能承认哪些原则目前推不出可操作路径，并说明原因"
          ],
          "risk": 75
        },
        {
          "id": "q9",
          "claimId": "c5",
          "question": "你说要总结「可推广」的经验做法，那你的经验是从哪门课、几个班、几轮教学里来的？推广到别的课程或别的老师那里，凭什么说它还成立？",
          "why": "「可推广」是这条主张的核心词，但你的研究方法只有文献研究加个人教学反思，等于推广性没有任何外部检验。老师一问就会发现：样本是你自己的一门课，推广范围却声称是「同类课程」，中间缺了验证环节。答不上来，这条预期成果就得降格成「个人经验总结」。",
          "checklist": [
            "能说清经验来源的具体范围：哪门课、几个教学班、几轮实施、覆盖多少学生",
            "能指出至少一个「可推广」的边界条件，比如适用于什么类型的课程、对教师有什么前提要求",
            "能承认这是基于单点经验的初步提炼，并说明后续需要什么检验才能称得上可推广"
          ],
          "risk": 75
        },
        {
          "id": "q10",
          "claimId": "c5",
          "question": "你打算怎么判断某条做法是「有效经验」而不是「你自己觉得顺手」？有没有任何学生端或同行端的证据？",
          "why": "这条主张默认了你的做法是有效的，但研究方法里没有任何效果检验的设计。老师会追：经验做法的筛选标准是什么，谁来判断它值得推广。答不上来，所谓「总结」就只是罗列做法，不构成研究结论。",
          "checklist": [
            "能说出筛选经验做法的具体依据，比如学生反馈、同行听课评价、作业或课堂表现的变化",
            "能举出一个具体例子，说明某条做法有可指认的效果证据而非主观感受",
            "能说明在没有对照设计的情况下，如何避免把「自然变好」误归因为自己的做法"
          ],
          "risk": 55
        },
        {
          "id": "q11",
          "claimId": "c6",
          "question": "你的研究问题问的是「如何实现有机融合」，可方法只有文献加个人经验反思——那你怎么判断一种融合方式是真的「有机」还是你自我感觉良好？有没有任何来自学生或课堂的实证材料能支撑这个判断？",
          "why": "这是整份开题最致命的错位：研究问题要的是「怎么做才有效」，方法却只能产出「我认为应该怎么做」。文献能告诉你别人写过什么，经验反思只能证明你个人这么做过，两者都无法回答「融合是否真的成立」。老师一问就会发现，你的预期成果「实施建议」其实没有任何证据链支撑，等于把一篇经验总结包装成了研究。",
          "checklist": [
            "能说清除了文献和反思之外，至少还有一种能产生新证据的手段（如学生问卷、课堂观察记录、学生作业/反思文本分析、同行听课评议），并说明它怎么回答「有机融合」这个问题",
            "能给出「有机融合」的可观察判断标准，比如学生能否在专业内容讨论中自发引用价值维度，而不是只写「融入自然、不生硬」",
            "如果坚持只用文献+反思，能承认这是经验总结型研究并主动收窄研究问题的表述，而不是硬撑「有机融合」的因果判断"
          ],
          "risk": 95
        },
        {
          "id": "q12",
          "claimId": "c6",
          "question": "「日常教学中的经验总结与反思」——你打算反思的是哪几门课、哪几届学生、哪些具体课堂事件？这些材料现在手上有记录吗，还是答辩后回去凭回忆补？",
          "why": "经验反思法最容易被追问的就是材料从哪来。如果作者说不出具体是哪门课、哪一届、哪些可追溯的课堂记录，那「经验总结」就只是印象，老师会直接质疑这部分材料的可信度，进而质疑整篇论文的证据基础。这个问题答不好，方案里「经验反思」这一半就得推倒重来。",
          "checklist": [
            "能点名具体课程名称、授课学期、学生年级与大致人数，说明这些经验来自可界定的教学情境",
            "能说出至少 2-3 个具体的课堂事件或教学片段（哪次课、什么内容、学生什么反应），而不是笼统说「多年教学经验」",
            "能说明这些经验材料以什么形式留存（教案、教学日志、学生反馈、听课记录），并承认回忆性材料的局限"
          ],
          "risk": 75
        },
        {
          "id": "q13",
          "claimId": "c7",
          "question": "你说要形成一套「实施建议」，这套建议和你前面说的「经验总结与反思」有什么区别？如果只是把你自己的做法写下来，别人凭什么拿去参考？",
          "why": "这条预期成果的落脚点是「可推广」，但研究方法只有文献加个人经验，没有对照、没有多校验证。老师会追问：你产出的到底是研究结论，还是个人工作总结？答不上来，整个研究的「研究性」就被否定了。",
          "checklist": [
            "能说清这套建议里哪几条来自文献分析、哪几条来自个人实践，并说明两者怎么互相印证",
            "能举出至少一个具体做法，并解释它为什么在别的课程、别的学校也成立，而不是只在你班上有效",
            "承认推广范围有限，明确写出适用条件（课程类型、学生层次、教师投入），而不是笼统说「为同类课程提供参考」"
          ],
          "risk": 95
        },
        {
          "id": "q14",
          "claimId": "c7",
          "question": "「为同类课程提供参考」——你怎么判断这套建议真的有用？有没有任何检验环节，还是写完就结束了？",
          "why": "预期成果没有任何验证设计，老师会问：建议好不好，谁来判定？如果答不出检验方式，这条预期就不可证伪，等于什么都没承诺。",
          "checklist": [
            "能说出至少一种检验方式，比如在另一门课试用一轮、请同行教师评阅、收集学生反馈",
            "能明确什么情况下算这套建议「没起作用」，而不是只准备成功案例",
            "能说清检验的范围和时间，不夸大成「经过实证检验」"
          ],
          "risk": 75
        }
      ],
      "warnings": [],
      "usage": {
        "promptTokens": 20402,
        "completionTokens": 3602,
        "totalTokens": 24004,
        "calls": 15
      },
      "costYuan": 0.0348,
      "model": "deepseek-chat",
      "scoresArePlaceholder": false,
      "blindClaimIds": [],
      "manualRefCount": 0,
      "manualRefsEnabled": true,
      "evidence": [
        {
          "claimId": "c1",
          "score": 21,
          "reason": "这条主张只有结论，没有依据 —— 有没有数字都没交代。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 0,
              "hits": []
            },
            {
              "name": "有没有方法",
              "score": 15,
              "hits": [
                "提纲里有：分析"
              ]
            },
            {
              "name": "有没有出处",
              "score": 25,
              "hits": [
                "提纲里有：文献"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 70,
              "hits": [
                "课程",
                "专业"
              ]
            }
          ]
        },
        {
          "claimId": "c2",
          "score": 21,
          "reason": "这条主张只有结论，没有依据 —— 有没有数字都没交代。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 0,
              "hits": []
            },
            {
              "name": "有没有方法",
              "score": 15,
              "hits": [
                "提纲里有：分析"
              ]
            },
            {
              "name": "有没有出处",
              "score": 25,
              "hits": [
                "提纲里有：文献"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 70,
              "hits": [
                "课程",
                "专业"
              ]
            }
          ]
        },
        {
          "claimId": "c3",
          "score": 26,
          "reason": "这条主张只有结论，没有依据 —— 有没有数字都没交代。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 0,
              "hits": []
            },
            {
              "name": "有没有方法",
              "score": 30,
              "hits": [
                "分析"
              ]
            },
            {
              "name": "有没有出处",
              "score": 25,
              "hits": [
                "提纲里有：文献"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 70,
              "hits": [
                "课程",
                "专业"
              ]
            }
          ]
        },
        {
          "claimId": "c4",
          "score": 11,
          "reason": "这条主张只有结论，没有依据 —— 有没有数字、说得具体吗都没交代。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 0,
              "hits": []
            },
            {
              "name": "有没有方法",
              "score": 15,
              "hits": [
                "提纲里有：分析"
              ]
            },
            {
              "name": "有没有出处",
              "score": 25,
              "hits": [
                "提纲里有：文献"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 0,
              "hits": []
            }
          ]
        },
        {
          "claimId": "c5",
          "score": 11,
          "reason": "这条主张只有结论，没有依据 —— 有没有数字、说得具体吗都没交代。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 0,
              "hits": []
            },
            {
              "name": "有没有方法",
              "score": 15,
              "hits": [
                "提纲里有：分析"
              ]
            },
            {
              "name": "有没有出处",
              "score": 25,
              "hits": [
                "提纲里有：文献"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 0,
              "hits": []
            }
          ]
        },
        {
          "claimId": "c6",
          "score": 23,
          "reason": "这条主张只有结论，没有依据 —— 有没有数字都没交代。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 0,
              "hits": []
            },
            {
              "name": "有没有方法",
              "score": 15,
              "hits": [
                "提纲里有：分析"
              ]
            },
            {
              "name": "有没有出处",
              "score": 50,
              "hits": [
                "文献"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 40,
              "hits": [
                "（句子够长）"
              ]
            }
          ]
        },
        {
          "claimId": "c7",
          "score": 26,
          "reason": "这条主张只有结论，没有依据 —— 有没有数字都没交代。",
          "dimensions": [
            {
              "name": "有没有数字",
              "score": 0,
              "hits": []
            },
            {
              "name": "有没有方法",
              "score": 15,
              "hits": [
                "提纲里有：分析"
              ]
            },
            {
              "name": "有没有出处",
              "score": 25,
              "hits": [
                "提纲里有：文献"
              ]
            },
            {
              "name": "说得具体吗",
              "score": 100,
              "hits": [
                "课程",
                "专业",
                "（句子够长）"
              ]
            }
          ]
        }
      ],
      "search": [
        {
          "claimId": "c1",
          "trustworthy": true,
          "score": 83,
          "reason": "撞车了。2024 年《International Education Forum》「Research on the Integration of Swimming Course…」跟你这条几乎是一回事，5 篇都对得上。这条主张得换个角度，或者明确说清你比它多做的是什么。",
          "totalHits": 5,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 5,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.26689/ief.v2i8.8328",
            "title": "Research on the Integration of Swimming Courses and Ideological and Political Education in Colleges and Universities from the Perspective of “Curriculum Ideology and Politics”",
            "year": "2024",
            "authors": [
              "Zhi Xing"
            ],
            "venue": "International Education Forum",
            "url": "https://doi.org/10.26689/ief.v2i8.8328"
          },
          "matched": [
            "curriculum",
            "ideology",
            "ideological",
            "education",
            "cours",
            "integration"
          ],
          "webStatus": "off",
          "webHitCount": 0,
          "manualHitCount": 0
        },
        {
          "claimId": "c2",
          "trustworthy": true,
          "score": 72,
          "reason": "撞车了。2026 年「Implementation paths and effectiveness evaluat…」跟你这条几乎是一回事，5 篇都对得上。这条主张得换个角度，或者明确说清你比它多做的是什么。",
          "totalHits": 5,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 5,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.37766/inplasy2026.3.0041",
            "title": "Implementation paths and effectiveness evaluation of \"Curriculum Ideology and Politics\" in professional courses of higher vocational colleges under the background of industry-education integration: A systematic review",
            "year": "2026",
            "authors": [
              "Jingshu He",
              "Huale Song"
            ],
            "venue": "",
            "url": "https://doi.org/10.37766/inplasy2026.3.0041"
          },
          "matched": [
            "curriculum",
            "ideology",
            "education",
            "professional",
            "cours",
            "integration"
          ],
          "webStatus": "off",
          "webHitCount": 0,
          "manualHitCount": 0
        },
        {
          "claimId": "c3",
          "trustworthy": true,
          "score": 82,
          "reason": "撞车了。2026 年「Implementation paths and effectiveness evaluat…」跟你这条几乎是一回事，5 篇都对得上。这条主张得换个角度，或者明确说清你比它多做的是什么。",
          "totalHits": 5,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 5,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.37766/inplasy2026.3.0041",
            "title": "Implementation paths and effectiveness evaluation of \"Curriculum Ideology and Politics\" in professional courses of higher vocational colleges under the background of industry-education integration: A systematic review",
            "year": "2026",
            "authors": [
              "Jingshu He",
              "Huale Song"
            ],
            "venue": "",
            "url": "https://doi.org/10.37766/inplasy2026.3.0041"
          },
          "matched": [
            "curriculum",
            "ideology",
            "education",
            "professional",
            "cours",
            "integration",
            "higher"
          ],
          "webStatus": "off",
          "webHitCount": 0,
          "manualHitCount": 0
        },
        {
          "claimId": "c4",
          "trustworthy": true,
          "score": 76,
          "reason": "撞车了。2023 年《Education Journal》「Research on the Integration Path of Gymnastics…」跟你这条几乎是一回事，5 篇都对得上。这条主张得换个角度，或者明确说清你比它多做的是什么。",
          "totalHits": 5,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 5,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.31058/j.edu.2023.69020",
            "title": "Research on the Integration Path of Gymnastics Curriculum and Ideological and Political Education from the Perspective of Curriculum Ideology",
            "year": "2023",
            "authors": [
              "Maiqing Zhou"
            ],
            "venue": "Education Journal",
            "url": "https://doi.org/10.31058/j.edu.2023.69020"
          },
          "matched": [
            "curriculum",
            "ideology",
            "ideological",
            "education",
            "integration"
          ],
          "webStatus": "off",
          "webHitCount": 0,
          "manualHitCount": 0
        },
        {
          "claimId": "c5",
          "trustworthy": true,
          "score": 82,
          "reason": "撞车了。2025 年《Education Reform and Development》「Research on the Teaching Reform of Curriculum …」跟你这条几乎是一回事，4 篇都对得上。这条主张得换个角度，或者明确说清你比它多做的是什么。",
          "totalHits": 5,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 5,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.26689/erd.v7i11.13096",
            "title": "Research on the Teaching Reform of Curriculum Ideological and Political Education in Higher Vocational Colleges from the Perspective of Industry-Education Integration and Digital Empowerment",
            "year": "2025",
            "authors": [
              "Zhao Wang"
            ],
            "venue": "Education Reform and Development",
            "url": "https://doi.org/10.26689/erd.v7i11.13096"
          },
          "matched": [
            "curriculum",
            "ideological",
            "education",
            "integration",
            "teach",
            "reform"
          ],
          "webStatus": "off",
          "webHitCount": 0,
          "manualHitCount": 0
        },
        {
          "claimId": "c6",
          "trustworthy": true,
          "score": 64,
          "reason": "有重合。最像的是2024 年「Research on Curriculum Design and Teaching Str…」，5 篇沾边。别人做过相邻的事，但没做到你这个位置 —— 答辩时要把\"我跟它差在哪\"讲清楚。",
          "totalHits": 5,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 5,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.62517/jhet.202415604",
            "title": "Research on Curriculum Design and Teaching Strategies of Ideological and Political Education in Vocational Colleges",
            "year": "2024",
            "authors": [
              "Liu Dan"
            ],
            "venue": "Journal of Higher Education Teaching",
            "url": "https://doi.org/10.62517/jhet.202415604"
          },
          "matched": [
            "curriculum",
            "ideological",
            "education",
            "teach",
            "higher"
          ],
          "webStatus": "off",
          "webHitCount": 0,
          "manualHitCount": 0
        },
        {
          "claimId": "c7",
          "trustworthy": true,
          "score": 82,
          "reason": "撞车了。2026 年「Implementation paths and effectiveness evaluat…」跟你这条几乎是一回事，5 篇都对得上。这条主张得换个角度，或者明确说清你比它多做的是什么。",
          "totalHits": 5,
          "sources": [
            {
              "name": "arXiv",
              "answered": true,
              "hitCount": 0,
              "error": ""
            },
            {
              "name": "Crossref",
              "answered": true,
              "hitCount": 5,
              "error": ""
            }
          ],
          "bestHit": {
            "source": "crossref",
            "key": "doi:10.37766/inplasy2026.3.0041",
            "title": "Implementation paths and effectiveness evaluation of \"Curriculum Ideology and Politics\" in professional courses of higher vocational colleges under the background of industry-education integration: A systematic review",
            "year": "2026",
            "authors": [
              "Jingshu He",
              "Huale Song"
            ],
            "venue": "",
            "url": "https://doi.org/10.37766/inplasy2026.3.0041"
          },
          "matched": [
            "curriculum",
            "ideology",
            "education",
            "professional",
            "cours",
            "integration",
            "higher"
          ],
          "webStatus": "off",
          "webHitCount": 0,
          "manualHitCount": 0
        }
      ],
      "elapsedMs": 28418
    },
  },
];

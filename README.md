# 预答辩 · Pre-Defense

[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

> 在你还能改的时候，告诉你哪儿会被问倒。

粘贴一份论文开题提纲，60 秒后拿到两份东西：

1. **软肋地图** —— 一张四象限散点图。每个点是一条主张，横轴是"这个想法别人做过吗"（越高越像），纵轴是"这条主张你答得上来吗"（越高越稳）。落在"别人做过 + 你答不上来"那个角的，就是最该改的。
2. **质询问题清单** —— 按答不上来的概率排序，每条问题带一个"为什么问这个"和一个"及格线清单"。

## 为什么做这个

开题是唯一"改了还来得及"的时刻。市面上的查重工具到答辩前才告诉你重复，那时候改不了了。

这个项目做的不是查重，是在你还能改的时候告诉你哪儿会被问倒。

## 技术栈

| 选择 | 理由 |
| --- | --- |
| Next.js 15 App Router + TypeScript | 一个进程同时管页面和 API，不需要前后端分离 |
| 不引 Tailwind，样式全写在 `app/globals.css` | 少一层构建配置就少一个能崩的地方 |
| 不引图表库，散点图手写 div 定位 | 引库要多 300KB，而这里只有十来个点 |
| DeepSeek API，直接 fetch 不用 SDK | 一次请求而已，不值得多一个依赖 |
| zod 校验每层输出 | 模型返回的 JSON 会飘，飘了要能当场抓住 |
| 不引向量库、不做 RAG | 主张只有几条到十几条，暴力比对足够，可解释性更好 |

## 架构

```
L1 抽取：提纲文本 → 主张数组（原文片段、类型、位置）
├─ L2-A 检索意图翻译：中文主张 → 英文学术检索词
└─ L2-B 质询生成：每条主张 → 1-2 个问题 + 及格线
L3 组装：纯代码，不调模型，算四象限、拼报告
```

**为什么不合成一个大 prompt**：试过。改一句话整个输出格式就崩，而且没法定位是哪一步坏的。拆开以后每层只做一件事，坏了能一眼看出是哪层。另外四象限是纯算术，让模型算它两次能给两个答案，用代码算永远一样。

## 本地运行

需要 Node.js 18.18 以上（本项目在 Node 24 上开发）。

```bash
npm install
npm run dev
```

打开 <http://localhost:3000>。

生产构建：

```bash
npm run build
npm start
```

## 环境变量

必需。在项目根目录建 `.env.local`（**此文件已被 `.gitignore` 忽略，永远不要提交**）：

```
DEEPSEEK_API_KEY=sk-你的key
```

只有这一个变量是必需的。没配也能打开页面、能输入，点「开始诊断」时会直接告诉你缺什么，不会静默失败。

## 目录结构

```
pre-defense/
├─ app/
│  ├─ layout.tsx              根布局
│  ├─ page.tsx                首页：输入提纲、渲染报告
│  ├─ globals.css             全部样式（含深色模式与打印样式）
│  └─ api/
│     ├─ analyze/route.ts     主接口：抽取 → 质询 + 检索 → 组装
│     ├─ health/route.ts      体检：key 配没配（不回传 key 本身）
│     └─ dev-info/route.ts    调试面板用：版本、路由表
├─ components/
│  ├─ SoftSpotMap.tsx         软肋地图（手写 div 散点图）
│  ├─ ClaimTable.tsx          主张明细表
│  ├─ QuestionList.tsx        质询问题清单
│  ├─ HomeGround.tsx          「你的主场」
│  └─ DebugPanel.tsx          开发期中文调试面板（生产环境不渲染）
├─ lib/
│  ├─ types.ts                主张 / 问题的数据结构
│  ├─ schema.ts               zod 校验，每层输出都过一遍
│  ├─ parse.ts                从模型返回的脏文本里抠 JSON
│  ├─ prompts.ts              两段 system prompt 与消息组装
│  ├─ deepseek.ts             DeepSeek 客户端（fetch，不用 SDK）
│  ├─ extract.ts              L1 抽取：提纲 → 主张数组
│  ├─ question.ts             L2-B 质询生成
│  ├─ retrieval.ts            L2-A 检索意图翻译
│  ├─ arxiv.ts                arXiv 检索（免费无 key）
│  ├─ crossref.ts             Crossref 检索（免费无 key）
│  ├─ websearch.ts            DeepSeek 搜索补中文库（可选）
│  ├─ similarity.ts           相似度打分（纯代码）
│  ├─ overlap.ts              多源结果合并与理由生成
│  ├─ search.ts               检索总调度，一个库挂了不影响其他
│  ├─ evidence.ts             纵轴：提纲自己有没有证据
│  ├─ quadrant.ts             四象限判定
│  ├─ manual.ts               手工粘贴中文文献的解析
│  ├─ config.ts               站长开关
│  └─ mock.ts                 早期假数据，现在没有任何地方引用它
├─ scripts/                   自检脚本，每个模块一个，共 12 个
├─ plan.md                    实施计划与逐步进度记录
├─ plan.local.md              更详细的踩坑笔记（不进 git）
└─ README.md                  本文件
```

## 当前进度

**六层链路已全部跑通，可以真用。**

| 层 | 状态 |
| --- | --- |
| L1 抽取：提纲 → 主张数组 | 完成 |
| L2-A 检索意图翻译：中文主张 → 英文检索词 | 完成 |
| L2-B 质询生成：每条主张 → 1-2 个问题 + 及格线 | 完成 |
| 检索：arXiv + Crossref（+ DeepSeek 搜索可选、手工文献可选） | 完成 |
| L3 组装：四象限、主场、报告（纯代码，不调模型） | 完成 |
| 界面：散点图、主张表、问题清单、打印成 PDF、深色模式 | 完成 |

真模型实测（2026-10-20，一份 320 字的中职短视频教学提纲）：

- 7 条主张、14 个质询问题、15 次模型调用
- 24,778 token，**0.0355 元**，**30.6 秒**出结果
- 七个点的横轴分数 43–73、纵轴 0–57，没有压在同一条线上

剩下的事：`plan.md` 阶段六里没打勾的三项。

逐步的进度记录（每一步为什么这么做、踩了什么坑）见 [plan.md](./plan.md) 末尾的「进度记录」。

## 许可证

本项目采用 CC BY-NC-SA 4.0 许可证。查看 [LICENSE](./LICENSE) 文件或访问 [creativecommons.org](https://creativecommons.org/licenses/by-nc-sa/4.0/) 了解详情。

简单说三件事：

- **署名**：用的时候要注明出处。
- **非商业**：不能拿去卖钱。
- **相同方式共享**：你改过的版本，也要用同样的许可证开放出来。

## 比赛

第九届传智杯「Vibe Coding 全栈速成赛」个人赛参赛作品。

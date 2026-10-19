/**
 * GET /api/health —— 只检查"key 配了没有"，不调模型，不花钱。
 *
 * 为什么单独做一个接口：
 * 第 5 步开始要花真钱了（一次分析约 1.7 分钱）。如果 key 没配好，
 * 直接点按钮调模型会得到一个 401，你还得猜是网络问题、key 问题还是代码问题。
 * 先把"key 在不在"这件事单独验证掉，后面出错就只剩一种可能。
 *
 * 安全边界：这个接口永远不返回 key 本身，只返回长度。
 * 长度足够判断"填了没填"和"是不是少复制了几位"，泄露不了内容。
 */

import { NextResponse } from "next/server";

/** DeepSeek 的 key 是 sk- 开头，35 个字符左右。 */
const KEY_PREFIX = "sk-";
const KEY_EXPECTED_LENGTH = 35;

export async function GET() {
  /**
   * 注意：这里读的是服务端环境变量。
   * Next.js 只在服务端（route.ts、server component）读得到 .env.local，
   * 客户端组件里 process.env.DEEPSEEK_API_KEY 永远是 undefined —— 这是好事，
   * 说明 key 不会被打包进浏览器能看到的 JS 里。
   */
  const raw = process.env.DEEPSEEK_API_KEY ?? "";
  const key = raw.trim();

  const configured = key.length > 0;

  /**
   * 常见的手滑：复制时带了引号、带了空格、复制少了几位。
   * 这些错误如果等到调模型时才暴露，报错信息是 401 Unauthorized，
   * 根本看不出是"多了个引号"这么简单的原因。
   */
  const warnings: string[] = [];
  if (configured) {
    if (key.startsWith('"') || key.startsWith("'")) {
      warnings.push("key 开头带了引号，复制的时候把引号也带进去了");
    }
    if (/\s/.test(key)) {
      warnings.push("key 中间有空格或换行，可能复制时断行了");
    }
    if (!key.startsWith(KEY_PREFIX)) {
      warnings.push(`key 不是 ${KEY_PREFIX} 开头，可能复制错了东西`);
    }
    if (key.length !== KEY_EXPECTED_LENGTH) {
      warnings.push(
        `key 长度是 ${key.length}，通常应该是 ${KEY_EXPECTED_LENGTH} 左右，可能少复制或多复制了`,
      );
    }
  }

  return NextResponse.json({
    keyConfigured: configured,
    keyLength: key.length,
    warnings,
    /** 下一步要用的模型名，先在这里固定住，免得后面两处写不一样。 */
    model: "deepseek-chat",
  });
}

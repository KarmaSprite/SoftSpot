import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
    关掉开发模式左下角那个 "Open Next.js Dev Tools" 按钮。
    它的文案写死在 Next.js 的 bundle 里，没有语言配置项，只能留或关。
    我们改用自己写的 components/DebugPanel.tsx，中文，而且能查 key 状态。

    注意：这个开关不影响红色的错误浮层，两者是独立的两套东西。
    实测过，关掉之后页面里 throw new Error 依然会弹浮层。
  */
  devIndicators: false,
};

export default nextConfig;

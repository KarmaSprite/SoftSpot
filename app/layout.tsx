import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import DebugPanel from "@/components/DebugPanel";
import { THEME_STORAGE_KEY } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/*
  title 是浏览器标签上那行字，description 是搜索结果和分享卡片里的那两行。

  为什么 description 里没有那句「在你还能改的时候，告诉你哪儿会被问倒」：
  slogan 该出现在读者还不知道这是什么的地方（README 首屏、文档封面、视频第一帧），
  那里放一句有情绪的话才起作用。标签页和搜索结果里该回答的是
  「这东西是什么、给我什么」—— 读者连产品在诊断什么都没看到，
  先读到一句口号只会划过去。
*/
export const metadata: Metadata = {
  title: "软肋 · 论文预诊断答辩",
  description: "贴上论文提纲，给你一张软肋地图和一份质询清单。",
};

/**
 * 防闪白脚本。
 *
 * 要解决的问题：主题存在 localStorage 里，而 localStorage 只有浏览器才读得到。
 * 如果等 React 水合完再切主题，深色模式的用户每次打开页面都会先看到
 * 一帧白底，然后"啪"一下变黑 —— 这叫 FOUC（flash of unstyled content）。
 *
 * 为什么写成字符串塞进 <head>：
 * 这段代码必须在水合之前、在浏览器画出第一帧之前跑完。
 * 写成普通组件或者 useEffect 都太晚了，只有 <script> 是同步执行的。
 *
 * 为什么用 dangerouslySetInnerHTML：
 * 内容是我们自己写死的常量，不含任何用户输入，没有注入风险。
 * 另外 theme.ts 里的常量在这里通过模板字符串拼进去，
 * 键名只有一处定义，不会出现"存的时候叫 A、读的时候叫 B"。
 */
const themeScript = `
(function () {
  try {
    var saved = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    /*
      suppressHydrationWarning 不能省：
      上面那段脚本会在水合之前给 <html> 加 data-theme 属性，
      服务端渲染出来的 HTML 里没有这个属性，React 会认为两边对不上并报警告。
      这个属性只影响 <html> 这一层，不会掩盖子组件的真实差异。
    */
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
        {/* 放在 layout 而不是 page：将来加了别的页面，调试面板自动都在 */}
        <DebugPanel />
      </body>
    </html>
  );
}

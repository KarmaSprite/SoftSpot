/**
 * 主题：浅色 / 深色 / 跟随系统。
 *
 * 为什么单独一个文件：
 * 有三处要用同一套规则 —— 布局里那段防闪白的同步脚本、调试面板里的三个按钮、
 * 以及将来可能加的快捷键。三处各写一遍，早晚会不一致（比如一处存 auto 一处存 system）。
 *
 * 为什么不在 CSS 里写两套变量：
 * globals.css 用的是 light-dark()，切换主题只需要改 <html> 的 color-scheme。
 * 这里负责的就是"改哪个开关"和"记住用户选了什么"。
 */

/** auto 表示不干预，交给操作系统。 */
export type ThemeMode = "auto" | "light" | "dark";

/** localStorage 的键名。改这里会同时改掉布局里那段脚本读的键。 */
export const THEME_STORAGE_KEY = "pre-defense-theme";

/** 面板上按钮的顺序：默认项放第一个。 */
export const THEME_MODES: ThemeMode[] = ["auto", "light", "dark"];

export const THEME_LABEL: Record<ThemeMode, string> = {
  auto: "自动",
  light: "浅色",
  dark: "深色",
};

/** 从 localStorage 读出来的东西是 any，先过一道判断再当 ThemeMode 用。 */
export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "auto" || value === "light" || value === "dark";
}

/**
 * 读用户上次的选择。读不到或者读出来是脏数据，一律当 auto。
 *
 * 为什么整段包 try/catch：
 * 隐私模式、被禁用的第三方存储、配额满了，localStorage 都可能直接抛异常。
 * 主题读不出来顶多是回退到跟随系统，不该让整个面板崩掉。
 */
export function readTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(saved) ? saved : "auto";
  } catch {
    return "auto";
  }
}

/**
 * 把主题落到 <html> 上。
 *
 * auto 是删掉属性而不是设成 "auto"：
 * globals.css 里只认 [data-theme="light"] 和 [data-theme="dark"] 两个选择器，
 * 没有属性时 color-scheme 就是 :root 上的 light dark，正好是跟随系统。
 */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;

  if (mode === "auto") {
    root.removeAttribute("data-theme");
    return;
  }

  root.setAttribute("data-theme", mode);
}

/** 记住选择。存不进去不影响这一次的显示效果，所以吞掉异常。 */
export function saveTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // 存不下就算了，下次打开回退到跟随系统
  }
}

/**
 * GET /api/dev-info —— 给调试面板提供"这台机器现在跑的是什么"。
 *
 * 为什么需要这个接口：
 * 原版 Next.js 调试按钮里有几项信息（渲染模式、打包器、路由树），
 * 那些信息只有服务端才知道 —— 浏览器里读不到 process.env，也读不到文件系统。
 * 所以必须开一个接口把它们送下来。
 *
 * 为什么只列路由文件、不列全部文件：
 * 这是给"我现在改的到底是哪个文件"用的。列出一堆 node_modules 只会更乱。
 *
 * 安全边界：只在开发模式返回内容。生产环境直接返回 404，
 * 免得部署出去之后被人拿这个接口当目录扫描器。
 */

import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** 一条路由：路径 + 这个路径下参与渲染的文件。 */
type RouteEntry = {
  path: string;
  files: string[];
};

/**
 * 递归找 app 目录下的路由文件。
 *
 * 只认这几种文件名，因为只有它们是"页面结构"的一部分：
 * page 决定这个路径能不能访问，layout 决定外面套什么壳，
 * route 是接口，loading / error / not-found 是几种特殊状态页。
 */
const ROUTE_FILE = /^(page|layout|route|loading|error|not-found)\.(tsx|ts|jsx|js)$/;

/**
 * 有些目录不是路由，是给代码分层的（components / lib / scripts）。
 * 它们就算放在 app 里也不该出现在路由树上，跳过。
 */
const SKIP_DIR = new Set(["components", "lib", "scripts", "node_modules", ".next"]);

async function walk(
  dir: string,
  /** 相对于 app 的路径，根目录是 "" */
  prefix: string,
  /** 收集结果：key 是路由路径，value 是文件名数组 */
  bucket: Map<string, string[]>,
): Promise<void> {
  let entries;

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // 目录不存在（比如有人把 app 改名了）不该让整个接口 500
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name)) continue;
      // 路由组 (group) 和私有目录 _folder 不改变 URL，但它们里面的 page 仍然算路由，
      // 所以照样往下走，只是在拼路径的时候跳过这一段。
      const isGroup = /^\(.+\)$/.test(entry.name) || entry.name.startsWith("_");
      const nextPrefix = isGroup
        ? prefix
        : prefix === ""
          ? entry.name
          : `${prefix}/${entry.name}`;
      await walk(path.join(dir, entry.name), nextPrefix, bucket);
      continue;
    }

    if (!ROUTE_FILE.test(entry.name)) continue;

    // 根目录的 page.tsx 就是 "/"，别的按目录拼
    const routePath = prefix === "" ? "/" : `/${prefix}`;
    const files = bucket.get(routePath) ?? [];
    files.push(entry.name);
    bucket.set(routePath, files);
  }
}

export async function GET() {
  // 生产环境直接当这个接口不存在
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const appDir = path.join(process.cwd(), "app");
  const bucket = new Map<string, string[]>();
  await walk(appDir, "", bucket);

  /**
   * 排序：短的路径放前面。
   * 这样 "/" 一定排第一，"/api/health" 排在 "/api" 后面，读起来像一棵树从上往下。
   */
  const routes: RouteEntry[] = [...bucket.entries()]
    .map(([routePath, files]) => ({
      path: routePath,
      // 固定顺序，免得每次刷新文件顺序都在变
      files: files.sort((a, b) => {
        const order = ["layout", "page", "loading", "error", "not-found", "route"];
        return order.indexOf(a.split(".")[0]) - order.indexOf(b.split(".")[0]);
      }),
    }))
    .sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));

  return NextResponse.json({
    nodeEnv: process.env.NODE_ENV ?? "unknown",
    /**
     * TURBOPACK 这个变量是 Next 15 在 dev --turbopack 时注入的。
     * 坑：源码里 process.env.TURBOPACK 会被构建时替换成布尔值 true，
     * 不是字符串 "1"。所以判断要写成 truthy，不能写 === "1"。
     */
    turbopack: Boolean(process.env.TURBOPACK),
    nextVersion: await readNextVersion(),
    nodeVersion: process.version,
    routes,
  });
}

/**
 * 版本号从 node_modules 里的 package.json 读。
 *
 * 为什么不读 process.env：Next 没有注入版本号的环境变量（实测 __NEXT_VERSION 是 undefined）。
 * 为什么不 import：next/package.json 不在 exports 白名单里，import 会直接报错。
 * 读文件是唯一不需要额外依赖的办法，而且这个接口只在开发模式跑，读一次文件无所谓。
 */
async function readNextVersion(): Promise<string> {
  try {
    const file = path.join(process.cwd(), "node_modules", "next", "package.json");
    const raw = await readFile(file, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

import type { Plugin } from "vite";
import { build } from "vite";
import { resolve } from "node:path";
import { addProjectWatchFiles } from "../watch-files.ts";

/**
 * Content scriptとMAIN worldの取得スクリプトを別々のIIFEにバンドルする．
 * Chrome の content scripts は ES module が使えないため，すべての依存を内包する必要がある．
 */
export function contentScriptPlugin(isDev: boolean, root: string): Plugin {
  const contentEntry = resolve(root, "src/content/index.ts");
  const pageEntry = resolve(root, "src/page/index.ts");
  let building = false;

  return {
    name: "content-script-iife",
    apply: "build",

    buildStart() {
      // Content scriptは別のVite buildで生成するため，依存ファイルを親のwatch graphへ追加する．
      addProjectWatchFiles(this, root);
    },

    writeBundle: {
      sequential: true,
      async handler() {
        if (building) return;
        building = true;
        try {
          for (const [name, entry] of [
            ["content", contentEntry],
            ["page", pageEntry],
          ]) {
            await build({
              configFile: false,
              logLevel: "info",
              publicDir: false,
              define: {
                "process.env.NODE_ENV": JSON.stringify(isDev ? "development" : "production"),
              },
              resolve: {
                alias: { src: resolve(root, "src") },
              },
              build: {
                outDir: resolve(root, "dist"),
                emptyOutDir: false,
                sourcemap: isDev ? "inline" : false,
                minify: isDev ? false : undefined,
                rollupOptions: {
                  input: entry,
                  output: { format: "iife", entryFileNames: `${name}.js` },
                },
              },
            });
          }
        } finally {
          building = false;
        }
      },
    },
  };
}

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

// テスト用サーバーはループバックにだけ公開する．ポート変更時も表示URLと配信先を一致させる．
const HOST = "127.0.0.1";
const PORT = 4178;
const ORIGIN = `http://${HOST}:${PORT}`;

const files = {
  "/": ["../tests/browser/index.html", "text/html; charset=utf-8"],
  "/fixture.js": ["../tests/browser/fixture.js", "text/javascript; charset=utf-8"],
  "/dist/content.js": ["../dist/content.js", "text/javascript; charset=utf-8"],
  "/dist/content.css": ["../dist/content.css", "text/css; charset=utf-8"],
};
createServer(async (request, response) => {
  const file = files[new URL(request.url, ORIGIN).pathname];
  if (!file) { response.writeHead(404).end(); return; }
  try {
    const data = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, { "content-type": file[1], "cache-control": "no-store" }).end(data);
  } catch { response.writeHead(500).end("Run npm run build first"); }
}).listen(PORT, HOST, () => console.log(`UI tests: ${ORIGIN}/`));

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const files = {
  "/": ["../tests/browser/index.html", "text/html; charset=utf-8"],
  "/fixture.js": ["../tests/browser/fixture.js", "text/javascript; charset=utf-8"],
  "/dist/content.js": ["../dist/content.js", "text/javascript; charset=utf-8"],
  "/dist/content.css": ["../dist/content.css", "text/css; charset=utf-8"],
};
createServer(async (request, response) => {
  const file = files[new URL(request.url, "http://127.0.0.1").pathname];
  if (!file) { response.writeHead(404).end(); return; }
  try {
    const data = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, { "content-type": file[1], "cache-control": "no-store" }).end(data);
  } catch { response.writeHead(500).end("Run npm run build first"); }
}).listen(4178, "127.0.0.1", () => console.log("UI tests: http://127.0.0.1:4178/"));

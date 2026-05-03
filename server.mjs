import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(import.meta.dirname);
const port = Number(process.env.PORT || 4173);

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = normalize(pathname === "/" ? "/index.html" : pathname);
  const absolutePath = resolve(join(root, requestedPath));

  if (!absolutePath.startsWith(root) || !existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": types[extname(absolutePath)] || "application/octet-stream",
  });
  createReadStream(absolutePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Bulk Image Size Reducer running at http://127.0.0.1:${port}`);
});

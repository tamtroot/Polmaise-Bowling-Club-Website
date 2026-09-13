import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export function createStaticServer(rootDirectory = process.cwd()) {
  const root = path.resolve(rootDirectory);

  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(requestUrl.pathname);
      const requestedPath = pathname === "/" ? "/index.html" : pathname;
      const filePath = path.resolve(root, `.${requestedPath}`);
      const relativePath = path.relative(root, filePath);

      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      const fileStat = await stat(filePath).catch(() => null);
      if (!fileStat || !fileStat.isFile()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not Found");
        return;
      }

      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": fileStat.size,
        "Content-Type":
          MIME_TYPES[path.extname(filePath).toLowerCase()] ??
          "application/octet-stream",
      });

      if (request.method === "HEAD") {
        response.end();
        return;
      }

      createReadStream(filePath).pipe(response);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Server error");
    }
  });
}

function getRequestedPort() {
  const portArgument = process.argv.find((argument) => argument.startsWith("--port="));
  if (portArgument) {
    return Number(portArgument.split("=")[1]);
  }

  const portIndex = process.argv.indexOf("--port");
  return portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 4173;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = getRequestedPort();
  const server = createStaticServer();

  server.listen(port, "127.0.0.1", () => {
    console.log(`Static baseline server listening on http://127.0.0.1:${port}`);
  });
}

import { serve } from "bun";
import path from "path";

const port = Number(Bun.env.PORT || 3000);
const distDir = path.resolve(import.meta.dir, "../dist");
const indexFile = Bun.file(path.join(distDir, "index.html"));

const server = serve({
  hostname: "0.0.0.0",
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = decodeURIComponent(url.pathname);
    const requestedPath = path.resolve(distDir, `.${pathname}`);

    if (requestedPath.startsWith(distDir)) {
      const file = Bun.file(requestedPath);
      if (await file.exists()) {
        return new Response(file);
      }
    }

    return new Response(indexFile);
  },
});

console.log(`Server running at ${server.url}`);

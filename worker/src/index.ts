import { routeApi, type Env as ApiEnv } from "./routes";

type Env = ApiEnv & {
  ASSETS: Fetcher;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // API routes (implemented in later todos)
    if (url.pathname.startsWith("/api/")) {
      return routeApi(request, env);
    }

    // Static assets + SPA fallback to index.html
    const res = await env.ASSETS.fetch(request);
    if (res.status !== 404) return res;

    // If the request looks like a client-side route (no file extension), fallback to index.html
    const lastSegment = url.pathname.split("/").pop() || "";
    const hasExtension = lastSegment.includes(".");
    if (!hasExtension) {
      const indexUrl = new URL("/index.html", url);
      return env.ASSETS.fetch(new Request(indexUrl, request));
    }

    return res;
  },
};



import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 5000;

export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
) {
  try {
    const reqUrl = new URL(request.url);

    // ─── Health check for Railway ───────────────────────────────────────────
    if (reqUrl.pathname === "/health") {
      return new Response("ok", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // ─── robots.txt ─────────────────────────────────────────────────────────
    // Handled here to prevent React Router "No route matches" error spam.
    if (reqUrl.pathname === "/robots.txt") {
      return new Response(
        "User-agent: *\nDisallow: /apps/\nDisallow: /chat\nDisallow: /api/\n",
        {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }
      );
    }

    // ─── Sitemap variants ────────────────────────────────────────────────────
    // Bots and SEO crawlers probe these URLs. This app does not serve its own
    // sitemap (the Shopify storefront handles it). Return 204 No Content to
    // silence the React Router "No route matches" error without a redirect cost.
    //
    // URLs silenced:
    //   /sitemap.xml       — standard sitemap
    //   /sitemap.xml.gz    — compressed sitemap
    //   /sitemaps.xml      — alternate name used by some crawlers
    //   /sitemap.txt       — text sitemap variant
    //   /sitemap_index.xml — sitemap index
    const sitemapPaths = new Set([
      "/sitemap.xml",
      "/sitemap.xml.gz",
      "/sitemaps.xml",
      "/sitemap.txt",
      "/sitemap_index.xml",
    ]);
    if (sitemapPaths.has(reqUrl.pathname)) {
      return new Response(null, { status: 204 });
    }

    // ─── Silence /favicon.ico if no favicon exists ──────────────────────────
    if (reqUrl.pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }
  } catch (err) {
    // If URL parsing fails for some reason, continue to normal rendering path
    console.warn("URL parse warning:", err?.message || err);
  }

  // ─── Normal React Router rendering ────────────────────────────────────────
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      },
    );

    // Automatically timeout the React renderer after 6 seconds
    setTimeout(abort, streamTimeout + 1000);
  });
}

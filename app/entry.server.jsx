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
  // Quick healthcheck & static routes: respond immediately to avoid stack traces
  try {
    const reqUrl = new URL(request.url);

    // Health check for Railway
    if (reqUrl.pathname === "/health") {
      return new Response("ok", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Silence /robots.txt — prevents 404 stack trace spam in logs
    if (reqUrl.pathname === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /apps/\nDisallow: /chat\nDisallow: /api/\n", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Silence /favicon.ico if no favicon exists
    if (reqUrl.pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }
  } catch (err) {
    // If URL parsing fails for some reason, continue to normal rendering path
    console.warn("URL parse warning:", err?.message || err);
  }

  // Normal rendering code follows
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

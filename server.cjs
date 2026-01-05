// server.cjs - minimal production server that delegates to React Router server build
// Uses dynamic import so it works whether build is ESM/CJS.

const http = require("http");
const { Readable } = require("stream");

const PORT = process.env.PORT || 3000;

async function loadHandler() {
  try {
    // Import the server build produced by the React Router / Vite build.
    // This file exists at build/server/index.js after npm run build.
    const mod = await import("./build/server/index.js");
    // The entry typically exports a default handler function (your entry.server.jsx default).
    const handler = mod.default || mod.handleRequest || mod.requestHandler;
    if (typeof handler !== "function") {
      console.error("Server build does not export a default handler function. Export names found:", Object.keys(mod));
      throw new Error("Invalid server build export");
    }
    return handler;
  } catch (err) {
    console.error("Failed to load server build: ", err);
    throw err;
  }
}

/**
 * Convert a Node IncomingMessage -> Web Request (Node 18+ Fetch API supports Request with Node stream body)
 */
function toWebRequest(req) {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host || `localhost:${PORT}`;
  const url = `${protocol}://${host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (v === undefined) continue;
    // req.headers values may be string or array
    if (Array.isArray(v)) headers.set(k, v.join(","));
    else headers.set(k, v);
  }
  const init = {
    method: req.method,
    headers,
    // Node IncomingMessage is a readable stream - Fetch API in Node accepts it as body
    body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
  };
  return new Request(url, init);
}

/**
 * Pipe a Web Response to Node ServerResponse
 */
async function sendNodeResponse(nodeRes, webRes) {
  try {
    nodeRes.statusCode = webRes.status;
    // copy headers
    webRes.headers.forEach((value, key) => nodeRes.setHeader(key, value));
    // ensure chunked
    const body = webRes.body;
    if (!body) {
      nodeRes.end();
      return;
    }

    // If body is a web ReadableStream
    if (typeof body.getReader === "function") {
      const reader = body.getReader();
      const textDecoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // value is a Uint8Array
        nodeRes.write(value);
      }
      nodeRes.end();
      return;
    }

    // If body is a Node stream (some builds may return a Node stream)
    if (typeof body.pipe === "function") {
      body.pipe(nodeRes);
      return;
    }

    // Fallback: read as text
    const text = await webRes.text();
    nodeRes.end(text);
  } catch (err) {
    console.error("Failed to send response:", err);
    try {
      nodeRes.statusCode = 500;
      nodeRes.end("Internal Server Error");
    } catch (e) {
      /* ignore */
    }
  }
}

(async () => {
  let handler;
  try {
    handler = await loadHandler();
  } catch (err) {
    console.error("Exiting because server build could not be loaded.");
    process.exit(1);
  }

  const server = http.createServer(async (req, res) => {
    try {
      // quick healthcheck shortcut: respond immediately to /health
      const urlPath = (req.url || "").split("?")[0];
      if (req.method === "GET" && (urlPath === "/health" || urlPath === "/_health")) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
      }

      // Build a Web Request and call your SSR handler
      const webReq = toWebRequest(req);

      // Many server handlers expect: (request, responseStatusCode, responseHeaders, context)
      // We'll attempt to call with those params and accept either a Response return or direct Response-like return.
      let response;
      try {
        // Some handlers return Response directly when called with (request, status, headers, context)
        const initHeaders = new Headers();
        response = await handler(webReq, 200, initHeaders, {});
      } catch (err) {
        // If calling failed, try calling as a function that directly accepts (request)
        try {
          response = await handler(webReq);
        } catch (err2) {
          console.error("Handler invocation failed:", err, err2);
          throw err2 || err;
        }
      }

      // If handler returned a Node-style stream or wrote directly, we attempt to handle Response-like
      if (!response) {
        res.statusCode = 404;
        res.end("Not Found");
        return;
      }

      // Convert web Response -> node response
      await sendNodeResponse(res, response);
    } catch (err) {
      console.error("Unhandled server error:", err);
      try {
        res.statusCode = 500;
        res.end("Internal Server Error");
      } catch (e) {}
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
  });
})();

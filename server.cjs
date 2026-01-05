// server.cjs - minimal production server that delegates to React Router server build
// Saves a /health endpoint and binds to process.env.PORT

const http = require("http");

const PORT = process.env.PORT || 3000;

async function loadHandler() {
  try {
    // Import the SSR bundle produced by `react-router build`
    // Path expected: ./build/server/index.js
    const mod = await import("./build/server/index.js");
    // Handler must be the default export (entry.server.jsx -> default)
    const handler = mod.default || mod.handleRequest || mod.requestHandler;
    if (typeof handler !== "function") {
      console.error("Server build export not a function. Exports:", Object.keys(mod));
      throw new Error("Invalid server build export");
    }
    return handler;
  } catch (err) {
    console.error("Failed to load server build:", err);
    throw err;
  }
}

function toWebRequest(req) {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host || `localhost:${PORT}`;
  const url = `${protocol}://${host}${req.url || "/"}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (v === undefined) continue;
    if (Array.isArray(v)) headers.set(k, v.join(","));
    else headers.set(k, v);
  }
  const init = {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
  };
  return new Request(url, init);
}

async function sendNodeResponse(nodeRes, webRes) {
  try {
    nodeRes.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => nodeRes.setHeader(key, value));
    const body = webRes.body;
    if (!body) {
      nodeRes.end();
      return;
    }

    // Web ReadableStream
    if (typeof body.getReader === "function") {
      const reader = body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        nodeRes.write(value);
      }
      nodeRes.end();
      return;
    }

    // Node stream
    if (typeof body.pipe === "function") {
      body.pipe(nodeRes);
      return;
    }

    // Fallback
    const text = await webRes.text();
    nodeRes.end(text);
  } catch (err) {
    console.error("Failed to send response:", err);
    try {
      nodeRes.statusCode = 500;
      nodeRes.end("Internal Server Error");
    } catch (e) {}
  }
}

(async () => {
  let handler;
  try {
    handler = await loadHandler();
  } catch (err) {
    console.error("Exiting: cannot load SSR handler.");
    process.exit(1);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = (req.url || "").split("?")[0];
      // Healthcheck endpoints
      if (req.method === "GET" && (urlPath === "/health" || urlPath === "/_health")) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
      }

      // Delegate to SSR handler
      const webReq = toWebRequest(req);

      // Try calling handler with (request, status, headers, context)
      let webRes;
      try {
        const initHeaders = new Headers();
        webRes = await handler(webReq, 200, initHeaders, {});
      } catch (err) {
        // fallback: handler expects just a Request
        webRes = await handler(webReq);
      }

      if (!webRes) {
        res.statusCode = 404;
        res.end("Not Found");
        return;
      }

      await sendNodeResponse(res, webRes);
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

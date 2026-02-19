// app/routes/auth.token-status.jsx
export async function loader({ request }) {
  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversation_id");
  if (!conversationId) {
    return new Response(JSON.stringify({ status: "error", message: "Missing conversation_id parameter" }), { status: 400 });
  }

  try {
    const dbMod = await import("../db.server");
    const getCustomerToken = dbMod.getCustomerToken;

    const token = await getCustomerToken(conversationId);
    if (token) {
      return new Response(JSON.stringify({ status: "authorized", expires_at: token.expiresAt.toISOString() }), {
        headers: corsHeaders(request),
      });
    } else {
      return new Response(JSON.stringify({ status: "unauthorized" }), { headers: corsHeaders(request) });
    }
  } catch (error) {
    console.error("Error checking token status:", error);
    return new Response(JSON.stringify({ status: "error", message: "Failed to check token status" }), { status: 500, headers: corsHeaders(request) });
  }
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const allowOrigin = origin || "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    ...(origin ? { "Access-Control-Allow-Credentials": "true" } : {}),
    "Access-Control-Max-Age": "86400",
  };
}

export const action = async ({ request }) => {
  if (request.method.toLowerCase() === "options") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
};

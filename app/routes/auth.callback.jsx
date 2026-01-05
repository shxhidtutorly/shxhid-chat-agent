// app/routes/auth.callback.jsx
export async function loader({ request }) {
  // dynamic server imports
  const dbMod = await import("../db.server");
  const { getCodeVerifier, storeCustomerToken, getCustomerAccountUrls } = dbMod;

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const [conversationId, shopId] = (state || "").split("-");

  if (!code) {
    return new Response(JSON.stringify({ error: "Authorization code is missing" }), { status: 400 });
  }

  try {
    const tokenResponse = await exchangeCodeForToken(code, state, { getCodeVerifier, getCustomerAccountUrls, storeCustomerToken });

    try {
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + (tokenResponse.expires_in || 0));
      await storeCustomerToken(conversationId, tokenResponse.access_token, expiresAt);
      console.log("Stored customer token in database for conversation:", conversationId);
    } catch (err) {
      console.error("Failed to store token in DB:", err);
    }

    return new Response(`<!doctype html><html><body><script>window.close()</script><p>Authentication successful. You can close this window.</p></body></html>`, {
      headers: { "Content-Type": "text/html" }
    });
  } catch (error) {
    console.error("Error exchanging code for token:", error);
    return new Response(JSON.stringify({ error: "Failed to obtain access token" }), { status: 500 });
  }
}

async function exchangeCodeForToken(code, state, dbHelpers) {
  const clientId = process.env.SHOPIFY_API_KEY;
  const redirectUri = process.env.REDIRECT_URL;
  const [conversationId, shopId] = (state || "").split("-");

  const tokenUrl = await getTokenUrl(conversationId, dbHelpers);
  if (!tokenUrl) throw new Error("Token URL not found");

  let codeVerifier = "";
  try {
    const verifierRecord = await dbHelpers.getCodeVerifier(state);
    if (verifierRecord) codeVerifier = verifierRecord.verifier;
  } catch (err) {
    console.warn("Code verifier lookup failed:", err);
  }

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
  });

  if (codeVerifier) params.append("code_verifier", codeVerifier);

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function getTokenUrl(conversationId, dbHelpers) {
  try {
    const urls = await dbHelpers.getCustomerAccountUrls(conversationId);
    return urls?.tokenUrl ?? null;
  } catch (err) {
    console.error("getTokenUrl error:", err);
    return null;
  }
}

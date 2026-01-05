// app/routes/api.webhooks.jsx
export const action = async ({ request }) => {
  // Dynamic server-only imports
  const shopifyMod = await import("../shopify.server");
  const dbMod = await import("../db.server");
  const authenticate = shopifyMod.authenticate;
  const db = dbMod.default ?? dbMod;

  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  switch (topic) {
    case "APP_UNINSTALLED":
      if (session) {
        // delete sessions for this shop
        await db.session.deleteMany({ where: { shop } });
      }
      break;
    default:
      throw new Response("Unhandled webhook topic", { status: 404 });
  }

  return new Response(null, { status: 200 });
};

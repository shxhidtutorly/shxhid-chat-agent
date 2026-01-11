// app/routes/test.jsx
// DELETE THIS FILE AFTER TESTING!

export async function loader() {
  const tests = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    checks: {}
  };

  // Check 1: API Key exists
  tests.checks.anthropic_key_exists = !!process.env.ANTHROPIC_API_KEY;
  tests.checks.anthropic_key_format = process.env.ANTHROPIC_API_KEY?.startsWith("sk-ant-");
  tests.checks.anthropic_key_length = process.env.ANTHROPIC_API_KEY?.length || 0;
  
  // Check 2: Database
  tests.checks.database_url_exists = !!process.env.DATABASE_URL;
  tests.checks.database_url_valid = process.env.DATABASE_URL?.includes("postgresql://");

  // Check 3: Try connecting to Anthropic
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [
        { role: "user", content: "Say 'API key works!'" }
      ],
    });

    tests.checks.anthropic_api_works = true;
    tests.checks.anthropic_response = message.content[0].text;
  } catch (error) {
    tests.checks.anthropic_api_works = false;
    tests.checks.anthropic_error = error.message;
  }

  // Check 4: Database connection
  try {
    const prisma = (await import("../db.server")).default;
    await prisma.$queryRaw`SELECT 1`;
    tests.checks.database_connection_works = true;
  } catch (error) {
    tests.checks.database_connection_works = false;
    tests.checks.database_error = error.message;
  }

  return new Response(
    JSON.stringify(tests, null, 2),
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}

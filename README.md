# Shopify AI Chat Agent

AI-powered shopping assistant for Shopify stores. Built as a **Shopify Dev Dashboard app** using Shopify's Model Context Protocol (MCP) with Claude (Anthropic) as the LLM. Deployed on Railway.

> **Important:** This is a Dev Dashboard app (not a legacy custom app). It uses OAuth session tokens, theme app extensions, and the app proxy — never permanent admin tokens.

## Architecture

```
Browser (Shopify storefront)
  |
  |  click "Chat with AI"
  v
Theme App Extension (chat-interface.liquid + chat.js)
  |
  |  POST /apps/shop-chat/chat  (Shopify app proxy)
  v
Shopify Edge  ──[app_proxy]──>  Railway Backend
  |                                   |
  |  ?shop=store.myshopify.com        |
  v                                   v
                              React Router (chat.jsx)
                                   |
                         ┌─────────┼──────────┐
                         v         v          v
                     Claude    Shopify MCP   PostgreSQL
                   (Haiku 4.5) (storefront   (Prisma)
                               + customer)
```

### Components

| Layer | Location | Purpose |
|---|---|---|
| **Theme Extension** | `extensions/chat-bubble/` | Floating chat UI injected into the storefront theme |
| **Chat Route** | `app/routes/chat.jsx` | Core SSE endpoint: receives messages, calls Claude, streams responses |
| **MCP Client** | `app/mcp-client.js` | JSON-RPC 2.0 client for Shopify Storefront & Customer MCP servers |
| **Claude Service** | `app/services/claude.server.js` | Anthropic SDK wrapper with streaming and tool-use support |
| **Tool Service** | `app/services/tool.server.js` | Processes MCP tool responses (product search, cart updates) |
| **Storefront API** | `app/shopify-storefront.js` + `app/storefront-service.js` | Direct Storefront GraphQL client for cart operations via `/api/cart` |
| **Storefront Queries** | `app/storefront-queries.js` | GraphQL queries/mutations (validated against Shopify schema) |
| **Leads Route** | `app/routes/leads.jsx` | Email capture endpoint |
| **Cart Route** | `app/routes/api.cart.jsx` | Direct cart add-to-cart endpoint (Storefront API) |
| **Auth** | `app/auth.server.js` + `app/routes/auth.*.jsx` | Customer account PKCE OAuth flow |
| **Shopify App Config** | `app/shopify.server.js` | `shopifyApp()` setup: OAuth, session storage, distribution |
| **Database** | `app/db.server.js` + `prisma/schema.prisma` | Session, conversation, message, lead, analytics storage |
| **Analytics** | `app/services/posthog.server.js` | PostHog event tracking (optional) |

## Frontend

### Theme App Extension (`extensions/chat-bubble/`)

**Files:**
- `blocks/chat-interface.liquid` — Main Liquid block. All HTML/CSS for the chat modal UI (inline styles), floating pill buttons, email capture overlay, history panel, suggestion chips. Sets `window.shopChatConfig` with API URLs derived from `{{ shop.url }}`.
- `assets/chat.js` — Core frontend logic (IIFE). Modal open/close (`body.shop-ai-open` CSS class toggle), SSE streaming, product grid rendering, product modal popups, add-to-cart, checkout flow, email capture, conversation state (sessionStorage/localStorage).
- `assets/chat.css` — Base styles for chat components, product cards, animations.
- `shopify.extension.toml` — Extension config (type: theme).
- `locales/en.default.json` — i18n strings.

**How the UI works:**
1. Floating pill buttons ("Chat with AI" + "Ask AI") rendered at bottom-right
2. Click triggers `document.body.classList.add('shop-ai-open')` which CSS-transitions the modal visible
3. First open may show email capture popup
4. Messages sent via `POST` to `{{ shop.url }}/apps/shop-chat/chat` (app proxy path)
5. SSE stream parsed for events: `id`, `chunk` (text), `product_results`, `cart_updated`, `end_turn`, `error`
6. Product cards rendered as scrollable grid; clicking opens detail modal (CSS transition via `.active` class)
7. "Add to Cart" calls `/apps/shop-chat/api/cart`; stores `cartId`/`checkoutUrl` in sessionStorage
8. "Go to Cart" opens Shopify checkout URL in new tab

**Configuration via Liquid:**
```javascript
window.shopChatConfig = {
  apiUrl:      '{{ shop.url }}/apps/shop-chat/chat',
  leadsUrl:    '{{ shop.url }}/apps/shop-chat/leads',
  cartUrl:     '{{ shop.url }}/apps/shop-chat/api/cart',
  shopId:      '{{ shop.id }}',
  promptType:  'creativeAutomationAssistant',
  welcomeMessage: '{{ block.settings.welcome_message }}'
};
```

## Backend

### API Routes

| Route | Method | Purpose |
|---|---|---|
| `/chat` | `POST` | Main chat endpoint. Accepts `{ message, conversation_id, prompt_type }`. Returns SSE stream. |
| `/chat` | `GET` | With `?history=true&conversation_id=xxx` returns conversation history as JSON. |
| `/leads` | `POST` | Email capture. Accepts `{ email, visitorId, conversationId }`. |
| `/leads` | `GET` | With `?visitorId=xxx` checks if visitor already provided email. |
| `/api/cart` | `POST` | Add to cart. Accepts `{ variantId, quantity, cartId }`. Returns `{ cartId, checkoutUrl, totalQuantity }`. |
| `/auth/callback` | `GET` | Customer account OAuth callback (PKCE). |
| `/auth/token-status` | `GET` | Check if customer has valid auth token for a conversation. |
| `/auth/*` | `GET` | Shopify OAuth splat route (handled by `@shopify/shopify-app-react-router`). |
| `/app` | `GET` | Shopify embedded admin app dashboard. |

### Shop Domain Resolution

The backend resolves the shop domain from incoming requests in this priority order:

1. **`?shop=` query parameter** — Added automatically by Shopify's app proxy to all forwarded requests. Returns the `*.myshopify.com` domain. This is the primary source in production.
2. **`Origin` header** — Present for cross-origin requests (direct API calls, development).
3. **`SHOPIFY_STORE_DOMAIN` env var** — Final fallback.

This is critical because:
- App proxy requests are same-origin (no `Origin` header)
- MCP endpoints require the `*.myshopify.com` domain
- Custom domains don't work for MCP

### MCP Integration

The app connects to two Shopify MCP servers per chat session:

1. **Storefront MCP** (`https://{shop}.myshopify.com/api/mcp`) — product search, cart operations, FAQs
2. **Customer MCP** (`https://{shop}.account.myshopify.com/customer/api/mcp`) — order history, returns (requires customer auth via PKCE)

Tools are discovered via JSON-RPC `tools/list` and passed to Claude as available tools. When Claude invokes a tool, the backend calls the appropriate MCP server and returns results.

### Streaming Flow

```
Frontend POST /apps/shop-chat/chat
  -> Shopify app proxy forwards to Railway /chat?shop=store.myshopify.com
    -> handleChatRequest() creates SSE stream
      -> handleChatSession():
        1. Connect to Storefront + Customer MCP (discover tools)
        2. Save user message to DB
        3. Load conversation history
        4. Call Claude with streaming (tools + history)
        5. Stream text chunks as SSE events
        6. On tool_use: call MCP tool, process results
           - search_shop_catalog -> send product_results event
           - update_cart -> send cart_updated event
        7. On end_turn: send end_turn event
```

### Storefront GraphQL API

Used by `/api/cart` for direct cart operations (separate from MCP):

- **Endpoint**: `https://{SHOPIFY_STORE_DOMAIN}/api/2025-10/graphql.json` (derived from env var)
- **Auth**: Storefront API access token (`X-Shopify-Storefront-Access-Token` header)
- **Mutations**: `cartCreate`, `cartLinesAdd`
- **Queries**: `products` (search), `cart` (get cart)

All queries validated against the official Shopify Storefront API schema.

### Customer Account Auth (PKCE)

Customer authentication uses the PKCE OAuth flow:

1. Backend generates auth URL with code challenge
2. Customer authorizes in a popup window
3. `/auth/callback` exchanges code for access token
4. Token stored in DB, linked to `conversationId`
5. Subsequent customer MCP calls include the token

The `REDIRECT_URL` env var controls the callback URL. If not set, it derives from `SHOPIFY_APP_URL` + `/auth/callback`.

## Database (PostgreSQL via Prisma)

| Model | Purpose |
|---|---|
| `Session` | Shopify OAuth sessions (managed by `@shopify/shopify-app-session-storage-prisma`) |
| `Conversation` | Chat conversation metadata |
| `Message` | Individual messages (user/assistant) |
| `Visitor` | Browser fingerprint, UTM tracking, lead scoring |
| `Lead` | Email captures per shop |
| `ChatAnalytics` | Event-level analytics |
| `CustomerToken` | Customer OAuth access tokens (PKCE flow) |
| `CodeVerifier` | PKCE code verifiers (short-lived) |
| `CustomerAccountUrls` | Cached MCP/auth endpoint URLs per conversation |

## Environment Variables

### Required

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key (starts with `sk-ant-`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `SHOPIFY_API_KEY` | Shopify app client ID (from Dev Dashboard) |
| `SHOPIFY_API_SECRET` | Shopify app secret key (from Dev Dashboard) |
| `SHOPIFY_APP_URL` | Deployed app URL (e.g., `https://your-app.up.railway.app`) |
| `SHOPIFY_STORE_DOMAIN` | Store's myshopify.com domain (e.g., `store.myshopify.com`) |
| `SCOPES` | Shopify OAuth scopes (comma-separated) |

### Optional

| Variable | Purpose |
|---|---|
| `SHOPIFY_STOREFRONT_ENDPOINT` | Full Storefront API GraphQL URL (defaults to `https://{SHOPIFY_STORE_DOMAIN}/api/2025-10/graphql.json`) |
| `SHOPIFY_STOREFRONT_TOKEN` | Storefront API access token (for direct `/api/cart` endpoint) |
| `SHOP_CUSTOM_DOMAIN` | Custom domain for Shopify auth |
| `REDIRECT_URL` | OAuth redirect URL (defaults to `{SHOPIFY_APP_URL}/auth/callback`) |
| `POSTHOG_API_KEY` | PostHog analytics key |
| `POSTHOG_HOST` | PostHog host URL |
| `NODE_ENV` | `production` or `development` |

## Deployment

### Railway

The app deploys to Railway using the `Dockerfile`:

1. Node 20 Alpine base image
2. Production dependencies only (`npm ci --omit=dev`)
3. Prisma client generated + app built
4. On start: `prisma migrate deploy` then `npm run docker-start`
5. Health check on `/` (port 8080)

### Shopify App (Dev Dashboard)

After deploying to Railway, deploy the Shopify app via CLI:

```bash
shopify app deploy
```

This pushes:
- App configuration from `shopify.app.toml` (includes app proxy, scopes, redirect URLs)
- Theme extension from `extensions/chat-bubble/`

**Critical `shopify.app.toml` settings:**
- `client_id` — From the Shopify Dev Dashboard
- `application_url` — Must point to Railway URL
- `[app_proxy]` — Maps `/apps/shop-chat/*` on the storefront to the Railway backend. **Without this, no storefront traffic reaches the backend.**
- `[auth]` redirect URLs — Must point to Railway `/auth/callback`
- `[customer_authentication]` redirect URIs — Same
- `[build] include_config_on_deploy = true` — Ensures toml config is synced on every deploy

**After deploy, enable the theme extension:**
1. Go to the Shopify admin > Online Store > Themes > Customize
2. Add the "AI Chat Assistant" block to the theme
3. Save and publish

## Development

```bash
npm install
npm run dev
```

This starts Vite dev server with HMR, connects to Shopify CLI for tunneling.

### Database

```bash
npm run db:push      # Push schema to DB
npm run db:migrate   # Run migrations
npm run db:studio    # Open Prisma Studio
```

## Project Structure

```
/
├── app/
│   ├── routes/
│   │   ├── chat.jsx              # Core chat SSE endpoint
│   │   ├── leads.jsx             # Email capture
│   │   ├── api.cart.jsx          # Cart operations (Storefront API)
│   │   ├── auth.$.jsx            # Shopify OAuth splat route
│   │   ├── auth.callback.jsx     # Customer OAuth callback (PKCE)
│   │   ├── auth.token-status.jsx # Token check
│   │   ├── app.jsx               # Embedded admin app layout
│   │   ├── app._index.jsx        # Admin dashboard
│   │   └── _index/route.jsx      # Root redirect
│   ├── services/
│   │   ├── claude.server.js      # Anthropic SDK wrapper
│   │   ├── tool.server.js        # MCP tool response processors
│   │   ├── streaming.server.js   # SSE stream utilities
│   │   ├── config.server.js      # App constants
│   │   └── posthog.server.js     # Analytics (optional)
│   ├── mcp-client.js             # Shopify MCP JSON-RPC client
│   ├── shopify-storefront.js     # Storefront GraphQL client
│   ├── storefront-queries.js     # GraphQL queries/mutations
│   ├── storefront-service.js     # High-level cart/search service
│   ├── shopify.server.js         # Shopify Dev Dashboard app config
│   ├── auth.server.js            # PKCE OAuth helpers
│   ├── db.server.js              # Prisma DB operations
│   ├── entry.server.jsx          # React Router SSR entry
│   ├── root.jsx                  # Root component
│   └── routes.js                 # File-based routing
├── extensions/
│   └── chat-bubble/
│       ├── blocks/chat-interface.liquid  # Chat UI block
│       ├── assets/
│       │   ├── chat.js                  # Frontend chat logic
│       │   └── chat.css                 # Base styles
│       ├── locales/en.default.json
│       └── shopify.extension.toml
├── prisma/schema.prisma
├── shopify.app.toml              # Dev Dashboard app config
├── shopify.web.toml              # Dev server config
├── Dockerfile
├── railway.json
├── vite.config.js
└── package.json
```

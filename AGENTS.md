# AGENTS.md — cf-api-proxy

Transparent reverse proxy run as a **Cloudflare Worker**. Forwards requests for
Telegram, Discord, Anthropic and OpenAI APIs through the Cloudflare edge.

## How it works

A service maps a URL prefix to an upstream base and forwards the path, method,
headers and body **verbatim**. There is no per-method logic, so when an upstream
adds or changes an endpoint the proxy keeps working unchanged.

- Declarative services are built with `forward({ prefix, upstream, stripQuery, defaultHeaders })`
  in `worker.js`.
- Custom services (e.g. Telegram, where the token lives in the URL path) use a
  plain `{ match, upstream, headers }` object.
- Auth is passed through from the client (Bearer / x-api-key). The proxy only
  adds headers via `defaultHeaders` when the client didn't send its own.
- Responses are forwarded as a stream (not buffered) so OpenAI/Anthropic SSE
  streaming works.

## Routes

| Service  | URL prefix           | Upstream                 |
|----------|----------------------|--------------------------|
| Telegram | `/bot{token}/{m}`    | `api.telegram.org`       |
| Discord  | `/dc/{endpoint}`     | `discord.com/api/v10`    |
| Anthropic| `/claude/{path}`     | `api.anthropic.com/v1`   |
| OpenAI   | `/openai/{path}`     | `api.openai.com/v1`      |

## Routines

- **Test**: `npm test` (vitest, `worker.test.js` mocks `fetch` and asserts the
  forwarded URL/headers/body).
- **Local dev**: `npm run dev` (wrangler dev).
- **Deploy**: push to `origin/main`. A Cloudflare Workers Git integration
  auto-deploys every push to `main`; there is **no** GitHub Actions workflow and
  no status check is posted, so verify by hitting the live `https://api-proxy.kharitonov.su/health`
  (its `services` array must list `anthropic`/`openai`) rather than by CI status.
  Manual alternative: `npm run deploy` (requires `wrangler login`).

## Adding a service

Header-auth API → add one `forward(...)` line to `SERVICES`:

```js
github: forward({ prefix: '/gh', upstream: 'https://api.github.com' }),
```

`stripQuery` removes proxy-owned query params before forwarding; `defaultHeaders`
are injected only when absent. Add a matching `worker.test.js` case.

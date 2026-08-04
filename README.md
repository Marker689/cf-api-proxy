# Cloudflare API Proxy

Transparent proxy for Telegram Bot API, Discord REST API, Anthropic API and OpenAI API via Cloudflare Workers.

## Routes

| Service  | URL format                                    | Upstream                  |
|----------|-----------------------------------------------|---------------------------|
| Telegram | `/bot{TOKEN}/{method}`                        | `api.telegram.org`        |
| Discord  | `/dc/{endpoint}?token=TOKEN`                  | `discord.com/api/v10`     |
| Anthropic| `/claude/{path}`                              | `api.anthropic.com/v1`    |
| OpenAI   | `/openai/{path}`                              | `api.openai.com/v1`       |

Extensible — add new services in `SERVICES` config inside `worker.js`.

The proxy is **transparent**: a service maps a URL prefix to an upstream base
and forwards the path, method, headers, and body verbatim. If the upstream adds
or changes an endpoint, the proxy keeps working unchanged — no per-method logic.

## Usage

### Telegram Bot API

```bash
# Get bot info
curl "https://api-proxy.kharitonov.su/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/getMe"

# Send message
curl -X POST "https://api-proxy.kharitonov.su/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": 123456, "text": "Hello"}'

# Download file (getFile returns file_path, then fetch via /file route)
curl "https://api-proxy.kharitonov.su/file/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/files/file.jpg"
```

### Discord REST API

```bash
# Get current user
curl "https://api-proxy.kharitonov.su/dc/users/@me?token=DISCORD_TOKEN"

# Get channel messages
curl "https://api-proxy.kharitonov.su/dc/channels/CHANNEL_ID/messages?token=DISCORD_TOKEN"

# Send message (Bot token)
curl -X POST "https://api-proxy.kharitonov.su/dc/channels/CHANNEL_ID/messages?token=BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello from proxy!"}'

# User token (prefix: "Bearer")
curl "https://api-proxy.kharitonov.su/dc/users/@me?token=USER_TOKEN&auth_prefix=Bearer"
```

### Anthropic API

Passthrough auth with your own `x-api-key` header (the proxy fills in the
required `anthropic-version` automatically).

```bash
curl -X POST "https://api-proxy.kharitonov.su/claude/messages" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-latest",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### OpenAI API

Passthrough auth with your own `Authorization: Bearer` header.

```bash
curl "https://api-proxy.kharitonov.su/openai/models" \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

SSE streaming (e.g. `"stream": true` for Anthropic `messages` / OpenAI
`chat/completions`) is forwarded verbatim.

## Hermes Agent config

```bash
# Telegram
hermes config set platforms.telegram.extra.base_url "https://api-proxy.kharitonov.su/bot"
hermes config set platforms.telegram.extra.base_file_url "https://api-proxy.kharitonov.su/file/bot"

# Discord
hermes config set platforms.discord.extra.base_url "https://api-proxy.kharitonov.su/dc"

# Anthropic / OpenAI (SDK base_url override)
#   Anthropic: https://api-proxy.kharitonov.su/claude
#   OpenAI:    https://api-proxy.kharitonov.su/openai
```

## Deploy

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

## Extending

For a header-auth service, add **one entry** using the `forward` helper:

```js
github: forward({
  prefix: '/gh',
  upstream: 'https://api.github.com',
  defaultHeaders: { 'Accept': 'application/vnd.github+json' },
}),
```

`forward({ prefix, upstream, stripQuery = [], defaultHeaders = {} })` builds a
service that appends everything after `prefix` to `upstream` and passes all
headers/body through unchanged. `defaultHeaders` are added only when the client
didn't send its own value; `stripQuery` lists query params consumed by the proxy
(never forwarded).

For non-trivial mapping (e.g. Telegram, where the token lives in the path), use
a custom object with `{ match, upstream, headers }` functions.


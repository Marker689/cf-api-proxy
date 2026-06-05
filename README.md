# Cloudflare API Proxy

Transparent proxy for Telegram Bot API and Discord REST API via Cloudflare Workers.

## Routes

| Service  | URL format                                    | Upstream                  |
|----------|-----------------------------------------------|---------------------------|
| Telegram | `/bot{TOKEN}/{method}`                        | `api.telegram.org`        |
| Discord  | `/dc/{endpoint}?token=TOKEN`                  | `discord.com/api/v10`     |

Extensible — add new services in `SERVICES` config inside `worker.js`.

## Usage

### Telegram Bot API

```bash
# Get bot info
curl "https://your-domain.com/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/getMe"

# Send message
curl -X POST "https://your-domain.com/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": 123456, "text": "Hello"}'
```

### Discord REST API

```bash
# Get current user
curl "https://your-domain.com/dc/users/@me?token=DISCORD_TOKEN"

# Get channel messages
curl "https://your-domain.com/dc/channels/CHANNEL_ID/messages?token=DISCORD_TOKEN"

# Send message (Bot token)
curl -X POST "https://your-domain.com/dc/channels/CHANNEL_ID/messages?token=BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello from proxy!"}'

# User token (prefix: "Bearer")
curl "https://your-domain.com/dc/users/@me?token=USER_TOKEN&auth_prefix=Bearer"
```

## Hermes Agent config

```bash
# Telegram
hermes config set platforms.telegram.extra.base_url "https://your-domain.com/bot"

# Discord (if supported by Hermes platform adapter)
hermes config set platforms.discord.extra.base_url "https://your-domain.com/dc"
```

## Deploy

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

## Extending

Add a new service in `worker.js` → `SERVICES` object:

```js
github: {
  match: (pathname) => {
    const m = pathname.match(/^\/gh\/(.+)/);
    return m ? { path: m[1] } : null;
  },
  upstream: (params, url) => `https://api.github.com/${params.path}`,
  headers: (params, url) => {
    const token = url.searchParams.get('token');
    return token ? { 'Authorization': `Bearer ${token}` } : null;
  },
},
```

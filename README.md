# Cloudflare API Proxy

Прокси-сервер для Telegram Bot API и Discord REST API через Cloudflare Pages Functions.

## Что делает

- **Telegram Bot API** — все методы (`sendMessage`, `sendPhoto`, `getFile`, `getMe` и т.д.)
- **Discord REST API** — все эндпоинты (`/users/@me`, `/channels/ID/messages`, `/guilds/ID`...)
- CORS включён для работы из браузера
- File downloads для Telegram (автоматическое скачивание файлов)

## Структура

```
├── worker.js          # Единый entry-point с маршрутизацией
├── wrangler.toml      # Конфиг Cloudflare Workers
├── package.json
└── README.md
```

## Использование

### Telegram Bot API

```bash
# Получить инфо о боте
curl "https://your-domain.com/api/tg/getMe?bot_token=YOUR_TOKEN"

# Отправить сообщение
curl -X POST "https://your-domain.com/api/tg/sendMessage?bot_token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"chat_id":"123456","text":"Hello from proxy!"}'

# Скачать файл
curl -o photo.jpg "https://your-domain.com/api/tg/file/FILE_ID?bot_token=YOUR_TOKEN"
```

### Discord API

```bash
# Получить инфо о боте (bot token)
curl "https://your-domain.com/api/dc/users/@me?token=YOUR_TOKEN"

# Получить инфо о юзере (user OAuth2 token)
curl "https://your-domain.com/api/dc/users/@me?token=YOUR_TOKEN&auth_prefix=Bearer"

# Получить каналы
curl "https://your-domain.com/api/dc/guilds/GUILD_ID/channels?token=YOUR_TOKEN"

# Отправить сообщение
curl -X POST "https://your-domain.com/api/dc/channels/CHANNEL_ID/messages?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"Hello from proxy!"}'
```

> **auth_prefix** — префикс авторизации Discord. По умолчанию `Bot` (для бот-токенов). Для user OAuth2 токенов передай `auth_prefix=Bearer`.

## Прозрачность прокси

Проксирует запросы «как есть» — не зависит от методов конечного эндпоинта:

- **Query params** — все параметры кроме `bot_token`/`token`/`auth_prefix` пробрасываются наверх (`getUpdates?offset=0&limit=100`)
- **Content-Type** — не форсирует `application/json`, передаёт оригинальный заголовок
- **Multipart/form-data** — тело проксируется как raw bytes (sendPhoto, sendDocument, uploadStickerFile)
- **HTTP методы** — GET, POST, PUT, DELETE, PATCH — всё форвардится
- **Discord auth** — `Bot` по дефолту, `Bearer` через `auth_prefix=Bearer`

### Python

```python
import requests

TG_PROXY = "https://your-domain.com/api/tg"
DC_PROXY = "https://your-domain.com/api/dc"

# Telegram
resp = requests.get(f"{TG_PROXY}/sendMessage", params={
    "bot_token": "YOUR_TOKEN",
}, json={"chat_id": 123456, "text": "Привет!"})
print(resp.json())

# Discord
resp = requests.post(f"{DC_PROXY}/channels/CHANNEL_ID/messages", params={
    "token": "YOUR_TOKEN",
}, json={"content": "Привет из прокси!"})
print(resp.json())
```

## Деплой на Cloudflare Pages

### Способ 1: GitHub (рекомендуется)

```bash
cd cf-proxy-proxy
git init
git add .
git commit -m "API proxy setup"
git push origin main  # или на GitLab/Bitbucket
```

Затем в Cloudflare Dashboard:
1. Pages → **Create a new project** → **Connect to Git**
2. Выберите репозиторий
3. **Framework preset**: `None`
4. **Build command**: `echo "No build needed"`
5. **Build output directory**: `.` (точка)
6. **Environment variables** (опционально):
   - `DISCORD_TOKEN`: ваш токен Discord бота
   - `TG_BOT_TOKEN`: токен Telegram бота
7. **Save and Deploy**

### Способ 2: Cloudflare CLI

```bash
npm install -g wrangler
wrangler login
wrangler pages deploy . --project-name=api-proxy
```

### Способ 3: Ручной деплой

1. Cloudflare Pages → **Create a new project** → **Manual Build**
2. Загрузите архив с файлами
3. Build command: `echo "No build needed"`
4. Output directory: `.`

## Настройка домена

После деплоя:
1. Pages → your-project → **Custom Domains** → **Set Up Custom Domain**
2. Введите ваш домен (например `proxy.yourdomain.com`)
3. Cloudflare автоматически настроит DNS CNAME

## Безопасность

⚠️ Токены передаются через query params. Для production:
- Используйте Cloudflare Pages **Environment Variables**
- Или добавьте базовую авторизацию через заголовок `X-Auth-Token`

## Лимиты (free tier)

- 100,000 запросов/день
- 100 concurrent requests
- Timeout: 5s на request

Для Telegram ботов этого достаточно.

/**
 * Cloudflare API Proxy — Worker
 * Telegram Bot API + Discord REST API через Cloudflare Workers
 */

const TG_API = 'https://api.telegram.org';
const DISCORD_API = 'https://discord.com/api/v10';

const HTML_PAGE = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloudflare API Proxy</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0a0a0f;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .logo-icon {
      font-size: 2rem;
      background: linear-gradient(135deg, #f97316, #f59e0b);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .logo-text {
      font-size: 1.25rem;
      font-weight: 600;
      color: #fff;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
      color: #22c55e;
      margin-bottom: 2rem;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      background: #22c55e;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    h1 {
      font-size: 2rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, #fff, #a0a0a0);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle {
      color: #888;
      margin-bottom: 2rem;
    }
    .cards {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      justify-content: center;
      margin-bottom: 2rem;
    }
    .card {
      background: #151520;
      border: 1px solid #2a2a3a;
      border-radius: 12px;
      padding: 1.5rem;
      width: 320px;
      transition: border-color 0.2s;
    }
    .card:hover { border-color: #3a3a5a; }
    .card-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }
    .card-icon { font-size: 1.5rem; }
    .card-title {
      font-weight: 600;
      font-size: 1.1rem;
    }
    .card-desc {
      color: #888;
      font-size: 0.875rem;
      margin-bottom: 1rem;
      line-height: 1.5;
    }
    .card-examples {
      background: #0d0d15;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.8rem;
      color: #6ee7b7;
      line-height: 1.8;
    }
    .footer {
      color: #555;
      font-size: 0.8rem;
    }
    .footer a {
      color: #6ee7b7;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="logo">
    <div class="logo-icon">⚡</div>
    <span class="logo-text">API Proxy</span>
  </div>
  <div class="status">
    <span class="status-dot"></span>
    Online
  </div>
  <h1>Cloudflare API Proxy</h1>
  <p class="subtitle">Telegram & Discord API через Cloudflare Workers</p>
  <div class="cards">
    <div class="card telegram">
      <div class="card-header">
        <div class="card-icon">✈️</div>
        <span class="card-title">Telegram Bot API</span>
      </div>
      <p class="card-desc">Все методы бота: отправка сообщений, фото, файлов, getMe и другие</p>
      <div class="card-examples">
        <code>/api/tg/getMe?bot_token=TOKEN</code><br>
        <code>/api/tg/sendMessage?bot_token=TOKEN</code>
      </div>
    </div>
    <div class="card discord">
      <div class="card-header">
        <div class="card-icon">🎮</div>
        <span class="card-title">Discord API</span>
      </div>
      <p class="card-desc">REST API Discord: каналы, сообщения, серверы, пользователи</p>
      <div class="card-examples">
        <code>/api/dc/users/@me?token=TOKEN</code><br>
        <code>/api/dc/channels/ID/messages?token=TOKEN</code>
      </div>
    </div>
  </div>
  <div class="footer">
    Powered by <a href="https://cloudflare.com" target="_blank">Cloudflare Workers</a> ·
    <a href="https://github.com/Marker689/cf-api-proxy" target="_blank">GitHub</a>
  </div>
</body>
</html>`;

/**
 * Proxy-specific query params that should NOT be forwarded upstream
 */
const PROXY_PARAMS = new Set(['bot_token', 'token', 'auth_prefix']);

/**
 * Build upstream URL preserving all original query params
 * (except proxy-specific ones like bot_token, token)
 */
function buildUpstreamUrl(baseUrl, originalUrl) {
  const orig = new URL(originalUrl);
  const upstream = new URL(baseUrl);

  // Forward all query params except proxy-specific ones
  for (const [key, value] of orig.searchParams.entries()) {
    if (!PROXY_PARAMS.has(key)) {
      upstream.searchParams.append(key, value);
    }
  }

  return upstream.toString();
}

/**
 * Read request body, respecting content type
 * Returns { body: ArrayBuffer | undefined, contentType: string }
 */
async function readBody(request) {
  const ct = request.headers.get('content-type') || '';
  const method = request.method.toUpperCase();

  // No body for GET, HEAD, DELETE (typically)
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return { body: undefined, contentType: ct };
  }

  // Check if it's multipart/form-data — forward as raw bytes
  if (ct.includes('multipart/form-data')) {
    return {
      body: await request.arrayBuffer(),
      contentType: ct,
    };
  }

  // JSON or text — parse then re-stringify
  if (ct.includes('application/json')) {
    try {
      const json = await request.json();
      return { body: JSON.stringify(json), contentType: ct };
    } catch {
      // Fallback: read as text
      const text = await request.text();
      return { body: text, contentType: ct };
    }
  }

  // Everything else: raw text
  const text = await request.text();
  return { body: text, contentType: ct };
}

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // Root — serve landing page
    if (pathParts.length === 0 || (pathParts.length === 1 && pathParts[0] === '')) {
      return new Response(HTML_PAGE, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Route: /api/tg/...
    if (pathParts[0] === 'api' && pathParts[1] === 'tg') {
      return handleTelegram(request, pathParts.slice(2));
    }

    // Route: /api/dc/...
    if (pathParts[0] === 'api' && pathParts[1] === 'dc') {
      return handleDiscord(request, pathParts.slice(2));
    }

    // 404
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

/**
 * Telegram Bot API Proxy
 * Accepts both formats:
 *   GET /api/tg/{method}?bot_token=TOKEN    (query param)
 *   GET /api/tg/bot{TOKEN}/{method}         (standard Bot API path)
 */
async function handleTelegram(request, pathParts) {
  const url = new URL(request.url);
  let token = url.searchParams.get('bot_token');
  let methodParts = pathParts;

  // If no token in query, try standard /bot{TOKEN}/{method} path format
  if (!token && pathParts.length > 0 && pathParts[0].toLowerCase() === 'bot') {
    token = pathParts[1];
    methodParts = pathParts.slice(2);
  }

  if (!token) {
    return jsonResp({ ok: false, error_code: 401, description: 'Missing bot_token' }, 401);
  }

  if (methodParts.length === 0) {
    return jsonResp({
      ok: false, error_code: 400,
      description: 'Missing method. Examples: getMe, sendMessage, sendPhoto, getFile',
    }, 400);
  }

  // File download: /api/tg/file/FILE_ID
  if (methodParts[0] === 'file') {
    const fileId = methodParts.slice(1).join('/');
    return handleTelegramFile(token, fileId);
  }

  const method = methodParts.join('/');
  const baseUrl = `${TG_API}/bot${token}/${method}`;
  const tgUrl = buildUpstreamUrl(baseUrl, request.url);

  const { body, contentType } = await readBody(request);

  try {
    const res = await fetch(tgUrl, {
      method: request.method,
      headers: { 'Content-Type': contentType },
      body: body || undefined,
    });
    const data = await res.json();
    return jsonResp(data, res.status);
  } catch (err) {
    return jsonResp({ ok: false, error_code: 502, description: err.message }, 502);
  }
}

/**
 * Telegram file download
 */
async function handleTelegramFile(token, fileId) {
  try {
    const info = await fetch(`${TG_API}/bot${token}/getFile?file_id=${fileId}`)
      .then(r => r.json());

    if (!info.ok) {
      return jsonResp(info, info.error_code || 500);
    }

    const fileUrl = `https://api.telegram.org/file/bot${token}/${info.result.file_path}`;
    const res = await fetch(fileUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (CFProxy/1.0)' },
    });

    if (!res.ok) {
      return new Response(`Download failed: ${res.status}`, { status: res.status });
    }

    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileId}"`,
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return jsonResp({ ok: false, error_code: 502, description: err.message }, 502);
  }
}

/**
 * Discord API Proxy
 */
async function handleDiscord(request, pathParts) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const authPrefix = url.searchParams.get('auth_prefix') || 'Bot';

  if (!token) {
    return jsonResp({ error: 'Missing token' }, 401);
  }

  if (pathParts.length === 0) {
    return jsonResp({ error: 'Missing endpoint. Examples: users/@me, channels/ID/messages' }, 400);
  }

  const endpoint = pathParts.join('/');
  const baseUrl = `${DISCORD_API}/${endpoint}`;
  const dcUrl = buildUpstreamUrl(baseUrl, request.url);

  const { body, contentType } = await readBody(request);

  const headers = new Headers({
    'Authorization': `${authPrefix} ${token}`,
    'Content-Type': contentType,
  });

  try {
    const res = await fetch(dcUrl, {
      method: request.method,
      headers,
      body: body || undefined,
    });

    const resHeaders = new Headers(res.headers);
    resHeaders.set('Access-Control-Allow-Origin', '*');

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await res.json();
      return jsonResp(data, res.status, resHeaders);
    } else {
      const data = await res.arrayBuffer();
      return new Response(data, { status: res.status, headers: resHeaders });
    }
  } catch (err) {
    return jsonResp({ error: 'Discord API error', details: err.message }, 502);
  }
}

/**
 * JSON response helper
 */
function jsonResp(data, status = 200, extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    ...extra,
  };
  return new Response(JSON.stringify(data), { status, headers });
}

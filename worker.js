/**
 * Cloudflare API Proxy — Worker
 * Transparent proxy for Telegram Bot API and Discord REST API.
 * Add new services by extending the SERVICES config below.
 */

// ── Service Definitions (extensible) ──────────────────────────────────

const SERVICES = {
  telegram: {
    // /bot{TOKEN}/{method}  →  https://api.telegram.org/bot{TOKEN}/{method}
    match: (pathname) => {
      // Handles: /bot{TOKEN}/{method}  and  /bot/bot{TOKEN}/{method}
      const m = pathname.match(/^\/bot\/?(\d+:.+?)\/(.+)/);
      return m ? { token: m[1], method: m[2] } : null;
    },
    upstream: (params, url) => {
      const u = new URL(`https://api.telegram.org/bot${params.token}/${params.method}`);
      // Forward all query params (Hermes may add its own, ignore proxy ones)
      for (const [k, v] of url.searchParams) {
        if (!['bot_token'].includes(k)) u.searchParams.append(k, v);
      }
      return u.toString();
    },
    headers: (params, request) => null, // token is in URL
  },

  discord: {
    // /dc/{endpoint}  →  https://discord.com/api/v10/{endpoint}
    // Token via: ?token=TOKEN (query param) or Authorization header
    match: (pathname) => {
      const m = pathname.match(/^\/dc\/(.+)/);
      return m ? { endpoint: m[1] } : null;
    },
    upstream: (params, url) => {
      const u = new URL(`https://discord.com/api/v10/${params.endpoint}`);
      for (const [k, v] of url.searchParams) {
        if (!['token', 'auth_prefix'].includes(k)) u.searchParams.append(k, v);
      }
      return u.toString();
    },
    headers: (params, url, reqHeaders) => {
      // If Authorization already set (e.g. by Hermes), pass it through
      if (reqHeaders.has('Authorization') || reqHeaders.has('authorization')) {
        return null;
      }
      // Otherwise, accept token from query param
      const token = url.searchParams.get('token');
      const prefix = url.searchParams.get('auth_prefix') || 'Bot';
      return token ? { 'Authorization': `${prefix} ${token}` } : null;
    },
  },
};

// ── Landing Page ──────────────────────────────────────────────────────

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Proxy</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0f; color: #e0e0e0;
      min-height: 100vh; display: flex; flex-direction: column;
      align-items: center; justify-content: center; padding: 2rem;
    }
    .status { display: flex; align-items: center; gap: 0.5rem; color: #22c55e; margin-bottom: 2rem; }
    .status-dot { width: 8px; height: 8px; background: #22c55e; border-radius: 50%; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
    h1 { font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem; }
    .subtitle { color: #888; margin-bottom: 2rem; }
    .cards { display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center; margin-bottom: 2rem; }
    .card {
      background: #151520; border: 1px solid #2a2a3a; border-radius: 12px;
      padding: 1.5rem; width: 340px; transition: border-color 0.2s;
    }
    .card:hover { border-color: #3a3a5a; }
    .card-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
    .card-icon { font-size: 1.5rem; }
    .card-title { font-weight: 600; font-size: 1.1rem; }
    .card-desc { color: #888; font-size: 0.875rem; margin-bottom: 1rem; line-height: 1.5; }
    .card-code {
      background: #0d0d15; border-radius: 8px; padding: 0.75rem 1rem;
      font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.8rem;
      color: #6ee7b7; line-height: 1.8; word-break: break-all;
    }
    .footer { color: #555; font-size: 0.8rem; }
    .footer a { color: #6ee7b7; text-decoration: none; }
  </style>
</head>
<body>
  <div class="status"><span class="status-dot"></span>Online</div>
  <h1>Cloudflare API Proxy</h1>
  <p class="subtitle">Transparent proxy for Telegram Bot API &amp; Discord REST API</p>
  <div class="cards">
    <div class="card">
      <div class="card-header"><div class="card-icon">✈️</div><span class="card-title">Telegram Bot API</span></div>
      <p class="card-desc">All bot methods: sendMessage, getMe, sendPhoto, getFile, etc.</p>
      <div class="card-code">/bot&lt;TOKEN&gt;/getMe<br>/bot&lt;TOKEN&gt;/sendMessage</div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-icon">🎮</div><span class="card-title">Discord REST API</span></div>
      <p class="card-desc">Channels, messages, guilds, users — pass token as query param.</p>
      <div class="card-code">/dc/users/@me?token=TOKEN<br>/dc/channels/ID/messages?token=TOKEN</div>
    </div>
  </div>
  <div class="footer">
    Powered by <a href="https://cloudflare.com" target="_blank">Cloudflare Workers</a> ·
    <a href="https://github.com/Marker689/cf-api-proxy" target="_blank">GitHub</a>
  </div>
</body>
</html>`;

// ── Request Handler ───────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    // Landing page
    if (pathname === '/' || pathname === '') {
      return cors(new Response(HTML_PAGE, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }));
    }

    // Health / stats
    if (pathname === '/stats' || pathname === '/health') {
      return cors(new Response(JSON.stringify({
        ok: true,
        services: Object.keys(SERVICES),
        uptime: 'online',
      }), { headers: { 'Content-Type': 'application/json' } }));
    }

    // Try each service
    for (const [name, svc] of Object.entries(SERVICES)) {
      const params = svc.match(pathname);
      if (params) {
        return proxyRequest(request, svc, params, url);
      }
    }

    // 404
    return cors(new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    }));
  },
};

// ── Proxy Logic ───────────────────────────────────────────────────────

async function proxyRequest(request, svc, params, url) {
  // Build upstream URL
  const upstreamUrl = svc.upstream(params, url);

  // Build headers: start with original, strip CF-specific ones, add auth
  const reqHeaders = new Headers(request.headers);
  stripHeaders(reqHeaders);

  // Service-specific auth headers
  const authHeaders = svc.headers ? svc.headers(params, url, reqHeaders) : null;
  if (authHeaders) {
    for (const [k, v] of Object.entries(authHeaders)) {
      reqHeaders.set(k, v);
    }
  }

  // Read body preserving content-type for multipart
  const method = request.method.toUpperCase();
  let body;
  const ct = request.headers.get('content-type') || '';

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (ct.includes('multipart/form-data')) {
      body = await request.arrayBuffer();
      reqHeaders.set('Content-Type', ct);
    } else {
      body = await request.arrayBuffer();
      if (ct) reqHeaders.set('Content-Type', ct);
    }
  }

  try {
    const res = await fetch(upstreamUrl, {
      method: request.method,
      headers: reqHeaders,
      body: body || undefined,
    });

    // Forward response
    const resHeaders = new Headers(res.headers);
    resHeaders.delete('content-encoding'); // CF handles this
    resHeaders.set('Access-Control-Allow-Origin', '*');
    resHeaders.set('Access-Control-Expose-Headers', '*');

    const resBody = await res.arrayBuffer();
    return new Response(resBody, {
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
    });
  } catch (err) {
    return cors(new Response(JSON.stringify({
      ok: false, error: 'Upstream unavailable', details: err.message,
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    }));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function stripHeaders(headers) {
  const forbidden = [
    'host', 'origin', 'referer', 'cookie',
    'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor',
    'x-forwarded-for', 'x-real-ip', 'x-forwarded-proto',
    'content-length', // let fetch set it
  ];
  forbidden.forEach(h => headers.delete(h));
}

function cors(response) {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  response.headers.set('Access-Control-Max-Age', '86400');
  return response;
}

/**
 * Cloudflare API Proxy — Worker
 * Transparent proxy for Telegram Bot API and Discord REST API.
 * Add new services by extending the SERVICES config below.
 */

// ── Service Definitions (extensible) ──────────────────────────────────

const SERVICES = {
  telegram: {
    // /bot{TOKEN}/{method}  →  https://api.telegram.org/bot{TOKEN}/{method}
    // /file/bot{TOKEN}/{path}  →  https://api.telegram.org/file/bot{TOKEN}/{path}
    match: (pathname) => {
      // Bot API methods: /bot{TOKEN}/{method}
      // Also handles PTB double-bot: /bot/bot{TOKEN}/{method} (when base_url ends with /bot)
      // Token may contain ':' or '%3A' (PTB encodes colon in file URLs)
      const botMatch = pathname.match(/^\/bot\/?(?:bot\/)?(\d+(?::|%3A).+?)\/(.+)/);
      if (botMatch) return { token: botMatch[1], method: botMatch[2], file: false };

      // File downloads: /file/bot{TOKEN}/{file_path}
      // Also handles PTB double-bot: /file/bot/bot{TOKEN}/{file_path}
      const fileMatch = pathname.match(/^\/file\/bot\/?(?:bot\/)?(\d+(?::|%3A).+?)\/(.+)/);
      if (fileMatch) return { token: fileMatch[1], method: fileMatch[2], file: true };

      return null;
    },
    upstream: (params, url) => {
      const base = params.file
        ? `https://api.telegram.org/file/bot${params.token}`
        : `https://api.telegram.org/bot${params.token}`;
      const u = new URL(`${base}/${params.method}`);
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
      align-items: center; justify-content: flex-start;
      padding: 3rem 2rem;
    }
    .status { display: flex; align-items: center; gap: 0.5rem; color: #22c55e; margin-bottom: 1.5rem; }
    .status-dot { width: 8px; height: 8px; background: #22c55e; border-radius: 50%; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
    h1 { font-size: 2.2rem; font-weight: 700; margin-bottom: 0.5rem; }
    .subtitle { color: #888; margin-bottom: 2.5rem; font-size: 1.05rem; }
    .cards { display: flex; gap: 1.25rem; flex-wrap: wrap; justify-content: center; margin-bottom: 2.5rem; max-width: 900px; }
    .card {
      background: #151520; border: 1px solid #2a2a3a; border-radius: 14px;
      padding: 1.5rem; flex: 1; min-width: 280px; max-width: 420px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .card:hover { border-color: #4a4a6a; box-shadow: 0 0 20px rgba(110,231,183,0.05); }
    .card-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
    .card-icon { font-size: 1.6rem; }
    .card-title { font-weight: 600; font-size: 1.15rem; }
    .card-desc { color: #999; font-size: 0.875rem; margin-bottom: 1rem; line-height: 1.6; }
    .card-code {
      background: #0d0d15; border-radius: 8px; padding: 0.75rem 1rem;
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; font-size: 0.78rem;
      color: #6ee7b7; line-height: 1.9; word-break: break-all;
    }
    .card-code .comment { color: #555; }
    .card-code .method { color: #f472b6; }
    .card-code .path { color: #60a5fa; }
    .card-code .param { color: #fbbf24; }
    .section-title {
      font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em;
      color: #555; margin-bottom: 0.75rem; margin-top: 1rem;
    }
    .features { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .feature-tag {
      background: #1a1a2a; border: 1px solid #2a2a3a; border-radius: 20px;
      padding: 0.25rem 0.75rem; font-size: 0.75rem; color: #888;
    }
    .endpoints { margin-top: 1rem; }
    .endpoint-row {
      display: flex; gap: 0.5rem; align-items: baseline;
      padding: 0.3rem 0; font-size: 0.8rem;
    }
    .endpoint-method {
      font-family: 'SF Mono', 'Fira Code', monospace;
      background: #1a1a2a; padding: 0.15rem 0.5rem; border-radius: 4px;
      font-size: 0.7rem; font-weight: 600; white-space: nowrap;
    }
    .endpoint-method.get { color: #22c55e; }
    .endpoint-method.post { color: #60a5fa; }
    .endpoint-path { color: #aaa; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.78rem; }
    .endpoint-desc { color: #666; font-size: 0.75rem; }
    .footer { color: #444; font-size: 0.8rem; margin-top: auto; padding-top: 2rem; text-align: center; }
    .footer a { color: #6ee7b7; text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="status"><span class="status-dot"></span>Online</div>
  <h1>Cloudflare API Proxy</h1>
  <p class="subtitle">Transparent proxy for Telegram Bot API &amp; Discord REST API — bypasses geo-blocks via Cloudflare edge</p>

  <div class="cards">
    <!-- Telegram -->
    <div class="card">
      <div class="card-header"><div class="card-icon">✈️</div><span class="card-title">Telegram Bot API</span></div>
      <p class="card-desc">Полный доступ ко всем методам Bot API — обходит блокировку api.telegram.org.</p>
      <div class="features">
        <span class="feature-tag">sendMessage</span>
        <span class="feature-tag">sendPhoto</span>
        <span class="feature-tag">getFile</span>
        <span class="feature-tag">multipart/form-data</span>
      </div>
      <div class="endpoints">
        <div class="section-title">Endpoints</div>
        <div class="endpoint-row">
          <span class="endpoint-method">ANY</span>
          <span class="endpoint-path">/bot<span class="param">&lt;TOKEN&gt;</span>/<span class="param">&lt;method&gt;</span></span>
        </div>
        <div class="endpoint-row">
          <span class="endpoint-method">ANY</span>
          <span class="endpoint-path">/file/bot<span class="param">&lt;TOKEN&gt;</span>/<span class="param">&lt;path&gt;</span></span>
        </div>
      </div>
      <div class="card-code">
        <span class="comment">// Bot API</span><br>
        <span class="method">GET</span> <span class="path">/bot</span><span class="param">{TOKEN}</span><span class="path">/getMe</span><br>
        <span class="method">POST</span> <span class="path">/bot</span><span class="param">{TOKEN}</span><span class="path">/sendMessage</span><br><br>
        <span class="comment">// File downloads</span><br>
        <span class="method">GET</span> <span class="path">/file/bot</span><span class="param">{TOKEN}</span><span class="path">/files/file.jpg</span>
      </div>
    </div>

    <!-- Discord -->
    <div class="card">
      <div class="card-header"><div class="card-icon">🎮</div><span class="card-title">Discord REST API</span></div>
      <p class="card-desc">Полный доступ к Discord API — каналы, сообщения, guilds, пользователи.</p>
      <div class="features">
        <span class="feature-tag">v10 API</span>
        <span class="feature-tag">token query param</span>
        <span class="feature-tag">Authorization header</span>
        <span class="feature-tag">Bearer / Bot prefix</span>
      </div>
      <div class="endpoints">
        <div class="section-title">Endpoints</div>
        <div class="endpoint-row">
          <span class="endpoint-method">ANY</span>
          <span class="endpoint-path">/dc/<span class="param">&lt;endpoint&gt;</span></span>
        </div>
      </div>
      <div class="card-code">
        <span class="comment">// Token via query param</span><br>
        <span class="method">GET</span> <span class="path">/dc/users/@me</span><span class="path">?token=</span><span class="param">{TOKEN}</span><br>
        <span class="method">GET</span> <span class="path">/dc/channels/</span><span class="param">{ID}</span><span class="path">/messages?token=</span><span class="param">{TOKEN}</span><br><br>
        <span class="comment">// Or Authorization header</span><br>
        <span class="method">GET</span> <span class="path">/dc/users/@me</span><br>
        <span class="path">Authorization: Bot {TOKEN}</span>
      </div>
    </div>
  </div>

  <div class="footer">
    Powered by <a href="https://cloudflare.com" target="_blank">Cloudflare Workers</a> ·
    <a href="https://github.com/Marker689/cf-api-proxy" target="_blank">GitHub</a> ·
    <a href="/health">/health</a> ·
    <a href="/stats">/stats</a>
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

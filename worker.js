/**
 * Cloudflare API Proxy — Worker
 * Telegram Bot API + Discord REST API через Cloudflare Workers
 */

const TG_API = 'https://api.telegram.org';
const DISCORD_API = 'https://discord.com/api/v10';

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // Route: /api/tg/...
    if (pathParts[0] === 'api' && pathParts[1] === 'tg') {
      return handleTelegram(request, pathParts.slice(2));
    }

    // Route: /api/dc/...
    if (pathParts[0] === 'api' && pathParts[1] === 'dc') {
      return handleDiscord(request, pathParts.slice(2));
    }

    // Root
    return new Response(
      'Cloudflare API Proxy\n\nEndpoints:\n  /api/tg/<method>?bot_token=TOKEN\n  /api/dc/<endpoint>?token=TOKEN',
      { headers: { 'Content-Type': 'text/plain' } }
    );
  },
};

/**
 * Telegram Bot API Proxy
 */
async function handleTelegram(request, pathParts) {
  const url = new URL(request.url);
  const token = url.searchParams.get('bot_token');

  if (!token) {
    return jsonResp({ ok: false, error_code: 401, description: 'Missing bot_token' }, 401);
  }

  if (pathParts.length === 0) {
    return jsonResp({
      ok: false, error_code: 400,
      description: 'Missing method. Examples: getMe, sendMessage, sendPhoto, getFile',
    }, 400);
  }

  // File download: /api/tg/file/FILE_ID
  if (pathParts[0] === 'file') {
    const fileId = pathParts.slice(1).join('/');
    return handleTelegramFile(token, fileId);
  }

  const method = pathParts.join('/');
  const tgUrl = `${TG_API}/bot${token}/${method}`;

  let body;
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    const ct = request.headers.get('content-type') || '';
    body = ct.includes('application/json') ? await request.json() : await request.text();
  }

  try {
    const res = await fetch(tgUrl, {
      method: request.method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
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

  if (!token) {
    return jsonResp({ error: 'Missing token' }, 401);
  }

  if (pathParts.length === 0) {
    return jsonResp({ error: 'Missing endpoint. Examples: users/@me, channels/ID/messages' }, 400);
  }

  const endpoint = pathParts.join('/');
  const dcUrl = `${DISCORD_API}/${endpoint}`;

  const headers = new Headers({
    'Authorization': `Bot ${token}`,
    'Content-Type': 'application/json',
  });

  let body;
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    const ct = request.headers.get('content-type') || '';
    body = ct.includes('application/json') ? await request.json() : await request.text();
  }

  try {
    const res = await fetch(dcUrl, {
      method: request.method,
      headers,
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
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

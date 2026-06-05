/**
 * Discord API Proxy
 * Прокси для Discord REST API через Cloudflare Pages Functions
 */

const DISCORD_API = 'https://discord.com/api/v10';

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const { path } = params;

  // Get Discord token from query param
  const token = url.searchParams.get('token');
  if (!token) {
    return new Response(JSON.stringify({
      error: 'Missing token query parameter. Usage: /api/dc/users/@me?token=YOUR_TOKEN',
    }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  if (!path || path.length === 0) {
    return new Response(JSON.stringify({
      error: 'Missing API endpoint. Examples: users/@me, channels/ID/messages, guilds/ID/members',
    }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const endpoint = path.join('/');
  const discordUrl = `${DISCORD_API}/${endpoint}`;

  // Build headers
  const headers = new Headers();
  headers.set('Authorization', `Bot ${token}`);
  headers.set('Content-Type', 'application/json');

  // Forward relevant headers
  const userAgent = request.headers.get('user-agent');
  if (userAgent) headers.set('User-Agent', userAgent);

  // Parse body for POST/PUT/PATCH
  let body;
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      body = await request.text();
    }
  }

  try {
    const response = await fetch(discordUrl, {
      method: request.method,
      headers,
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return new Response(JSON.stringify(data), {
        status: response.status,
        headers: responseHeaders,
      });
    } else {
      const data = await response.arrayBuffer();
      return new Response(data, {
        status: response.status,
        headers: responseHeaders,
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Failed to reach Discord API',
      details: error.message,
    }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}

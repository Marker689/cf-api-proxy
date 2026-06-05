/**
 * Telegram Bot API Proxy
 * Прокси для Telegram Bot API через Cloudflare Pages Functions
 */

const TG_API = 'https://api.telegram.org';

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const { path } = params;

  // Get bot token from query param
  const token = url.searchParams.get('bot_token');
  if (!token) {
    return new Response(JSON.stringify({
      ok: false,
      error_code: 401,
      description: 'Missing bot_token query parameter. Usage: /api/tg/getMe?bot_token=YOUR_TOKEN'
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
      ok: false,
      error_code: 400,
      description: 'Missing API method. Examples: getMe, sendMessage, sendPhoto, getFile'
    }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // Handle file downloads: /api/tg/file/FILE_ID?bot_token=TOKEN
  if (path[0] === 'file') {
    const fileId = path.slice(1).join('/');
    return proxyFileDownload(token, fileId, request);
  }

  // Regular API method: /api/tg/sendMessage?bot_token=TOKEN
  const method = path.join('/');
  const tgUrl = `${TG_API}/bot${token}/${method}`;

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
    const response = await fetch(tgUrl, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error_code: 502,
      description: `Failed to reach Telegram API: ${error.message}`
    }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}

/**
 * Proxy file downloads from Telegram
 */
async function proxyFileDownload(token, fileId, request) {
  // First, get the file path via getFile
  const getFileUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`;

  try {
    const infoResponse = await fetch(getFileUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const info = await infoResponse.json();

    if (!info.ok) {
      return new Response(JSON.stringify(info), {
        status: info.error_code || 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Download the file from Telegram
    const fileUrl = `https://api.telegram.org/file/bot${token}/${info.result.file_path}`;

    const fileResponse = await fetch(fileUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CFProxy/1.0)',
      },
    });

    if (!fileResponse.ok) {
      return new Response(`File download failed: ${fileResponse.status}`, {
        status: fileResponse.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    const arrayBuffer = await fileResponse.arrayBuffer();

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': fileResponse.headers.get('content-type') || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileId}"`,
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error_code: 502,
      description: `Failed to download file: ${error.message}`
    }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}

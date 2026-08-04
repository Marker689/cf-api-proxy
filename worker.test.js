import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from './worker.js';

// Mock the upstream. Each call records { url, method, headers, body } so the
// proxy's forwarding behaviour can be asserted precisely.
const calls = [];

function mockUpstream(bodyFactory = (c) => new Response('upstream', { status: 200 })) {
  return vi.fn(async (url, init) => {
    const record = {
      url: String(url),
      method: init.method,
      headers: new Headers(init.headers),
      body: init.body == null ? null : init.body,
    };
    calls.push(record);
    return bodyFactory(record);
  });
}

async function call(pathname = '/', init = {}) {
  const req = new Request('https://proxy.test' + pathname, init);
  return worker.fetch(req, {}, {});
}

let fetchMock;

beforeEach(() => {
  calls.length = 0;
  fetchMock = mockUpstream();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.fetch;
});

describe('service routing', () => {
  it('telegram: routes /bot{token}/{method} and forwards query params', async () => {
    const res = await call('/bot123:ABC/getMe?foo=bar');
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe('https://api.telegram.org/bot123:ABC/getMe?foo=bar');
    expect(calls[0].method).toBe('GET');
  });

  it('telegram: routes /file/bot{token}/{path} file downloads', async () => {
    await call('/file/bot123:ABC/files/photo.jpg');
    expect(calls[0].url).toBe('https://api.telegram.org/file/bot123:ABC/files/photo.jpg');
  });

  it('discord: converts ?token= to Bot Authorization header and strips it from query', async () => {
    await call('/dc/users/@me?token=SECRET&limit=5');
    expect(calls[0].url).toBe('https://discord.com/api/v10/users/@me?limit=5');
    expect(calls[0].headers.get('Authorization')).toBe('Bot SECRET');
  });

  it('discord: honors auth_prefix param (e.g. Bearer)', async () => {
    await call('/dc/users/@me?token=SECRET&auth_prefix=Bearer');
    expect(calls[0].headers.get('Authorization')).toBe('Bearer SECRET');
  });

  it('discord: passes through an existing Authorization header', async () => {
    await call('/dc/users/@me', { headers: { Authorization: 'Bot MINE' } });
    expect(calls[0].headers.get('Authorization')).toBe('Bot MINE');
    expect(calls[0].url).toBe('https://discord.com/api/v10/users/@me');
  });

  it('anthropic: routes to /v1 and injects anthropic-version, keeps x-api-key', async () => {
    await call('/claude/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'KEY', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0].headers.get('x-api-key')).toBe('KEY');
    expect(calls[0].headers.get('anthropic-version')).toBe('2023-06-01');
  });

  it('anthropic: does not override a client-provided anthropic-version', async () => {
    await call('/claude/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'KEY', 'anthropic-version': '2023-06-01' },
      body: '{}',
    });
    expect(calls[0].headers.get('anthropic-version')).toBe('2023-06-01');
  });

  it('openai: routes transparently and passes Authorization Bearer', async () => {
    await call('/openai/models', { headers: { Authorization: 'Bearer KEY' } });
    expect(calls[0].url).toBe('https://api.openai.com/v1/models');
    expect(calls[0].headers.get('Authorization')).toBe('Bearer KEY');
    expect(calls[0].headers.get('anthropic-version')).toBeNull();
  });

  it('forwards the request body and Content-Type verbatim (multipart ok)', async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    await call('/bot123:ABC/sendPhoto', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': '4' },
      body,
    });
    expect(calls[0].headers.get('Content-Type')).toBe('multipart/form-data; boundary=x');
    expect([...new Uint8Array(calls[0].body)]).toEqual([...body]);
  });
});

describe('landing / errors', () => {
  it('serves the landing page with all four cards', async () => {
    const res = await call('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Cloudflare API Proxy');
    expect(html).toContain('Anthropic API');
    expect(html).toContain('OpenAI API');
  });

  it('returns 404 for an unknown route (no fetch sent)', async () => {
    const res = await call('/nope/x');
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('response streaming', () => {
  it('passes through the upstream body as a stream (SSE not buffered)', async () => {
    const sseChunks = ['data: {"a":1}\n\n', 'data: {"b":2}\n\n'];
    globalThis.fetch = mockUpstream(() => {
      const stream = new ReadableStream({
        start(controller) {
          for (const c of sseChunks) controller.enqueue(new TextEncoder().encode(c));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

    const res = await call('/openai/chat/completions', { headers: { Authorization: 'Bearer K' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const text = await res.text();
    expect(text).toBe(sseChunks.join(''));
  });
});

//Anonymous

const URL_PATH_REGEX = /^\/bot(?<bot_token>[^/]+)\/(?<api_method>[a-zA-Z0-9_]+)/i;

const RATE_LIMITS = {
    IP: { max: 100, window: 60000 },
    TOKEN: { max: 200, window: 60000 },
    GLOBAL: { max: 5000, window: 60000 },
    BURST: { max: 10, window: 1000 }
};

const CIRCUIT_BREAKER = {
    FAILURE_THRESHOLD: 5,
    TIMEOUT: 30000,
    HALF_OPEN_MAX_CALLS: 3
};

const RETRY_CONFIG = {
    MAX_RETRIES: 3,
    INITIAL_DELAY: 1000,
    MAX_DELAY: 8000,
    BACKOFF_FACTOR: 2
};

const requestCounters = {
    ip: new Map(),
    token: new Map(),
    burst: new Map(),
    global: { count: 0, resetTime: Date.now() + RATE_LIMITS.GLOBAL.window }
};

const circuitBreakers = new Map();
const tokenValidationCache = new Map();
const suspiciousIPs = new Map();
const CACHE_TTL = 300000;
const SUSPICIOUS_THRESHOLD = 10;

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
const MAX_BODY_SIZE = 50 * 1024 * 1024;
const ALLOWED_COUNTRIES = [];
const BLOCKED_COUNTRIES = [];
const ALLOWED_USER_AGENTS = /telegram|bot|curl|postman|httpie|axios|fetch/i;
const BLOCKED_USER_AGENTS = /scanner|crawler|spider|bot.*attack|sqlmap|nikto|nmap/i;

const TELEGRAM_ENDPOINTS = [
    'api.telegram.org',
    'api.telegram.org:443',
    'api.telegram.org:80'
];

const CACHE_CONFIGS = {
    getChatMember: { ttl: 300, edge: true },
    getMe: { ttl: 3600, edge: true },
    getUpdates: { ttl: 0, edge: false },
    sendMessage: { ttl: 0, edge: false },
    sendPhoto: { ttl: 0, edge: false },
    sendDocument: { ttl: 0, edge: false },
    sendVideo: { ttl: 0, edge: false },
    sendAudio: { ttl: 0, edge: false },
    sendVoice: { ttl: 0, edge: false },
    sendAnimation: { ttl: 0, edge: false },
    sendSticker: { ttl: 0, edge: false },
    sendVideoNote: { ttl: 0, edge: false },
    sendMediaGroup: { ttl: 0, edge: false },
    getChat: { ttl: 600, edge: true },
    getChatAdministrators: { ttl: 1800, edge: true }
};

const MALICIOUS_PATTERNS = [
    /(\.\.|\/\.\/|\\\.\\|%2e%2e|%252e%252e)/i,
    /<script[^>]*>.*?<\/script>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /onload\s*=/gi,
    /onerror\s*=/gi,
    /eval\s*\(/gi,
    /union\s+select/gi,
    /(\bor\b|\band\b)\s+\d+\s*=\s*\d+/gi
];

const FILE_UPLOAD_METHODS = new Set([
    'sendPhoto', 'sendDocument', 'sendVideo', 'sendAudio', 
    'sendVoice', 'sendAnimation', 'sendSticker', 'sendVideoNote', 
    'sendMediaGroup', 'setChatPhoto', 'uploadStickerFile',
    'createNewStickerSet', 'addStickerToSet', 'setStickerSetThumb'
]);

let stats = {
  startTime: Date.now(),
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  rateLimited: 0,
  blocked: 0,
  retries: 0,
  avgResponseTime: 0,
  lastReset: Date.now()
};

function handleStatsRequest() {
  const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
  const successfulRequests = stats.totalRequests - stats.failedRequests - stats.blocked - stats.rateLimited;
  
  return new Response(JSON.stringify({
    ok: true,
    uptime,
    totalRequests: stats.totalRequests,
    successfulRequests: successfulRequests,
    failedRequests: stats.failedRequests,
    rateLimited: stats.rateLimited,
    blocked: stats.blocked,
    retries: stats.retries,
    avgLatency: Math.floor(stats.avgResponseTime)
  }), {
    status: 200,
    headers: { 
      'content-type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function handleRootRequest(request) {
  const workerUrl = new URL(request.url).origin;
  const apiUrl = workerUrl + '/bot';
  
  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Telegram API Proxy - Status Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
            color: #c9d1d9;
            min-height: 100vh;
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }
        
        .container {
            max-width: 800px;
            width: 100%;
            animation: fadeIn 0.6s ease-in;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
        }
        
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            background: rgba(35, 134, 54, 0.15);
            border: 1px solid #238636;
            padding: 12px 24px;
            border-radius: 50px;
            margin-bottom: 20px;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }
        
        .status-light {
            width: 12px;
            height: 12px;
            background: #3fb950;
            border-radius: 50%;
            box-shadow: 0 0 20px #3fb950;
            animation: blink 1.5s infinite;
        }
        
        @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
        }
        
        .status-text {
            color: #3fb950;
            font-weight: 600;
            font-size: 14px;
        }
        
        h1 {
            font-size: 2.5em;
            color: #fff;
            margin-bottom: 10px;
        }
        
        .card {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 30px;
            margin-bottom: 20px;
            transition: all 0.3s ease;
        }
        
        .card:hover {
            border-color: #58a6ff;
            box-shadow: 0 8px 24px rgba(88, 166, 255, 0.1);
            transform: translateY(-2px);
        }
        
        .card-title {
            font-size: 1.3em;
            color: #fff;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .icon {
            width: 24px;
            height: 24px;
        }
        
        .url-container {
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 8px;
            padding: 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            direction: ltr;
            text-align: left;
        }
        
        .url-text {
            flex: 1;
            font-family: 'Courier New', monospace;
            color: #79c0ff;
            font-size: 0.95em;
            word-break: break-all;
        }
        
        .copy-btn {
            background: #238636;
            color: #fff;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.2s;
            white-space: nowrap;
        }
        
        .copy-btn:hover {
            background: #2ea043;
            transform: scale(1.05);
        }
        
        .copy-btn:active {
            transform: scale(0.95);
        }
        
        .copy-btn.copied {
            background: #1f6feb;
        }
        
        .test-btn {
            background: #1f6feb;
            color: #fff;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            font-size: 1em;
            transition: all 0.2s;
            width: 100%;
        }
        
        .test-btn:hover {
            background: #388bfd;
        }
        
        .test-result {
            margin-top: 15px;
            padding: 15px;
            border-radius: 8px;
            display: none;
        }
        
        .test-result.success {
            background: rgba(35, 134, 54, 0.15);
            border: 1px solid #238636;
            color: #3fb950;
        }
        
        .test-result.error {
            background: rgba(248, 81, 73, 0.15);
            border: 1px solid #f85149;
            color: #f85149;
        }
        
        .footer {
            text-align: center;
            margin-top: 40px;
            padding: 20px;
            color: #8b949e;
            font-size: 0.9em;
        }
        
        .footer a {
            color: #58a6ff;
            text-decoration: none;
        }
        
        .loading {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid #30363d;
            border-top-color: #58a6ff;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        @media (max-width: 600px) {
            h1 { font-size: 1.8em; }
            .card { padding: 20px; }
            .url-container { flex-direction: column; }
            .copy-btn { width: 100%; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="status-badge">
                <span class="status-light"></span>
                <span class="status-text">API فعال و آماده</span>
            </div>
            <h1>Telegram API Proxy</h1>
        </div>
        
        <div class="card">
            <div class="card-title">
                <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
                آدرس API
            </div>
            <div class="url-container">
                <span class="url-text" id="apiUrl">${apiUrl}</span>
                <button class="copy-btn" onclick="copyToClipboard()">کپی</button>
            </div>
        </div>
        
        <div class="card">
            <div class="card-title">
                <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
                وضعیت اتصال
            </div>
            <button class="test-btn" onclick="testAPI()">
                <span id="testBtnText">تست اتصال API</span>
            </button>
            <div class="test-result" id="testResult"></div>
        </div>
        
        <div class="footer">
            <p>Powered by Cloudflare Workers</p>
            <p style="margin-top: 10px;">Designed by: <strong>Anonymous</strong></p>
        </div>
    </div>
    
    <script>
        function copyToClipboard() {
            const text = document.getElementById('apiUrl').textContent;
            const btn = event.target;
            
            navigator.clipboard.writeText(text).then(() => {
                const originalText = btn.textContent;
                btn.textContent = 'کپی شد';
                btn.classList.add('copied');
                
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.classList.remove('copied');
                }, 2000);
            });
        }
        
        async function testAPI() {
            const btn = document.getElementById('testBtnText');
            const result = document.getElementById('testResult');
            
            btn.innerHTML = '<span class="loading"></span> در حال تست...';
            result.style.display = 'none';
            
            try {
                const start = Date.now();
                const response = await fetch('/stats');
                const latency = Date.now() - start;
                const data = await response.json();
                
                if (data.ok) {
                    result.className = 'test-result success';
                    result.innerHTML = 'اتصال موفق - پینگ: ' + latency + 'ms' + ' (میانگین API: ' + data.avgLatency + 'ms)';
                } else {
                    throw new Error('Test failed');
                }
            } catch (error) {
                result.className = 'test-result error';
                result.innerHTML = 'خطا در اتصال به API';
            }
            
            result.style.display = 'block';
            btn.textContent = 'تست اتصال API';
        }
        
        document.querySelectorAll('.card').forEach((card, index) => {
            card.style.animationDelay = (index * 0.1) + 's';
        });
    </script>
</body>
</html>`;
  
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}

async function handle404Request() {
  return new Response(JSON.stringify({
    ok: false,
    error_code: 404,
    description: 'Invalid endpoint. Please check Telegram Bot API documentation.'
  }), {
    status: 404,
    headers: { 'content-type': 'application/json' }
  });
}

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const { pathname } = new URL(request.url);

  if (pathname === '/stats') {
    return handleStatsRequest();
  }
  
  if (pathname === '/') {
    return handleRootRequest(request);
  }

  if (request.method === 'OPTIONS') {
    return handleCorsPreflightRequest();
  }

  if (URL_PATH_REGEX.test(pathname)) {
    const startTime = Date.now();
    try {
        await cleanupExpiredData();
        
        const securityCheck = await performAdvancedSecurityChecks(request);
        if (securityCheck.blocked) {
            stats.blocked++;
            return createErrorResponse(securityCheck.reason, securityCheck.status);
        }

        const requestInfo = await parseRequest(request);
        if (!requestInfo.valid) {
            stats.blocked++;
            return createErrorResponse('Invalid request format', 400);
        }

        const circuitState = checkCircuitBreaker(requestInfo.clientIP);
        if (circuitState === 'OPEN') {
            return createErrorResponse('Service temporarily unavailable', 503);
        }

        const rateLimitResult = await checkAdvancedRateLimit(requestInfo.clientIP, requestInfo.botToken);
        if (rateLimitResult.limited) {
            stats.rateLimited++;
            return createRateLimitResponse(rateLimitResult.retryAfter);
        }

        const tokenValid = await validateBotTokenAdvanced(requestInfo.botToken);
        if (!tokenValid) {
            await recordSuspiciousActivity(requestInfo.clientIP, 'invalid_token');
            stats.blocked++;
            return createErrorResponse('Invalid bot token', 401);
        }

        const response = await proxyToTelegramWithRetry(request, requestInfo);
        
        updateCircuitBreaker(requestInfo.clientIP, response.ok);
        updateStats(startTime, response.ok);

        return response;

    } catch (error) {
        console.error('Proxy error:', error);
        stats.failedRequests++;
        updateCircuitBreaker(getClientIP(request), false);
        return handleProxyError(error);
    }
  }
  
  return handle404Request();
}

async function cleanupExpiredData() {
    const now = Date.now();
    
    for (const [token, data] of tokenValidationCache.entries()) {
        if (now >= data.expires) {
            tokenValidationCache.delete(token);
        }
    }
    
    for (const [ip, data] of suspiciousIPs.entries()) {
        if (now >= data.expires) {
            suspiciousIPs.delete(ip);
        }
    }
    
    for (const [key, breaker] of circuitBreakers.entries()) {
        if (now - breaker.lastFailureTime > CIRCUIT_BREAKER.TIMEOUT) {
            breaker.state = 'CLOSED';
            breaker.failureCount = 0;
        }
    }
    
    if (now - stats.lastReset > 3600000) {
        stats.totalRequests = 0;
        stats.failedRequests = 0;
        stats.rateLimited = 0;
        stats.blocked = 0;
        stats.retries = 0;
        stats.lastReset = now;
        stats.avgResponseTime = 0;
    }
}

async function performAdvancedSecurityChecks(request) {
    const clientIP = getClientIP(request);
    const userAgent = request.headers.get('user-agent') || '';
    const country = request.headers.get('cf-ipcountry');
    const referer = request.headers.get('referer') || '';
    const contentType = request.headers.get('content-type') || '';

    if (!ALLOWED_METHODS.includes(request.method)) {
        return { blocked: true, reason: 'Method not allowed', status: 405 };
    }

    const contentLength = request.headers.get('content-length');
    if (contentLength) {
        const bodySize = parseInt(contentLength);
        if (bodySize > MAX_BODY_SIZE) {
            return { blocked: true, reason: 'Request too large', status: 413 };
        }
    }

    if (ALLOWED_COUNTRIES.length > 0) {
        if (!ALLOWED_COUNTRIES.includes(country)) {
            return { blocked: true, reason: 'Geographic restriction', status: 403 };
        }
    } else if (BLOCKED_COUNTRIES.length > 0) {
        if (BLOCKED_COUNTRIES.includes(country)) {
            return { blocked: true, reason: 'Geographic restriction', status: 403 };
        }
    }

    if (BLOCKED_USER_AGENTS.test(userAgent)) {
        await recordSuspiciousActivity(clientIP, 'blocked_user_agent');
        return { blocked: true, reason: 'Blocked user agent', status: 403 };
    }

    if (!ALLOWED_USER_AGENTS.test(userAgent) && userAgent.length < 10) {
        await recordSuspiciousActivity(clientIP, 'suspicious_user_agent');
        return { blocked: true, reason: 'Invalid user agent', status: 403 };
    }

    const suspicious = suspiciousIPs.get(clientIP);
    if (suspicious && suspicious.count >= SUSPICIOUS_THRESHOLD) {
        return { blocked: true, reason: 'IP temporarily blocked', status: 429 };
    }

    const url = new URL(request.url);
    const fullPath = url.pathname + url.search;
    
    for (const pattern of MALICIOUS_PATTERNS) {
        if (pattern.test(fullPath) || pattern.test(referer)) {
            await recordSuspiciousActivity(clientIP, 'malicious_pattern');
            return { blocked: true, reason: 'Malicious request detected', status: 400 };
        }
    }

    if (request.method === 'POST' && contentType.includes('multipart/form-data')) {
        const boundary = contentType.split('boundary=')[1];
        if (boundary && boundary.length > 200) {
            return { blocked: true, reason: 'Invalid multipart boundary', status: 400 };
        }
    }

    const xForwardedFor = request.headers.get('x-forwarded-for');
    if (xForwardedFor && xForwardedFor.split(',').length > 10) {
        await recordSuspiciousActivity(clientIP, 'excessive_forwarded_headers');
        return { blocked: true, reason: 'Suspicious request headers', status: 400 };
    }

    return { blocked: false };
}

async function recordSuspiciousActivity(ip, type) {
    const now = Date.now();
    const existing = suspiciousIPs.get(ip) || { count: 0, types: new Set(), expires: now + 3600000 };
    
    existing.count++;
    existing.types.add(type);
    existing.lastActivity = now;
    
    suspiciousIPs.set(ip, existing);
}

async function parseRequest(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const clientIP = getClientIP(request);
    
    if (!URL_PATH_REGEX.test(path)) {
        return { valid: false };
    }
    
    const match = path.match(URL_PATH_REGEX);
    const botToken = match?.groups?.bot_token || '';
    const apiMethod = match?.groups?.api_method || '';
    
    if (botToken.length > 200 || apiMethod.length > 50) {
        return { valid: false };
    }
    
    return {
        valid: true,
        clientIP,
        botToken,
        apiMethod,
        path,
        url
    };
}

function getClientIP(request) {
    const cfIP = request.headers.get('cf-connecting-ip');
    if (cfIP) return cfIP;
    
    const xForwardedFor = request.headers.get('x-forwarded-for');
    if (xForwardedFor) {
        const firstIP = xForwardedFor.split(',')[0]?.trim();
        if (firstIP && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(firstIP)) {
            return firstIP;
        }
    }
    
    return request.headers.get('x-real-ip') || 'unknown';
}

async function checkAdvancedRateLimit(clientIP, botToken) {
    const now = Date.now();
    
    cleanupCounters(now);
    
    if (requestCounters.global.count >= RATE_LIMITS.GLOBAL.max) {
        const retryAfter = Math.ceil((requestCounters.global.resetTime - now) / 1000);
        return { limited: true, retryAfter };
    }
    
    const burstKey = `burst_${clientIP}`;
    const burstCount = getCounterValue(requestCounters.burst, burstKey, now, RATE_LIMITS.BURST.window);
    if (burstCount >= RATE_LIMITS.BURST.max) {
        return { limited: true, retryAfter: 1 };
    }
    
    const ipKey = `ip_${clientIP}`;
    const ipCount = getCounterValue(requestCounters.ip, ipKey, now, RATE_LIMITS.IP.window);
    if (ipCount >= RATE_LIMITS.IP.max) {
        return { limited: true, retryAfter: 60 };
    }
    
    const tokenKey = `token_${botToken}`;
    const tokenCount = getCounterValue(requestCounters.token, tokenKey, now, RATE_LIMITS.TOKEN.window);
    if (tokenCount >= RATE_LIMITS.TOKEN.max) {
        return { limited: true, retryAfter: 60 };
    }
    
    incrementCounter(requestCounters.burst, burstKey, now, RATE_LIMITS.BURST.window);
    incrementCounter(requestCounters.ip, ipKey, now, RATE_LIMITS.IP.window);
    incrementCounter(requestCounters.token, tokenKey, now, RATE_LIMITS.TOKEN.window);
    requestCounters.global.count++;
    
    return { limited: false };
}

function cleanupCounters(now) {
    if (now >= requestCounters.global.resetTime) {
        requestCounters.global.count = 0;
        requestCounters.global.resetTime = now + RATE_LIMITS.GLOBAL.window;
    }
    
    const counterMaps = [requestCounters.ip, requestCounters.token, requestCounters.burst];
    
    for (const counterMap of counterMaps) {
        for (const [key, data] of counterMap.entries()) {
            if (now >= data.resetTime) {
                counterMap.delete(key);
            }
        }
    }
}

function getCounterValue(counterMap, key, now, window = RATE_LIMITS.IP.window) {
    const data = counterMap.get(key);
    if (!data || now >= data.resetTime) {
        return 0;
    }
    return data.count;
}

function incrementCounter(counterMap, key, now, window = RATE_LIMITS.IP.window) {
    const existing = counterMap.get(key);
    if (!existing || now >= existing.resetTime) {
        counterMap.set(key, {
            count: 1,
            resetTime: now + window
        });
    } else {
        existing.count++;
    }
}

function checkCircuitBreaker(clientIP) {
    const breaker = circuitBreakers.get(clientIP);
    if (!breaker) return 'CLOSED';
    
    const now = Date.now();
    
    if (breaker.state === 'OPEN') {
        if (now - breaker.lastFailureTime >= CIRCUIT_BREAKER.TIMEOUT) {
            breaker.state = 'HALF_OPEN';
            breaker.halfOpenAttempts = 0;
            return 'HALF_OPEN';
        }
        return 'OPEN';
    }
    
    if (breaker.state === 'HALF_OPEN') {
        if (breaker.halfOpenAttempts >= CIRCUIT_BREAKER.HALF_OPEN_MAX_CALLS) {
            return 'OPEN';
        }
        breaker.halfOpenAttempts++;
    }
    
    return breaker.state;
}

function updateCircuitBreaker(clientIP, success) {
    let breaker = circuitBreakers.get(clientIP);
    if (!breaker) {
        breaker = {
            state: 'CLOSED',
            failureCount: 0,
            lastFailureTime: 0,
            halfOpenAttempts: 0
        };
        circuitBreakers.set(clientIP, breaker);
    }
    
    if (success) {
        if (breaker.state === 'HALF_OPEN') {
            breaker.state = 'CLOSED';
            breaker.failureCount = 0;
        } else if (breaker.state === 'CLOSED') {
            breaker.failureCount = Math.max(0, breaker.failureCount - 1);
        }
    } else {
        breaker.failureCount++;
        breaker.lastFailureTime = Date.now();
        
        if (breaker.failureCount >= CIRCUIT_BREAKER.FAILURE_THRESHOLD) {
            breaker.state = 'OPEN';
        }
    }
}

async function validateBotTokenAdvanced(token) {
    const cached = tokenValidationCache.get(token);
    if (cached && Date.now() < cached.expires) {
        return cached.valid;
    }
    
    try {
        if (!token || token.length < 40 || token.length > 200 || !token.includes(':')) {
            tokenValidationCache.set(token, { valid: false, expires: Date.now() + CACHE_TTL });
            return false;
        }
        
        const [botId, botHash] = token.split(':');
        if (!botId || !botHash || botId.length < 8 || botHash.length < 30) {
            tokenValidationCache.set(token, { valid: false, expires: Date.now() + CACHE_TTL });
            return false;
        }
        
        if (!/^\d+$/.test(botId)) {
            tokenValidationCache.set(token, { valid: false, expires: Date.now() + CACHE_TTL });
            return false;
        }
        
        if (!/^[A-Za-z0-9_-]+$/.test(botHash)) {
            tokenValidationCache.set(token, { valid: false, expires: Date.now() + CACHE_TTL });
            return false;
        }
        
        tokenValidationCache.set(token, { valid: true, expires: Date.now() + CACHE_TTL });
        return true;
        
    } catch (error) {
        console.error('Token validation error:', error);
        return false;
    }
}

async function proxyToTelegramWithRetry(request, requestInfo) {
    let lastError;
    
    for (let attempt = 0; attempt <= RETRY_CONFIG.MAX_RETRIES; attempt++) {
        try {
            if (attempt > 0) {
                stats.retries++;
                const delay = Math.min(
                    RETRY_CONFIG.INITIAL_DELAY * Math.pow(RETRY_CONFIG.BACKOFF_FACTOR, attempt - 1),
                    RETRY_CONFIG.MAX_DELAY
                );
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            
            const response = await proxyToTelegram(request, requestInfo, attempt);
            
            if (response.ok || response.status < 500) {
                return response;
            }
            
            lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
            
        } catch (error) {
            lastError = error;
            
            if (error.name === 'AbortError' || error.message.includes('timeout')) {
                continue;
            }
            
            if (attempt === RETRY_CONFIG.MAX_RETRIES) {
                throw error;
            }
        }
    }
    
    throw lastError || new Error('Max retries exceeded');
}

async function proxyToTelegram(request, requestInfo, attempt = 0) {
    const { apiMethod, path } = requestInfo;
    
    const endpointIndex = attempt % TELEGRAM_ENDPOINTS.length;
    const endpoint = TELEGRAM_ENDPOINTS[endpointIndex];
    
    const newUrl = new URL(request.url);
    newUrl.hostname = endpoint.split(':')[0];
    newUrl.port = endpoint.includes(':') ? endpoint.split(':')[1] : '';
    newUrl.pathname = path;
    
    const requestHeaders = new Headers(request.headers);
    sanitizeHeaders(requestHeaders);
    
    requestHeaders.set('Connection', 'keep-alive');
    requestHeaders.set('User-Agent', 'Cloudflare-Worker-Proxy/1.1');
    requestHeaders.set('Cache-Control', 'no-cache');
    requestHeaders.set('X-Forwarded-Proto', 'https');
    
    let requestBody;
    let contentType = request.headers.get('content-type') || '';
    
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        try {
            if (contentType.includes('multipart/form-data') || FILE_UPLOAD_METHODS.has(apiMethod)) {
                const formData = await request.formData();
                requestBody = formData;
                requestHeaders.delete('content-type');
            } else {
                requestBody = await request.arrayBuffer();
                if (request.method === 'POST' && !contentType) {
                    requestHeaders.set('Content-Type', 'application/json');
                } else if (contentType) {
                    requestHeaders.set('Content-Type', contentType);
                }
            }
        } catch (error) {
            throw new Error('Failed to read request body');
        }
    }
    
    const controller = new AbortController();
    const timeoutDuration = FILE_UPLOAD_METHODS.has(apiMethod) ? 120000 : 30000;
    const timeout = setTimeout(() => controller.abort(), timeoutDuration);
    
    try {
        const newRequest = new Request(newUrl.toString(), {
            method: request.method,
            headers: requestHeaders,
            body: requestBody,
            redirect: 'follow',
            signal: controller.signal
        });
        
        const cacheConfig = CACHE_CONFIGS[apiMethod] || { ttl: 0, edge: false };
        
        const fetchTimeout = FILE_UPLOAD_METHODS.has(apiMethod) ? 100000 : 25000;
        
        const response = await fetch(newRequest, {
            cf: {
                cacheTtl: cacheConfig.ttl,
                cacheEverything: cacheConfig.edge && request.method === 'GET',
                polish: 'off',
                minify: {
                    javascript: false,
                    css: false,
                    html: false
                },
                timeout: fetchTimeout
            }
        });
        
        if (!response.ok && response.status >= 500) {
            throw new Error(`Server error: ${response.status}`);
        }
        
        const responseHeaders = new Headers(response.headers);
        addAdvancedSecurityHeaders(responseHeaders);
        
        const responseBody = await response.arrayBuffer();
        
        return new Response(responseBody, {
            status: response.status,
            statusText: response.statusText,
            headers: getCorsHeaders(responseHeaders)
        });
        
    } finally {
        clearTimeout(timeout);
    }
}

function sanitizeHeaders(headers) {
    const forbiddenHeaders = [
        'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor',
        'x-forwarded-for', 'x-real-ip', 'x-forwarded-proto',
        'host', 'origin', 'referer', 'cookie', 'authorization'
    ];
    
    forbiddenHeaders.forEach(header => headers.delete(header));
    
    for (const [key] of headers) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.startsWith('cf-') || 
            lowerKey.startsWith('x-') || 
            lowerKey.startsWith('sec-') ||
            lowerKey.includes('proxy')) {
            headers.delete(key);
        }
    }
    
    return headers;
}

function addAdvancedSecurityHeaders(headers) {
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-XSS-Protection', '1; mode=block');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Content-Security-Policy', "default-src 'none'; script-src 'none'; object-src 'none'");
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    headers.set('X-Permitted-Cross-Domain-Policies', 'none');
    headers.set('X-Download-Options', 'noopen');
    headers.set('X-DNS-Prefetch-Control', 'off');
    headers.set('Feature-Policy', "geolocation 'none'; microphone 'none'; camera 'none'");
}

function getCorsHeaders(headers = new Headers()) {
    const corsHeaders = new Headers(headers);
    corsHeaders.set('Access-Control-Allow-Origin', '*');
    corsHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    corsHeaders.set('Access-Control-Expose-Headers', 'X-RateLimit-Remaining, X-RateLimit-Reset, X-Response-Time');
    corsHeaders.set('Access-Control-Max-Age', '86400');
    corsHeaders.set('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
    
    return corsHeaders;
}

function handleCorsPreflightRequest() {
    return new Response(null, {
        status: 204,
        headers: getCorsHeaders()
    });
}

function createErrorResponse(message, status = 400) {
    const headers = getCorsHeaders();
    headers.set('Content-Type', 'application/json');
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    
    return new Response(JSON.stringify({ 
        ok: false, 
        error: message,
        error_code: status,
        timestamp: new Date().toISOString(),
        request_id: generateRequestId()
    }), {
        status,
        headers
    });
}

function createRateLimitResponse(retryAfter) {
    const headers = getCorsHeaders();
    headers.set('Content-Type', 'application/json');
    headers.set('Retry-After', retryAfter.toString());
    headers.set('X-RateLimit-Remaining', '0');
    headers.set('X-RateLimit-Reset', (Date.now() + (retryAfter * 1000)).toString());
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    
    return new Response(JSON.stringify({ 
        ok: false, 
        error: 'Rate limit exceeded. Please try again later.',
        retry_after: retryAfter,
        timestamp: new Date().toISOString(),
        request_id: generateRequestId()
    }), {
        status: 429,
        headers
    });
}

function handleProxyError(error) {
    const errorMessage = error.message || 'Unknown error occurred';
    const isTimeout = error.name === 'AbortError' || errorMessage.includes('timeout');
    const status = isTimeout ? 504 : 500;
    
    const headers = getCorsHeaders();
    headers.set('Content-Type', 'application/json');
    
    return new Response(JSON.stringify({ 
        ok: false, 
        error: isTimeout ? 'Gateway timeout' : 'Proxy service temporarily unavailable',
        details: errorMessage.substring(0, 200),
        timestamp: new Date().toISOString(),
        request_id: generateRequestId()
    }), {
        status,
        headers
    });
}

function updateStats(startTime, success) {
    const responseTime = Date.now() - startTime;
    stats.totalRequests++;
    
    if (!success) {
        stats.failedRequests++;
    }
    
    stats.avgResponseTime = ((stats.avgResponseTime * (stats.totalRequests - 1)) + responseTime) / stats.totalRequests;
}

function generateRequestId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

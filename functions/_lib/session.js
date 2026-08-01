// Tiny HMAC-signed session cookie, built on Web Crypto only.
//
// Previously this used node:crypto. Workers can shim that behind the
// nodejs_compat flag, but Web Crypto is native here — no flag, no shim, and
// crypto.subtle.verify does the signature comparison in constant time for us,
// so there's no hand-rolled timingSafeEqual to get wrong.
import { utf8ToBase64Url, base64UrlToUtf8, bytesToBase64Url, base64UrlToBytes } from './base64.js';

const enc = new TextEncoder();
const ALG = { name: 'HMAC', hash: 'SHA-256' };

function key(secret, usages) {
  return crypto.subtle.importKey('raw', enc.encode(secret), ALG, false, usages);
}

export async function sign(payload, secret) {
  const p = utf8ToBase64Url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('HMAC', await key(secret, ['sign']), enc.encode(p));
  return `${p}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

async function verify(token, secret) {
  try {
    if (!token || !token.includes('.')) return null;
    const [p, sig] = token.split('.');
    const ok = await crypto.subtle.verify('HMAC', await key(secret, ['verify']), base64UrlToBytes(sig), enc.encode(p));
    if (!ok) return null;
    const obj = JSON.parse(base64UrlToUtf8(p));
    if (obj.exp && Date.now() > obj.exp) return null;
    return obj;
  } catch { return null; }
}

export function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

export function cookie(name, value, maxAge) {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

// Returns the authenticated session object, or null.
// `env` is Cloudflare's bindings object — on Workers there is no process.env.
export async function currentUser(req, env) {
  const secret = env.SESSION_SECRET;
  if (!secret) return null;
  const c = parseCookies(req.headers.get('cookie'));
  const s = await verify(c.ak_session, secret);
  if (!s) return null;
  // Fail CLOSED: an unset/empty ALLOWED_LOGIN must authorize nobody, not everybody.
  const allowed = (env.ALLOWED_LOGIN || '').toLowerCase();
  if (!allowed || String(s.login).toLowerCase() !== allowed) return null;
  return s;
}

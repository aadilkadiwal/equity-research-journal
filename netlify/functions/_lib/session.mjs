// Tiny HMAC-signed session cookie (no external deps).
import crypto from 'node:crypto';

export function sign(payload, secret) {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(p).digest('base64url');
  return `${p}.${sig}`;
}

function verify(token, secret) {
  try {
    if (!token || !token.includes('.')) return null;
    const [p, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', secret).update(p).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const obj = JSON.parse(Buffer.from(p, 'base64url').toString());
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
export function currentUser(req) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const c = parseCookies(req.headers.get('cookie'));
  const s = verify(c.ak_session, secret);
  if (!s) return null;
  // Fail CLOSED: an unset/empty ALLOWED_LOGIN must authorize nobody, not everybody.
  const allowed = (process.env.ALLOWED_LOGIN || '').toLowerCase();
  if (!allowed || String(s.login).toLowerCase() !== allowed) return null;
  return s;
}

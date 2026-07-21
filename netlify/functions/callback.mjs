import { sign, cookie, parseCookies } from './_lib/session.mjs';
import { getLogin } from './_lib/github.mjs';

// GitHub OAuth callback. Path: /api/callback
export default async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(req.headers.get('cookie'));
  if (!code || !state || state !== cookies.oauth_state) {
    return new Response('Bad OAuth state', { status: 400 });
  }
  const tokRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/api/callback`,
    }),
  });
  // GitHub can return non-JSON (rate-limit/outage) — return a clean 401, not a 500 crash.
  if (!tokRes.ok) return new Response('OAuth token exchange failed', { status: 401 });
  let tok;
  try { tok = await tokRes.json(); } catch { return new Response('OAuth token exchange failed', { status: 401 }); }
  if (!tok.access_token) return new Response('OAuth token exchange failed', { status: 401 });

  const login = await getLogin(tok.access_token);
  // Fail CLOSED: an unset allow-list authorizes nobody (see session.mjs).
  const allowed = (process.env.ALLOWED_LOGIN || '').toLowerCase();
  if (!login || !allowed || login.toLowerCase() !== allowed) {
    return new Response(`Not authorized (${login || 'unknown'})`, { status: 403 });
  }

  const session = sign({ login, exp: Date.now() + 1000 * 60 * 60 * 8 }, process.env.SESSION_SECRET);
  return new Response(null, {
    status: 302,
    headers: [
      ['Location', '/admin/'],
      ['Set-Cookie', cookie('ak_session', session, 28800)],
      ['Set-Cookie', cookie('oauth_state', '', 0)],
    ],
  });
};

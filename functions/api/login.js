import { cookie } from '../_lib/session.js';

// Start GitHub OAuth (identity only). Route: /api/login
// Cloudflare Pages routes by file path, so there's no redirect rule to maintain.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) return new Response('GITHUB_CLIENT_ID not set', { status: 500 });
  const state = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const redirectUri = `${url.origin}/api/callback`;
  const authUrl =
    'https://github.com/login/oauth/authorize' +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=read:user&state=${state}`;
  return new Response(null, {
    status: 302,
    headers: { Location: authUrl, 'Set-Cookie': cookie('oauth_state', state, 600) },
  });
}

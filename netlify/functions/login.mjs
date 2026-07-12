import crypto from 'node:crypto';
import { cookie } from './_lib/session.mjs';

// Start GitHub OAuth (identity only). Path: /api/login
export default async (req) => {
  const url = new URL(req.url);
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) return new Response('GITHUB_CLIENT_ID not set', { status: 500 });
  const state = crypto.randomBytes(16).toString('hex');
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
};

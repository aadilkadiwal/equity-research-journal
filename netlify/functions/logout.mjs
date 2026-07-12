import { cookie } from './_lib/session.mjs';

// Path: /api/logout
export default async () =>
  new Response(null, { status: 302, headers: [['Location', '/admin/'], ['Set-Cookie', cookie('ak_session', '', 0)]] });

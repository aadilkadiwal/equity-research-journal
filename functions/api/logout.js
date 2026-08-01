import { cookie } from '../_lib/session.js';

// Route: /api/logout
export async function onRequestGet() {
  return new Response(null, {
    status: 302,
    headers: [['Location', '/admin/'], ['Set-Cookie', cookie('ak_session', '', 0)]],
  });
}

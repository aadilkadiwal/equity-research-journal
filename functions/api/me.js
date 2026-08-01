import { currentUser } from '../_lib/session.js';
import { json } from '../_lib/http.js';

// Who am I? Route: /api/me  → { login } or 401
export async function onRequestGet({ request, env }) {
  const u = await currentUser(request, env);
  if (!u) return json({ error: 'unauthorized' }, 401);
  return json({ login: u.login });
}

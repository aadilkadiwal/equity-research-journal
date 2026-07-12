import { currentUser } from './_lib/session.mjs';
import { json } from './_lib/http.mjs';

// Who am I? Path: /api/me  → { login } or 401
export default async (req) => {
  const u = currentUser(req);
  if (!u) return json({ error: 'unauthorized' }, 401);
  return json({ login: u.login });
};

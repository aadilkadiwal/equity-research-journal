// Minimal GitHub REST helpers via fetch (no Octokit dependency).
const API = 'https://api.github.com';

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ak-equity-research',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export async function getFile(repo, path, ref, token) {
  const r = await fetch(`${API}/repos/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`, { headers: headers(token) });
  if (r.status === 404) return { sha: null, content: null };
  if (!r.ok) throw new Error(`getFile ${path}: ${r.status} ${await r.text()}`);
  const j = await r.json();
  // Contents API inlines `content` only below 1 MB; above that it returns an
  // empty string with encoding "none", so fall back to the Blobs API (up to 100 MB).
  if (j.content && j.encoding === 'base64') {
    return { sha: j.sha, content: Buffer.from(j.content, 'base64').toString('utf8') };
  }
  const b = await fetch(`${API}/repos/${repo}/git/blobs/${j.sha}`, { headers: headers(token) });
  if (!b.ok) throw new Error(`getFile blob ${path}: ${b.status} ${await b.text()}`);
  const bj = await b.json();
  return { sha: j.sha, content: Buffer.from(bj.content, bj.encoding || 'base64').toString('utf8') };
}

export async function putFile(repo, path, branch, token, contentStr, message, sha) {
  const body = { message, content: Buffer.from(contentStr, 'utf8').toString('base64'), branch };
  if (sha) body.sha = sha;
  const r = await fetch(`${API}/repos/${repo}/contents/${encodeURI(path)}`, {
    method: 'PUT', headers: headers(token), body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`putFile ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function listTree(repo, ref, token) {
  const r = await fetch(`${API}/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, { headers: headers(token) });
  if (!r.ok) throw new Error(`listTree: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return (j.tree || []).filter((t) => t.type === 'blob').map((t) => t.path);
}

export async function getLogin(userToken) {
  const r = await fetch(`${API}/user`, { headers: headers(userToken) });
  if (!r.ok) return null;
  const j = await r.json();
  return j.login || null;
}

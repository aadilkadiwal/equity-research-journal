// Resolve per-quarter AI report links from the reports repo. Runs automatically
// on every /admin upload (see update.mjs). Sets q.reportUrl on each quarter entry
// that has a matching PDF in the `Q<n>-FY<yy>/` folder.
import { listTree } from './github.mjs';

const STOP = new Set(['and', 'ltd', 'limited', 'the', 'pvt', 'private', 'co', 'india', 'inc']);
const QF = /^Q[1-4]-FY\d{2}$/;

const norm = (s) =>
  String(s).toLowerCase().replace(/&/g, ' ')
    .split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t)).join('');

export async function linkReports(data, { repo, branch, token }) {
  let paths = [];
  try { paths = await listTree(repo, branch, token); } catch { return 0; }
  const index = new Map(); // `${quarter}::${key}` -> url
  const base = `https://github.com/${repo}/blob/${branch}/`;
  for (const p of paths) {
    if (!p.toLowerCase().endsWith('.pdf')) continue;
    const parts = p.split('/');
    if (parts.length < 2 || !QF.test(parts[0])) continue;
    const quarter = parts[0].replace('-', ' ');           // Q4-FY26 -> Q4 FY26
    const key = norm(parts[parts.length - 1].replace(/\.pdf$/i, ''));
    index.set(`${quarter}::${key}`, base + p);
  }
  let linked = 0;
  for (const c of data.companies) {
    const ck = norm(c.name);
    for (const q of c.quarters || []) {
      const url = index.get(`${q.quarter}::${ck}`);
      if (url) { q.reportUrl = url; linked++; } else { delete q.reportUrl; }
    }
  }
  return linked;
}

import XLSX from 'xlsx';
import { currentUser } from './_lib/session.mjs';
import { getFile, putFile } from './_lib/github.mjs';
import { mergeRows, REQUIRED_COLUMNS } from './_lib/merge.mjs';
import { linkReports } from './_lib/linkReports.mjs';
import { json } from './_lib/http.mjs';

// Upload a quarter's sheet → merge into companies.json → commit. Path: /api/update (POST)
export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const user = currentUser(req);
  if (!user) return json({ error: 'unauthorized — sign in with GitHub' }, 401);

  const env = process.env;
  const token = env.REPO_WRITE_TOKEN;
  const siteRepo = env.SITE_REPO;
  const branch = env.SITE_BRANCH || 'main';
  const dataPath = env.DATA_PATH || 'src/data/companies.json';
  if (!token || !siteRepo) return json({ error: 'server not configured (REPO_WRITE_TOKEN / SITE_REPO)' }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
  const { fileBase64 } = body || {};
  if (!fileBase64 || !body?.quarter) return json({ error: 'fileBase64 and quarter are required' }, 400);
  // Bound before decoding so a zip-bomb payload can't OOM the function (~9 MB decoded).
  if (typeof fileBase64 !== 'string' || fileBase64.length > 12_000_000) return json({ error: 'file too large' }, 413);
  if (!/^Q[1-4]\s?\d{4}$/i.test(body.quarter)) return json({ error: 'quarter must look like "Q4 2026"' }, 400);
  // Normalise to the canonical "Q4 2026" form (single space, upper-case) so the
  // stored label always matches what linkReports derives from folder names.
  const quarter = body.quarter.trim().toUpperCase().replace(/^(Q[1-4])\s*(\d{4})$/, '$1 $2');

  // 1) parse the uploaded workbook
  let rows, headers;
  try {
    const wb = XLSX.read(Buffer.from(fileBase64, 'base64'), { type: 'buffer' });
    const sheetName = wb.SheetNames.find((n) => /earning/i.test(n)) || wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    headers = (XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || []).map((h) => String(h).trim());
    rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  } catch (e) {
    return json({ error: 'could not read the Excel file: ' + e.message }, 400);
  }

  // 1b) validate headers up front — a column-name mismatch must fail loudly,
  // not silently skip every row. See /research-sheet-template.xlsx for the shape.
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length) {
    return json({
      error: `Sheet is missing required column(s): ${missing.join(', ')}. ` +
        `Expected exactly: ${REQUIRED_COLUMNS.join(', ')}. Download the template from the admin page and match the headers.`,
    }, 400);
  }

  // Re-reads companies.json each call so a retry merges against the freshest content.
  async function commitOnce() {
    const f = await getFile(siteRepo, dataPath, branch, token);
    const current = f.content ? JSON.parse(f.content) : { companies: [] };
    const { data, added, updated, quarterUpserts } = mergeRows(current, rows, { quarter });
    let linked = 0;
    if (env.REPORTS_REPO) {
      linked = await linkReports(data, { repo: env.REPORTS_REPO, branch: env.REPORTS_BRANCH || 'main', token });
    }
    const out = JSON.stringify(data, null, 2) + '\n';
    await putFile(siteRepo, dataPath, branch, token, out, `data: ${quarter} update via /admin (${quarterUpserts} companies)`, f.sha);
    return { ok: true, quarter, added, updated, quarterUpserts, reportsLinked: linked, totalCompanies: data.companies.length };
  }

  // A concurrent commit can advance the file between our read and PUT → GitHub
  // 409s on the stale sha. Re-read and retry once before surfacing the conflict.
  try {
    return json(await commitOnce());
  } catch (e) {
    if (/\b409\b/.test(e.message || '')) {
      try { return json(await commitOnce()); }
      catch (e2) {
        console.error('update commit retry failed:', e2);
        return json({ error: 'the data file changed during the upload — please retry' }, 409);
      }
    }
    console.error('update failed:', e);
    return json({ error: 'could not save the update — please retry' }, 502);
  }
};

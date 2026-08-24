import { currentUser } from '../_lib/session.js';
import { getFile, putFile } from '../_lib/github.js';
import { mergeRows, REQUIRED_COLUMNS, missingColumns } from '../_lib/merge.js';
import { linkReports } from '../_lib/linkReports.js';
import { json } from '../_lib/http.js';

// Merge a quarter's already-parsed rows into companies.json → commit. Route: /api/update (POST)
//
// The .xlsx is parsed in the BROWSER (see src/pages/admin/index.astro) and posted
// here as plain JSON. Cloudflare's free plan allows 10ms of CPU per request, and
// running SheetJS over a workbook here blew straight past it. Waiting on the
// GitHub API doesn't count as CPU, so all that's left server-side is the merge —
// comfortably inside the budget. It also keeps ~900 KB of SheetJS out of the
// deployed function.
//
// Trust is unchanged: the session cookie is still verified here, the column
// headers are still validated here, and the write token never leaves the server.
// onRequest (not onRequestPost) so a stray GET gets an explicit 405 from us,
// rather than falling through to the static asset handler and rendering a page.
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'unauthorized — sign in with GitHub' }, 401);

  const token = env.REPO_WRITE_TOKEN;
  const siteRepo = env.SITE_REPO;
  const branch = env.SITE_BRANCH || 'main';
  const dataPath = env.DATA_PATH || 'src/data/companies.json';
  if (!token || !siteRepo) return json({ error: 'server not configured (REPO_WRITE_TOKEN / SITE_REPO)' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
  const { rows, headers } = body || {};
  if (!Array.isArray(rows) || !Array.isArray(headers)) {
    return json({ error: 'rows and headers are required' }, 400);
  }
  if (!body?.quarter) return json({ error: 'quarter is required' }, 400);
  // Bound the payload so a runaway sheet can't chew the CPU budget (~175 real rows).
  if (rows.length > 5000) return json({ error: 'too many rows (max 5000)' }, 413);
  if (!/^Q[1-4]\s?\d{4}$/i.test(body.quarter)) return json({ error: 'quarter must look like "Q4 2026"' }, 400);
  // Normalise to the canonical "Q4 2026" form (single space, upper-case) so the
  // stored label always matches what linkReports derives from folder names.
  const quarter = body.quarter.trim().toUpperCase().replace(/^(Q[1-4])\s*(\d{4})$/, '$1 $2');

  // Validate headers up front — a column-name mismatch must fail loudly, not
  // silently skip every row. See /research-sheet-template.xlsx for the shape.
  // alias-aware: 'Company Name' satisfies 'CompanyName', so the raw research
  // workbook uploads as readily as the downloaded template.
  const missing = missingColumns(headers);
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
}

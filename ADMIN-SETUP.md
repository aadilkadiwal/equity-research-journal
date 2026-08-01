# On-site admin — setup (Cloudflare Pages + GitHub)

The site has a private **`/admin`** page: sign in with GitHub, upload a quarter's
Excel sheet, and it merges into `companies.json` and commits — Cloudflare then
rebuilds. New companies are added, a new quarter is appended to history, and
re-uploading the same quarter **replaces** that quarter's note.

How it's wired (all same-origin on Cloudflare Pages):

```
/admin  ──►  GitHub OAuth (/api/login → /api/callback)   [only ALLOWED_LOGIN]
   │  pick .xlsx + quarter
   │  ⚑ the browser parses the sheet (SheetJS) → posts plain JSON rows
   ▼
/api/update  (Cloudflare Pages Function)
   • verify signed session cookie
   • validate the column headers
   • merge (upsert by company + quarter)
   • resolve per-quarter AI-report links
   • commit companies.json to the site repo  (server-side write token)
   ▼
GitHub commit → Cloudflare auto-rebuild → live
```

The powerful repo-write token lives **only** in a Cloudflare secret (never in the
browser); the browser only proves your identity via GitHub OAuth.

> **Why the browser parses the Excel:** Cloudflare's free plan allows **10ms of
> CPU per request**, and running SheetJS server-side needs far more than that.
> Parsing in the browser keeps the function well inside the budget (waiting on
> the GitHub API doesn't count as CPU) and keeps ~900 KB of parser out of the
> deployed function. Security is unchanged — the session cookie and the column
> headers are still validated server-side, and the write token never leaves it.

## Prerequisites (one-time — you do these)

### 1. Deploy the site from a GitHub repo connected to Cloudflare Pages
The admin commits `companies.json` back to the repo, so Cloudflare must build
from GitHub.
- Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
- Pick this repo. Framework preset **Astro**, build command `npm run build`,
  output directory `dist` (also declared in `wrangler.toml`).
- The `functions/` directory is picked up automatically — no redirect rules
  needed, the file path *is* the URL path.

### 2. Create a GitHub OAuth App  (for sign-in)
GitHub → Settings → Developer settings → **OAuth Apps → New OAuth App**:
- Homepage URL: `https://<your-site>.pages.dev`
- Authorization callback URL: `https://<your-site>.pages.dev/api/callback`
- Save → copy the **Client ID**, and **Generate a client secret**.

> Updating the existing app instead? Change the callback URL to the Cloudflare
> one, or sign-in fails — GitHub will send you back to the old Netlify address.

### 3. Create a fine-grained Personal Access Token  (for the commit)
GitHub → Settings → Developer settings → **Fine-grained tokens → Generate**:
- Resource owner: your account.
- Repository access → **Only select repositories**: the **site repo** and
  **`india-stock-research`**.
- Permissions → **Contents: Read and write** (covers both).
- Copy the token.

### 4. Add Cloudflare environment variables
Cloudflare → your Pages project → **Settings → Variables and Secrets**. Add
these to the **Production** environment (and Preview too if you use preview
builds). Mark the three marked 🔒 as **Secret**, not plaintext.

| Key | Value |
|---|---|
| `GITHUB_CLIENT_ID` | from the OAuth app |
| 🔒 `GITHUB_CLIENT_SECRET` | from the OAuth app |
| 🔒 `SESSION_SECRET` | any long random string (`openssl rand -hex 32`) |
| 🔒 `REPO_WRITE_TOKEN` | the fine-grained PAT |
| `ALLOWED_LOGIN` | `aadilkadiwal` |
| `SITE_REPO` | `aadilkadiwal/equity-research-journal` |
| `SITE_BRANCH` | `main` |
| `DATA_PATH` | `src/data/companies.json` |
| `REPORTS_REPO` | `aadilkadiwal/india-stock-research` |
| `REPORTS_BRANCH` | `main` |

Then **retry the deployment** so the functions pick up the variables.

## Using it
1. Go to `https://<your-site>.pages.dev/admin`.
2. **Sign in with GitHub** (only `ALLOWED_LOGIN` is accepted).
3. Choose the `.xlsx`, type the **Quarter** (e.g. `Q1 2027` — must match the
   `Q1-2027` report folder), **Upload & publish**.
4. It reports what changed; the site rebuilds in ~1 minute.

## Local testing (optional)
```bash
npm run preview:cf         # builds, then serves dist/ + functions/ at :8788
```
Put the variables above in a `.dev.vars` file (same `KEY=value` format as
`.env`) — Wrangler loads it automatically. `.dev.vars` is gitignored.

Plain `npm run dev` still works for front-end changes, but `/api/*` is not served
there — use `preview:cf` when touching the admin flow.

## Security notes
- OAuth is restricted to `ALLOWED_LOGIN`; anyone else gets 403.
- The commit token is server-side only; the browser gets an HttpOnly,
  HMAC-signed session cookie (8-hour expiry), signed with Web Crypto.
- Both auth checks **fail closed** — an unset `ALLOWED_LOGIN` or
  `SESSION_SECRET` authorises *nobody*, not everybody.
- `/admin` is `noindex` and excluded from the sitemap.

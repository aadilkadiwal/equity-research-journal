# On-site admin — setup (Netlify + GitHub)

The site has a private **`/admin`** page: sign in with GitHub, upload a quarter's
Excel sheet, and it merges into `companies.json` and commits — Netlify then
rebuilds. New companies are added, a new quarter is appended to history, and
re-uploading the same quarter **replaces** that quarter's note.

How it's wired (all same-origin on Netlify):

```
/admin  ──►  GitHub OAuth (/api/login → /api/callback)   [only ALLOWED_LOGIN]
   │  upload .xlsx + quarter
   ▼
/api/update  (Netlify Function)
   • verify signed session cookie
   • parse xlsx (SheetJS) → merge (upsert by company + quarter)
   • resolve per-quarter AI-report links
   • commit companies.json to the site repo  (server-side write token)
   ▼
GitHub commit → Netlify auto-rebuild → live
```

The powerful repo-write token lives **only** in a Netlify env var (never in the
browser); the browser only proves your identity via GitHub OAuth.

## Prerequisites (one-time — you do these)

### 1. Deploy the site from a GitHub repo connected to Netlify
The admin commits `companies.json` back to the repo, so Netlify must build from
GitHub (not manual `netlify deploy`).
- Push this project to a repo, e.g. `aadilkadiwal/equity-research-site`.
- Netlify → **Add new site → Import from GitHub** → pick that repo. Build
  command `npm run build`, publish `dist` (already in `netlify.toml`).

### 2. Create a GitHub OAuth App  (for sign-in)
GitHub → Settings → Developer settings → **OAuth Apps → New OAuth App**:
- Homepage URL: `https://<your-site>.netlify.app`
- Authorization callback URL: `https://<your-site>.netlify.app/api/callback`
- Save → copy the **Client ID**, and **Generate a client secret**.

### 3. Create a fine-grained Personal Access Token  (for the commit)
GitHub → Settings → Developer settings → **Fine-grained tokens → Generate**:
- Resource owner: your account.
- Repository access → **Only select repositories**: the **site repo** and
  **`india-stock-research`**.
- Permissions → **Contents: Read and write** (covers both).
- Copy the token.

### 4. Add Netlify environment variables
Netlify → Site configuration → **Environment variables**:

| Key | Value |
|---|---|
| `GITHUB_CLIENT_ID` | from the OAuth app |
| `GITHUB_CLIENT_SECRET` | from the OAuth app |
| `SESSION_SECRET` | any long random string (`openssl rand -hex 32`) |
| `REPO_WRITE_TOKEN` | the fine-grained PAT |
| `ALLOWED_LOGIN` | `aadilkadiwal` |
| `SITE_REPO` | `aadilkadiwal/<site-repo>` |
| `SITE_BRANCH` | `main` |
| `DATA_PATH` | `src/data/companies.json` |
| `REPORTS_REPO` | `aadilkadiwal/india-stock-research` |
| `REPORTS_BRANCH` | `main` |

Then **trigger a deploy** so the functions pick up the env.

## Using it
1. Go to `https://<your-site>.netlify.app/admin`.
2. **Sign in with GitHub** (only `ALLOWED_LOGIN` is accepted).
3. Choose the `.xlsx`, type the **Quarter** (e.g. `Q1 FY27` — must match the
   `Q1-FY27` report folder), **Upload & publish**.
4. It reports what changed; the site rebuilds in ~1 minute.

## Local testing (optional)
`npm i -g netlify-cli` → put the env vars in a `.env` → `netlify dev` runs the
functions locally at `http://localhost:8888/admin`.

## Security notes
- OAuth is restricted to `ALLOWED_LOGIN`; anyone else gets 403.
- The commit token is server-side only; the browser gets an HttpOnly,
  HMAC-signed session cookie (8-hour expiry).
- `/admin` is `noindex` and excluded from the sitemap.

# Contributing

Thanks for your interest in improving this project! Changes are accepted through
**pull requests from a fork** — you propose, the maintainer reviews and merges.
You don't need write access to the repo.

## How to propose a change

1. **Fork** this repository (top-right **Fork** button) — you get
   `your-username/equity-research-journal`.
2. **Clone your fork and create a branch:**
   ```bash
   git clone https://github.com/YOUR-USERNAME/equity-research-journal.git
   cd equity-research-journal
   git checkout -b my-change
   ```
3. **Set up and run locally:**
   ```bash
   npm install
   npm run dev      # local dev server
   npm run build    # verify a clean production build before pushing
   ```
4. **Commit and push to your fork:**
   ```bash
   git commit -am "describe your change"
   git push origin my-change
   ```
5. **Open a Pull Request** against `aadilkadiwal/equity-research-journal` `main`
   (your fork page → **Compare & pull request**). Describe what changed and why.

## Review

The maintainer reviews every PR in the **Files changed** tab, may request
changes, and merges once it looks good. Please keep PRs focused and small where
possible, and make sure `npm run build` passes.

## Project layout (quick map)

- `src/` — Astro site: `pages/index.astro`, shared render helpers in `src/lib/`,
  data in `src/data/` (`companies.json`, `emas.json`).
- `scripts/` — the data pipeline (`import_excel.py`, and the weekly-EMA job in
  `scripts/emas/`).
- `functions/` — the admin upload / auth code, deployed as Cloudflare Pages
  Functions. `functions/api/*.js` are the routes (file path = URL path);
  `functions/_lib/` is shared code (a leading `_` keeps it un-routed).

See `README.md` and `DATA-FLOW.md` for how data flows onto the site.

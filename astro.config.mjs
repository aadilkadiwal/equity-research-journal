// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// ⚠️ Set `site` to your final URL (Cloudflare Pages subdomain or custom domain)
// — used for canonical links, Open Graph URLs, and the sitemap. Getting this
// wrong points Google at the old host, so update it if you add a custom domain.
export default defineConfig({
  site: 'https://equity-research-journal.pages.dev',
  trailingSlash: 'always',
  integrations: [sitemap({ filter: (page) => !page.includes('/admin') })],
});

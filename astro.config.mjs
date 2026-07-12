// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// ⚠️ Set `site` to your final URL (Netlify subdomain or custom domain) — used
// for canonical links, Open Graph URLs, and the sitemap.
export default defineConfig({
  site: 'https://aadil-kadiwal-research.netlify.app',
  trailingSlash: 'always',
  integrations: [sitemap({ filter: (page) => !page.includes('/admin') })],
});

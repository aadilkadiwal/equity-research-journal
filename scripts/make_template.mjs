// Generates public/research-sheet-template.xlsx — the sample sheet users download
// from /admin so their column headers always match what the uploader expects.
// Headers come from REQUIRED_COLUMNS (shared with update.mjs) so they can't drift.
//   run: npm run template
import XLSX from 'xlsx';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { REQUIRED_COLUMNS } from '../netlify/functions/_lib/merge.mjs';

// The SheetJS CDN build doesn't auto-bind Node fs — required for writeFile.
XLSX.set_fs(fs);

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'research-sheet-template.xlsx');

// Header-only template: just the column names, no sample data rows.
const ws = XLSX.utils.aoa_to_sheet([REQUIRED_COLUMNS]);
const wb = XLSX.utils.book_new();
// sheet name matches update.mjs's /earning/i preference so it's always picked
XLSX.utils.book_append_sheet(wb, ws, 'Earnings');
XLSX.writeFile(wb, out);
console.log('Wrote', out, '—', REQUIRED_COLUMNS.join(', '));

// Small shared helpers used by render.js.

// "Q4 2026" -> sortable number (2026*10 + 4). Higher = more recent. 2-digit
// ("26"/"FY26") years are widened to a full year (00-69 -> 2000s, else 1900s) so
// mixed labels sort on one monotonic scale, correct across century boundaries.
export function quarterKey(label) {
  const m = /Q(\d)\s*(?:FY\s*)?(\d{2,4})/i.exec(label || '');
  if (!m) return 0;
  let y = parseInt(m[2], 10);
  if (y < 100) y += y < 70 ? 2000 : 1900;
  return y * 10 + parseInt(m[1], 10);
}

// ₹ crore -> "₹1.31 L Cr" / "₹30,831 Cr" (matches the source PDF style).
export function formatMcap(cr) {
  if (cr == null || isNaN(cr)) return '—';
  if (cr >= 100000) {
    return `₹${(cr / 100000).toFixed(2)} L Cr`;
  }
  return `₹${Math.round(cr).toLocaleString('en-IN')} Cr`;
}

// "Q1 2027" -> "Q4 2026" (the immediately preceding quarter).
export function prevQuarterLabel(label) {
  const m = /Q(\d)\s*(?:FY\s*)?(\d{2,4})/i.exec(label || '');
  if (!m) return null;
  let q = parseInt(m[1], 10), y = parseInt(m[2], 10);
  if (y < 100) y += y < 70 ? 2000 : 1900;
  q -= 1;
  if (q === 0) { q = 4; y -= 1; }
  return `Q${q} ${y}`;
}

// "Q1 2027" -> "Q1 2026" (same quarter, one year back — the YoY base).
export function yoyQuarterLabel(label) {
  const m = /Q(\d)\s*(?:FY\s*)?(\d{2,4})/i.exec(label || '');
  if (!m) return null;
  let y = parseInt(m[2], 10);
  if (y < 100) y += y < 70 ? 2000 : 1900;
  return `Q${m[1]} ${y - 1}`;
}

// Small shared helpers used by render.js.

// "Q4 2026" -> sortable number (26*10 + 4). Higher = more recent.
// The year is taken mod 100 so 2-digit ("26"/"FY26") and 4-digit ("2026")
// labels sort on the same scale instead of the latter dwarfing everything.
// The optional "FY" keeps legacy labels sortable during/after the migration.
export function quarterKey(label) {
  const m = /Q(\d)\s*(?:FY\s*)?(\d{2,4})/i.exec(label || '');
  if (!m) return 0;
  return (parseInt(m[2], 10) % 100) * 10 + parseInt(m[1], 10);
}

// ₹ crore -> "₹1.31 L Cr" / "₹30,831 Cr" (matches the source PDF style).
export function formatMcap(cr) {
  if (cr == null || isNaN(cr)) return '—';
  if (cr >= 100000) {
    return `₹${(cr / 100000).toFixed(2)} L Cr`;
  }
  return `₹${Math.round(cr).toLocaleString('en-IN')} Cr`;
}

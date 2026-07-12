// Small shared helpers used by render.js.

// "Q4 FY26" -> sortable number (26*10 + 4). Higher = more recent.
// The year is taken mod 100 so a 2-digit ("FY26") and 4-digit ("FY2026")
// label sort on the same scale instead of the latter dwarfing everything.
export function quarterKey(label) {
  const m = /Q(\d)\s*FY\s*(\d{2,4})/i.exec(label || '');
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

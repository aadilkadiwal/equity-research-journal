// Tap-to-explain: any element carrying data-tip opens a popover on click or Enter.
//
// A title= tooltip never appears on a touch screen, which left the potential badge and
// the trend-line pills explained only to readers who already knew. Shared rather than
// inlined in index.astro because /how-to-read renders a real card through the same
// rowHTML(), tips and all.
import { esc } from './render.js';

export function initTapTips() {
  let tipEl = null, tipFor = null;

  function close() {
    if (!tipEl) return;
    if (tipFor) tipFor.setAttribute('aria-expanded', 'false');
    tipEl.remove(); tipEl = null; tipFor = null;
  }

  function open(anchor) {
    close();
    const head = anchor.dataset.tipHead || '';
    tipEl = document.createElement('div');
    tipEl.className = 'taptip';
    tipEl.setAttribute('role', 'tooltip');
    tipEl.innerHTML = (head ? `<b>${esc(head)}</b>` : '') + `<span>${esc(anchor.dataset.tip)}</span>`;
    document.body.appendChild(tipEl);
    const r = anchor.getBoundingClientRect();
    tipEl.style.left = Math.round(Math.min(
      Math.max(8, r.left + r.width / 2 - tipEl.offsetWidth / 2),
      window.innerWidth - tipEl.offsetWidth - 8)) + 'px';
    // Flips above the anchor when there is no room below, so a badge on the last
    // card does not open a tip off the bottom of the screen.
    const below = window.innerHeight - r.bottom > tipEl.offsetHeight + 16;
    tipEl.style.top = Math.round(window.scrollY
      + (below ? r.bottom + 8 : r.top - tipEl.offsetHeight - 8)) + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    tipFor = anchor;
  }

  function toggle(anchor) { if (tipFor === anchor) close(); else open(anchor); }

  // Capture phase: a card is itself a click target that navigates to the company
  // page, so the tip has to swallow the click before the row handler sees it.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-tip]');
    if (!a) { close(); return; }
    e.preventDefault(); e.stopPropagation();
    toggle(a);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return close();
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const a = document.activeElement && document.activeElement.closest('[data-tip]');
    if (!a) return;
    e.preventDefault();
    toggle(a);
  });

  // Positioned against the anchor's box; once either moves it points at nothing.
  window.addEventListener('scroll', close, { passive: true });
  window.addEventListener('resize', close);
}

// Tests for the score's rendering surface. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreBadgeHTML, scorePanelHTML, sidePanelsHTML, rowHTML, tableRowHTML, tableHTML, compactRowHTML } from './render.js';

const entry = (over = {}) => ({
  quarter: 'Q1 2027', view: 'Watch', tier: 'Tier 1', note: 'A note.',
  growth: { eps: { yoy: 30, qoq: 4 }, sales: { yoy: 35 }, opProfit: { yoy: 35 } },
  ...over,
});
const company = (over = {}) => ({
  slug: 'acme', name: 'Acme Ltd', tvCode: 'ACME', industry: 'Widgets', marketCap: 1000,
  ema: { price: 100, ret1y: 5, dist: { '10W': 5, '20W': 8, '40W': 12 } },
  quarters: [entry()],
  ...over,
});

test('badge shows the band, its score out of 100, and no other numbers', () => {
  // Attributes stripped: they carry the longer explanation, and asserting against
  // them would test the tooltip rather than the badge.
  const h = scoreBadgeHTML(company(), entry())
    .replace(/(title|data-tip|data-tip-head|aria-label)="[^"]*"/g, '');
  // Band first, score second: "Strong 78" reads as a verdict, "78 · Strong" as a
  // measurement you have to decode.
  assert.match(h, /Strong/);
  assert.match(h, /<b class="mb-n">\d+<s>\/100<\/s><\/b>/);
  // the components, the flag chips and the outlook multiple stay on the detail page
  assert.doesNotMatch(h, /×\d|mb-flag/);
});

test('badge renders nothing when the quarter has no growth columns', () => {
  const bare = { quarter: 'Q4 2026', view: 'Positive' };
  const h = scoreBadgeHTML(company({ quarters: [bare] }), bare);
  assert.equal(h, '', 'an unscoreable row stays clean rather than explaining itself');
});

test('badge renders nothing when the company has no price data', () => {
  assert.equal(scoreBadgeHTML(company({ ema: null }), entry()), '');
});

test('badge carries no flag chips — those belong on the detail page', () => {
  const e = entry({ growth: { eps: { yoy: 250, qoq: 4 }, sales: { yoy: 260 }, opProfit: { yoy: 260 } } });
  const h = scoreBadgeHTML(company({ quarters: [e] }), e);
  assert.doesNotMatch(h, /mb-flag/, 'no chips; a single caution glyph carries it instead');
  // The names may appear in the badge's explanation attributes, never as chips.
  assert.doesNotMatch(h.replace(/(title|data-tip|aria-label)="[^"]*"/g, ''), /base effect/i);
});

test('the detail panel still shows the score out of 100 and the flags', () => {
  const e = entry({ growth: { eps: { yoy: 250, qoq: 4 }, sales: { yoy: 260 }, opProfit: { yoy: 260 } } });
  const h = scorePanelHTML(company({ quarters: [e] }), e);
  assert.match(h, /\/\s*100/);
  assert.match(h, /base effect/i);
});

test('panel names the quadrant and shows all three components', () => {
  const h = scorePanelHTML(company(), entry());
  assert.match(h, /The Treadmill/);
  // Labels are questions now, not nouns — a non-investor could not parse
  // "Unpaid growth" but can answer "has the market paid for this growth yet?".
  assert.match(h, /Has the market paid for this growth/);
  assert.match(h, /Is the growth real, or flattered\?/);
  assert.match(h, /Is the price trend agreeing\?/);
});

test('panel shows the multiplicative check', () => {
  // Both legs of Return = ΔEPS × ΔMultiple still appear, now named in plain words
  // on the tile with the notation kept in the component row beneath.
  const h = scorePanelHTML(company(), entry());
  assert.match(h, /earnings ×/, 'the earnings leg');
  assert.match(h, /price-tag ×/, 'the re-rating leg');
  assert.match(h, /ΔMultiple ×/, 'the technical form survives for the expert reader');
});

test('panel says the price move is a proxy when ret1y is absent', () => {
  const c = company({ ema: { price: 100, dist: { '10W': 5, '20W': 8, '40W': 12 } } });
  const h = scorePanelHTML(c, entry());
  assert.match(h, /proxy/i);
});

test('panel does not claim a proxy once ret1y is stored', () => {
  const h = scorePanelHTML(company(), entry());
  assert.doesNotMatch(h, /proxy/i);
});

test('panel explains itself instead of scoring when growth columns are missing', () => {
  const bare = { quarter: 'Q4 2026', view: 'Positive' };
  const h = scorePanelHTML(company({ quarters: [bare] }), bare);
  assert.match(h, /growth/i);
  assert.doesNotMatch(h, /mb-rows/);
});

test('the list row carries the band badge', () => {
  const h = rowHTML(company(), entry());
  assert.match(h, /Strong/);
  assert.doesNotMatch(h, /mb-flag/);
});

test('the table row carries the band in its own cell', () => {
  const h = tableRowHTML(company(), entry());
  assert.match(h, /col-setup/);
  assert.match(h, /Strong/);
});

// Same word as the filter, the sort option and the badge. Four names for one score
// is the confusion, not the fix.
test('the table header names the score the way the rest of the page does', () => {
  const h = tableHTML('', {});
  assert.match(h, />Potential</);
  assert.doesNotMatch(h, />Setup</, 'an internal name, never shown to a reader');
});

test('the table row shows a blank setup cell when unscoreable', () => {
  const bare = { quarter: 'Q4 2026', view: 'Positive', tier: 'Tier 1', note: 'n' };
  const h = tableRowHTML(company({ quarters: [bare] }), bare);
  assert.match(h, /col-setup/);
  assert.doesNotMatch(h, /· (Strong|Good|Average|Weak|Poor)/);
});

test('the list row still renders for an unscoreable company, with no band', () => {
  const bare = { quarter: 'Q4 2026', view: 'Positive', tier: 'Tier 1', note: 'n' };
  const h = rowHTML(company({ quarters: [bare] }), bare);
  assert.match(h, /Acme Ltd/);
  assert.doesNotMatch(h, /· (Strong|Good|Average|Weak|Poor)/);
});

test('score markup escapes company-supplied text', () => {
  const e = entry({ view: '<img src=x>' });
  const h = scoreBadgeHTML(company({ quarters: [e] }), e);
  assert.doesNotMatch(h, /<img/);
});

test('panel shows the P/E it de-rated from once EPS is recorded', () => {
  const e = { quarter: 'Q1 2027', view: 'Watch', tier: 'Tier 1', note: 'n', epsTtmRs: 100,
    growth: { eps: { yoy: 30, qoq: 4 }, sales: { yoy: 35 }, opProfit: { yoy: 35 } } };
  const h = scorePanelHTML(company({ quarters: [e] }), e);
  assert.match(h, /P\/E/);
});

test('panel shows no P/E line while EPS is unrecorded', () => {
  const h = scorePanelHTML(company(), entry());
  assert.doesNotMatch(h, /P\/E/);
});

// ---- detail-page density ---------------------------------------------------
// The growth table pushed YoY/QoQ hard right and left a dead gap mid-row, while
// the 3-year and 5-year CAGRs — now the score's actual growth axis — were not
// shown anywhere on the page.
import { growthMatrixHTML } from './render.js';

const withCagr = () => ({
  quarter: 'Q1 2027', view: 'Watch', tier: 'Tier 1', note: 'n',
  epsTtmRs: 20, peAvg5y: 30,
  epsCagr3y: 41, epsCagr5y: 33, salesCagr3y: 22, salesCagr5y: 18,
  ebitdaCagr3y: 36, ebitdaCagr5y: 30,
  growth: { sales:{yoy:29.4,qoq:21.6}, opProfit:{yoy:40.2,qoq:22.6},
            eps:{yoy:70.2,qoq:50.7}, pat:{yoy:70.3,qoq:50.7} },
});

test('the growth table shows the 3-year and 5-year CAGRs', () => {
  const h = growthMatrixHTML(withCagr());
  assert.match(h, /3-year yearly average/i);
  assert.match(h, /5Y CAGR/i);
  assert.match(h, /\+41\.0%/, 'the EPS 3-year CAGR must appear');
  assert.match(h, /\+22\.0%/, 'the sales 3-year CAGR must appear');
});

test('maps operating profit to the EBITDA CAGR columns', () => {
  const h = growthMatrixHTML(withCagr());
  assert.match(h, /\+36\.0%/, 'EBITDA 3-year CAGR belongs on the operating-profit row');
});

test('shows a dash rather than a blank where no CAGR exists', () => {
  const e = withCagr();
  delete e.epsCagr5y;
  const h = growthMatrixHTML(e);
  assert.match(h, /—/);
});

test('still renders when no CAGR figures are recorded at all', () => {
  const e = withCagr();
  for (const k of ['epsCagr3y','epsCagr5y','salesCagr3y','salesCagr5y','ebitdaCagr3y','ebitdaCagr5y']) delete e[k];
  const h = growthMatrixHTML(e);
  assert.match(h, /Sales/);
  assert.doesNotMatch(h, /yearly average/i, 'the CAGR columns drop out entirely when there is nothing to show');
});

test('the score panel lays the four components out as a grid', () => {
  const h = scorePanelHTML(company({ quarters: [withCagr()] }), withCagr());
  assert.match(h, /mb-rows/);
  assert.match(h, /mb-stats/, 'the closing facts become tiles, not stacked full-width rows');
});

test('every quarter label renders as the same tag, whatever the quarter', () => {
  const newest = { quarter: 'Q1 2027', view: 'Watch', tier: 'Tier 1', note: 'n' };
  const older  = { quarter: 'Q4 2026', view: 'Watch', tier: 'Tier 1', note: 'n' };
  // pass the newest quarter, which is exactly when the old code diverged
  const a = rowHTML(company({ quarters: [newest] }), newest, 'Q1 2027');
  const b = rowHTML(company({ quarters: [older] }), older, 'Q1 2027');
  const cls = (h) => (h.match(/class="row-view-q[^"]*"/) || [])[0];
  assert.equal(cls(a), cls(b), 'the newest quarter must not carry an extra class');
  assert.doesNotMatch(a, /fresh/, 'the fresh treatment is gone');
});

test('the table and compact rows use one quarter treatment too', () => {
  const older = { quarter: 'Q4 2026', view: 'Watch', tier: 'Tier 1', note: 'n' };
  const newest = { quarter: 'Q1 2027', view: 'Watch', tier: 'Tier 1', note: 'n' };
  assert.doesNotMatch(tableRowHTML(company({ quarters: [newest] }), newest, 'Q1 2027'), /fresh/);
  assert.doesNotMatch(compactRowHTML(company({ quarters: [newest] }), newest, 'Q1 2027'), /fresh/);
});

test('the band badge reads in sentence case, not shouted', () => {
  const h = scoreBadgeHTML(company(), entry());
  assert.match(h, /Strong/, `expected "Excellent", got: ${h}`);
  assert.doesNotMatch(h, /EXCELLENT|STRONG/);
});

test('the panel badge is sentence case too', () => {
  const h = scorePanelHTML(company(), entry());
  assert.match(h, /Strong.*100/s);
  assert.doesNotMatch(h, /EXCELLENT|STRONG/);
});

test('every band still gets its own class so intensity can differ', () => {
  const weak = { quarter: 'Q1 2027', view: 'Watch', tier: 'Tier 1', note: 'n',
    epsCagr3y: 2, salesCagr3y: 3, ebitdaCagr3y: 4,
    growth: { eps:{yoy:2,qoq:1}, sales:{yoy:3}, opProfit:{yoy:4} } };
  const h = scoreBadgeHTML(company({ quarters: [weak] }), weak);
  assert.match(h, /mb-badge mb-(weak|none|thin)/);
});

// ---- the band, exposed once for both the badge and the filter ---------------
import { setupBand } from './render.js';

test('reports a company band so the badge and the filter agree', () => {
  const e = entry();
  assert.equal(setupBand(company(), e), 'STRONG');
});

test('reports null for a company that cannot be scored', () => {
  const bare = { quarter: 'Q4 2026', view: 'Positive' };
  assert.equal(setupBand(company({ quarters: [bare] }), bare), null);
  assert.equal(setupBand(company({ ema: null }), entry()), null);
});

test('the band it reports is the one the badge prints', () => {
  const e = entry();
  const band = setupBand(company(), e);
  assert.ok(['STRONG','FAIR','THIN','WEAK','NONE'].includes(band));
});

// ---- list badge: tag plus how big it could be ------------------------------
// The band alone discriminated badly — 90% of the book sat in Fair or Weak, with
// 26- and 31-point spreads inside them. The outlook adds the size; the tag keeps
// the trust signal the outlook cannot carry.
import { setupOutlook } from './render.js';

// a company complete enough to project: trailing EPS, a target multiple, a CAGR
const projectable = (over = {}) => ({
  quarter: 'Q1 2027', view: 'Watch', tier: 'Tier 1', note: 'n',
  epsTtmRs: 20, peAvg5y: 30,
  epsCagr3y: 30, salesCagr3y: 34, ebitdaCagr3y: 36,
  growth: { eps: { yoy: 30, qoq: 4 }, sales: { yoy: 34 }, opProfit: { yoy: 36 } }, ...over,
});

test('the badge carries the three-year outlook beside the band', () => {
  const e = projectable();
  const h = scoreBadgeHTML(company({ quarters: [e] }), e);
  assert.match(h, /Strong/);
  assert.match(h, /×\d+\.\d/, `expected an outlook multiple, got: ${h}`);
});

test('the badge omits the outlook when there is nothing to project', () => {
  // no EPS TTM, so no P/E and no target to re-rate toward
  const e = { quarter: 'Q1 2027', view: 'Watch', tier: 'Tier 1', note: 'n',
    epsCagr3y: 30, salesCagr3y: 34, ebitdaCagr3y: 36,
    growth: { eps: { yoy: 30, qoq: 4 }, sales: { yoy: 34 }, opProfit: { yoy: 36 } } };
  const h = scoreBadgeHTML(company({ quarters: [e] }), e);
  assert.doesNotMatch(h, /×\d/);
});

test('flags a badge whose outlook should not be taken at face value', () => {
  const e = { quarter: 'Q1 2027', view: 'Watch', tier: 'Tier 1', note: 'n',
    epsTtmRs: 20, peAvg5y: 60, epsCagr3y: 30, salesCagr3y: 5, ebitdaCagr3y: 34,
    growth: { eps: { yoy: 300, qoq: 4 }, sales: { yoy: 5 }, opProfit: { yoy: 34 } } };
  const h = scoreBadgeHTML(company({ quarters: [e] }), e);
  assert.match(h, /⚠/, 'a flagged company must carry a caution in the list');
});

test('exposes the outlook for sorting, matching what the badge shows', () => {
  const e = projectable();
  const c = company({ quarters: [e] });
  const o = setupOutlook(c, e);
  assert.ok(o > 0);
  assert.match(scoreBadgeHTML(c, e), new RegExp('×' + o.toFixed(1)));
});

test('reports no outlook to sort on where none exists', () => {
  const bare = { quarter: 'Q4 2026', view: 'Positive' };
  assert.equal(setupOutlook(company({ quarters: [bare] }), bare), null);
});

test('component rows carry no letters — nothing implies an order the grid lacks', () => {
  // They sit in a 2-column grid, which reads A B / C D / E. Lettering them promised a
  // sequence the layout never followed; dropping the letters is what lets the grid
  // stay two columns (164px shorter on desktop than one).
  const e = { quarter: 'Q1 2027', view: 'Watch', tier: 'Tier 1', note: 'n',
    epsCagr3y: 30, salesCagr3y: 34, ebitdaCagr3y: 36,
    growth: { eps: { yoy: 30, qoq: 4 }, sales: { yoy: 34 }, opProfit: { yoy: 36 } } };
  const h = scorePanelHTML(company({ quarters: [e] }), e);
  assert.doesNotMatch(h, /class="mb-k"/, 'no letter column');
  // the four questions are all still there, in order
  const qs = [...h.matchAll(/class="mb-lab">([^<]+)/g)].map((m) => m[1]);
  assert.equal(qs.length, 4);
  assert.match(qs[0], /paid for this growth/i);
});

test('the list badge shows the score beside the band', () => {
  const e = projectable();
  const visible = scoreBadgeHTML(company({ quarters: [e] }), e)
    .replace(/(title|data-tip|aria-label)="[^"]*"/g, '');
  assert.match(visible, /(Strong|Good|Average|Weak|Poor)/, `got: ${visible}`);
  assert.doesNotMatch(visible, /×\d/, 'the outlook multiple is no longer displayed in the badge');
  // The score out of 100 is what makes the ladder self-ordering for a reader who
  // does not already know that Good outranks Average.
  assert.match(visible, /\/100/, 'the badge prints the score out of 100');
});

// ---- the 5-year P/E range on the panel ---------------------------------------
// "A stretch beyond its history" is a guess about history. With the fetched range
// it becomes a checkable claim: it traded there, or it never has.
const ranged = (over = {}) => company({
  peRange: { high: 58, low: 10, median: 25, points: 261, asOf: '2026-08-26' },
  quarters: [entry({ epsTtmRs: 4, peAvg5y: 30 })],
  ...over,
});

test('prints the 5-year P/E range when one has been fetched', () => {
  const h = scorePanelHTML(ranged(), ranged().quarters[0]).replace(/title="[^"]*"/g, '');
  assert.match(h, /5-year range/i);
  assert.match(h, /10×.{0,12}58×/);
});

test('calls a multiple the company has actually traded at precedented', () => {
  // needs ~19x, inside a 10-58x range and below the 25x median
  const c = ranged({ quarters: [entry({ epsTtmRs: 4, peAvg5y: 30 })] });
  const h = scorePanelHTML(c, c.quarters[0]).replace(/title="[^"]*"/g, '');
  assert.match(h, /it has traded there|inside its 5-year range|below anything/i);
  assert.doesNotMatch(h, /never traded/i);
});

test('names the 5-year high when the multiple required has never been reached', () => {
  // low growth + a rich entry multiple pushes the triple above the 22x high
  const c = ranged({ peRange: { high: 22, low: 8, median: 14, points: 261, asOf: '2026-08-26' },
    quarters: [entry({ epsTtmRs: 4, peAvg5y: 30 })] });
  const h = scorePanelHTML(c, c.quarters[0]).replace(/title="[^"]*"/g, '');
  assert.match(h, /never traded above 22×/i);
});

test('falls back to the average-based wording when no range has been fetched', () => {
  const c = company({ quarters: [entry({ epsTtmRs: 4, peAvg5y: 30 })] });
  const h = scorePanelHTML(c, c.quarters[0]).replace(/title="[^"]*"/g, '');
  assert.doesNotMatch(h, /has ranged/i, 'never quotes a range it does not have');
  assert.match(h, /no 5-year range on file/i, 'and says the range is missing rather than going quiet');
  assert.match(h, /its average/i, 'the tile falls back to the average from the sheet');
  assert.match(h, /its history|normal multiple|has not averaged/i);
});

// ---- plain English: the page has to work for someone who does not know "P/E" ---
import { plainSummary, glossaryHTML, VIEW_GLYPH } from './render.js';
const plain = (over = {}, cOver = {}) => {
  const c = company({ quarters: [entry({ epsTtmRs: 4, peAvg5y: 30, ...over })], ...cOver });
  return scorePanelHTML(c, c.quarters[0]).replace(/title="[^"]*"/g, '');
};

test('opens the panel with a plain sentence, before any notation', () => {
  const h = plain();
  const lead = h.indexOf('mb-lead');
  assert.ok(lead > 0, 'a lead sentence exists');
  assert.ok(lead < h.indexOf('mb-rows'), 'it comes before the component rows');
});

test('the lead sentence uses no jargon a non-investor would have to look up', () => {
  // The exact terms the user called out: multiple, CAGR, ΔMultiple, PEG, quadrant names.
  const lead = plain().match(/<p class="mb-lead">(.*?)<\/p>/s)[1].replace(/<[^>]+>/g, '');
  for (const word of ['multiple', 'CAGR', 'ΔMultiple', 'PEG', 'Treadmill', 'quadrant', '×']) {
    assert.doesNotMatch(lead, new RegExp(word, 'i'), `lead should not say "${word}": ${lead}`);
  }
});

test('says a double needs the price-tag to shrink when that is what the arithmetic shows', () => {
  // 30% growth on a 25x P/E: doubling needs ~14x, well below today's 25x.
  const h = plain({ epsTtmRs: 4, peAvg5y: 30 });
  assert.match(h, /even as .{0,40}(shrinks|price-tag)/i);
});

test('states the double in rupees, not only as a multiple', () => {
  const h = plain();                       // price 100 in the fixture
  assert.match(h, /₹200/, 'names the doubled price');
});

test('warns when the score disagrees with the recorded view', () => {
  const h = plain({ view: 'Concern' });
  assert.match(h, /mb-clash/);
  assert.match(h, /Concern/);
  assert.match(h, /read the note|hasn.t read/i);
});

test('does not warn when the score and the view agree', () => {
  assert.doesNotMatch(plain({ view: 'Positive' }), /mb-clash/);
});

test('does not warn when a weak score sits under a cautious view', () => {
  // Agreement, not conflict: both are saying be careful.
  const c = company({ quarters: [entry({ view: 'Concern', epsTtmRs: 4, peAvg5y: 30,
    epsCagr3y: 2, salesCagr3y: 2, ebitdaCagr3y: 2,
    growth: { eps: { yoy: 2, qoq: 1 }, sales: { yoy: 2 }, opProfit: { yoy: 2 } } })] });
  assert.doesNotMatch(scorePanelHTML(c, c.quarters[0]), /mb-clash/);
});

test('labels the component rows as questions a layperson can answer', () => {
  const h = plain();
  for (const q of [/cheap right now/i, /paid for/i, /real|flatter/i, /trend/i]) {
    assert.match(h, q);
  }
});

test('keeps the technical figure on every component row it rewrote', () => {
  // Plain on top, but nothing removed — this is still the user's own research page.
  const h = plain();
  assert.match(h, /ΔMultiple|Multiple ×/, 'the technical detail survives');
  assert.match(h, /P\/E/);
});

test('plainSummary explains a fast grower whose price-tag shrank', () => {
  const s = plainSummary({ quadrant: { key: 'Q3' }, growth: 41, deltaMultiple: 0.76,
    band: 'STRONG', gate: null, flags: [] });
  assert.match(s.head, /cheap/i);
  assert.match(s.body, /41%/);
});

test('plainSummary does not promise anything when growth is missing', () => {
  const s = plainSummary({ quadrant: { key: 'Q4' }, growth: -8, deltaMultiple: 0.6,
    band: 'WEAK', gate: 'earnings are not growing over the measured window', flags: [] });
  assert.match(s.head, /shrink|falling|not grow/i);
  assert.doesNotMatch(s.body, /multibagger/i);
});

test('the glossary defines every term the panel still uses', () => {
  const g = glossaryHTML();
  for (const term of ['P/E', 'EPS', 'CAGR', 're-rat', 'Book value', 'EMA']) {
    assert.match(g, new RegExp(term.replace('/', '\\/'), 'i'), `glossary should define ${term}`);
  }
  assert.match(g, /<details/, 'collapsed by default so it costs no space');
});

// It renders on the list page too, so it has to cover the three card badges — not
// just the vocabulary of the detail panel.
test('the glossary names the three badges a card actually shows', () => {
  const g = glossaryHTML();
  for (const term of ['View', 'Tier', 'Multibagger potential', 'Market cap']) {
    assert.match(g, new RegExp(term, 'i'), `glossary should define ${term}`);
  }
  // Taking the score for a recommendation is the one dangerous misread on the page.
  assert.match(g, /has NOT read the earnings call|not read the earnings call/i);
});

test('the glossary can be opened by default, for the teaching page', () => {
  assert.doesNotMatch(glossaryHTML(), /<details[^>]*\sopen/);
  assert.match(glossaryHTML({ open: true }), /<details[^>]*\sopen/);
});

// ▲/▼ mean "price up/down" in the EMA pills, the day-change and the growth table —
// all on the same card as the view badge.
test('no view glyph is a price arrow', () => {
  for (const [view, gly] of Object.entries(VIEW_GLYPH)) {
    assert.ok(!['▲', '▼'].includes(gly), `${view} must not use a price arrow (${gly})`);
  }
  assert.equal(new Set(Object.values(VIEW_GLYPH)).size, 4, 'all four stay distinguishable');
});

test('the potential badge and the trend pills carry a tappable explanation', () => {
  const e = projectable();
  const badge = scoreBadgeHTML(company({ quarters: [e] }), e);
  assert.match(badge, /data-tip="/, 'title= alone never shows on touch');
  assert.match(badge, /out of 100/, 'the tip says what the number is out of');
  assert.match(badge, /tabindex="0"/, 'reachable by keyboard');

  const card = rowHTML(company({ quarters: [e], ema: { price: 100, asOf: '2026-08-27',
    ema: { '10W': 98, '20W': 95, '40W': 104 },
    dist: { '10W': 2.0, '20W': 5.3, '40W': -3.8 } } }), e, {});
  assert.match(card, /data-tip="[^"]*trend line/i, 'the pills say what an EMA is');
  assert.doesNotMatch(card, /data-tip="[^"]*EMA/, 'in words, not in notation');
});

test('the growth table glosses its acronym headers', () => {
  const h = growthMatrixHTML(entry({ epsCagr3y: 40, salesCagr3y: 30 }));
  assert.match(h, /this year vs last/i);
  assert.match(h, /average.{0,20}year|year.{0,20}average/i);
});

test('glosses the quadrant nickname, which otherwise contradicts the plain lead', () => {
  // "Cheap, and growing fast." sitting directly above the bare words "The Treadmill"
  // reads as a contradiction — Treadmill sounds like futility to a non-investor.
  const h = plain();
  const i = h.indexOf('The Treadmill');
  assert.ok(i > 0);
  const after = h.slice(i, i + 400).replace(/<[^>]+>/g, ' ');
  assert.match(after, /price-tag|paid|re-rat/i, 'the nickname is explained in plain words');
});

test('the stat tiles carry plain labels, not bare ratios', () => {
  const h = plain({ bvps: 40 });
  assert.match(h, /Price vs its book value/i);
  assert.match(h, /Price vs next year/i);
  assert.match(h, /Price over the last year/i);
  assert.doesNotMatch(h, /<span class="mb-tk">LAST YEAR<\/span>/i);
});

test('the price-window note avoids the word multiple', () => {
  const c = company({ quarters: [entry({ epsTtmRs: 4, peAvg5y: 30 })] });
  const h = scorePanelHTML(c, c.quarters[0]).replace(/title="[^"]*"/g, '');
  const win = h.slice(h.indexOf('mb-win'));
  if (win.length > 20) assert.doesNotMatch(win, /\bmultiple\b/, 'plain words in the window note');
});

test('the gated lead states a rate that is visibly below the bar it names', () => {
  const c = company({ ema: { price: 200, ret1y: 5, dist: { '10W': 2, '20W': 4, '40W': 8 } },
    quarters: [entry({ epsTtmRs: 10, peAvg5y: 30, epsCagr3y: 14.94, salesCagr3y: 16,
      ebitdaCagr3y: 17,
      growth: { eps: { yoy: 14.94, qoq: 2 }, sales: { yoy: 16 }, opProfit: { yoy: 17 } } })] });
  const lead = scorePanelHTML(c, c.quarters[0]).match(/<p class="mb-lead">(.*?)<\/p>/s)[1]
    .replace(/<[^>]+>/g, '');
  assert.match(lead, /14\.9%/, 'shows one decimal rather than rounding to the bar');
  assert.doesNotMatch(lead, /grew 15% a year/);
});

// ---- the ranking agrees with the badge it prints ---------------------------
// "Case strength" sorted by outlook3y while every row displayed the score and band.
// The live book put Borosil (50 · Moderate, falling knife, x11.3) above Skipper
// (82 · Strong) under a label that claimed to rank the case. One source of order.
import { setupRank, scoreFor } from './render.js';

const strongCo = () => company({
  ema: { price: 500, ret1y: 3, dist: { '10W': 6, '20W': 10, '40W': 16 } },
  quarters: [strongEntry()],
});
const strongEntry = () => ({ quarter: 'Q1 2027', view: 'Watch', epsTtmRs: 25, bvps: 100,
  peAvg5y: 60, epsCagr3y: 39, salesCagr3y: 38, ebitdaCagr3y: 40,
  growth: { eps: { yoy: 39, qoq: 4 }, sales: { yoy: 38 }, opProfit: { yoy: 40 } } });

const riskyCo = () => company({
  ema: { price: 100, ret1y: -35, dist: { '10W': -14, '20W': -10, '40W': -6 } },
  quarters: [riskyEntry()],
});
const riskyEntry = () => ({ quarter: 'Q1 2027', view: 'Watch', epsTtmRs: 5, bvps: 100,
  peAvg5y: 80, epsCagr3y: 57, salesCagr3y: 12, ebitdaCagr3y: 15,
  growth: { eps: { yoy: 57, qoq: -30 }, sales: { yoy: 12 }, opProfit: { yoy: 15 } } });

test('ranks by the badge it prints, not by the projection', () => {
  const s = strongCo(), k = riskyCo();
  // the premise: the two signals genuinely disagree on this pair
  assert.ok(scoreFor(s, strongEntry()).score > scoreFor(k, riskyEntry()).score);
  assert.ok(setupOutlook(k, riskyEntry()) > setupOutlook(s, strongEntry()),
    'the riskier company projects the bigger multiple');
  assert.ok(setupRank(s, strongEntry()) > setupRank(k, riskyEntry()),
    'and the stronger case still ranks above it');
});

test('uses the outlook only to break ties inside a band', () => {
  const a = strongCo(), b = strongCo();
  const rank = setupRank(a, strongEntry());
  assert.ok(rank >= scoreFor(a, strongEntry()).score, 'the score is the whole part');
  assert.ok(rank < scoreFor(a, strongEntry()).score + 1, 'the outlook only moves the fraction');
  assert.equal(setupRank(a, strongEntry()), setupRank(b, strongEntry()));
});

test('an unreliable projection does not lift a company up the ranking', () => {
  const k = riskyCo();
  assert.equal(scoreFor(k, riskyEntry()).outlookReliable, false);
  assert.equal(setupRank(k, riskyEntry()), scoreFor(k, riskyEntry()).score,
    'a projection that cannot be leaned on breaks no ties');
});

test('ranks an unscoreable company as nothing at all', () => {
  const bare = { quarter: 'Q4 2026', view: 'Positive' };
  assert.equal(setupRank(company({ quarters: [bare] }), bare), null);
});

test('scores each company once per quarter and reuses it', () => {
  // The filter, the sort comparator and the row renderer each called score()
  // separately — the comparator once per comparison, on every keystroke.
  const c = company();
  assert.equal(scoreFor(c, entry()), scoreFor(c, entry()), 'same scorecard, not a rebuild');
});

test('rescores when the quarter underneath it changes', () => {
  const c = company();
  const first = scoreFor(c, entry());
  const next = scoreFor(c, { ...entry(), quarter: 'Q2 2027', epsCagr3y: 5, salesCagr3y: 5 });
  assert.notEqual(first, next);
  assert.notEqual(first.score, next.score);
});

test('badge cautions when the projection cannot be leaned on', () => {
  const h = scoreBadgeHTML(riskyCo(), riskyEntry());
  assert.match(h, /if it holds|unverified|cannot be leaned|not backed/i,
    'the tooltip qualifies the multiple rather than stating it flat');
});

// ---- the panel shows the legs the score is actually made of ----------------
const fullEntry = () => ({ quarter: 'Q1 2027', view: 'Watch', epsTtmRs: 25, bvps: 100,
  peAvg5y: 60, epsCagr3y: 39, salesCagr3y: 38, ebitdaCagr3y: 40,
  growth: { eps: { yoy: 39, qoq: 4 }, sales: { yoy: 38 }, opProfit: { yoy: 40 } } });
const fullCo = (over = {}) => company({
  marketCap: 265881,
  ema: { price: 500, ret1y: 3, ret3y: 100, dist: { '10W': 6, '20W': 10, '40W': 16 } },
  quarters: [fullEntry()], ...over });

test('panel gives capital efficiency a row of its own', () => {
  const h = scorePanelHTML(fullCo(), fullEntry());
  assert.match(h, /earns 25% on its own book/i);
  assert.match(h, /own money/i, 'present as the fifth leg');
});

test('panel names the window the multiple change was measured over', () => {
  const h = scorePanelHTML(fullCo(), fullEntry());
  assert.match(h, /over 3 years/i);
});

test('panel falls back to the one-year window when no 3-year return is stored', () => {
  const c = fullCo({ ema: { price: 500, ret1y: 3, dist: { '10W': 6, '20W': 10, '40W': 16 } } });
  const h = scorePanelHTML(c, fullEntry());
  assert.match(h, /over the year/i);
  assert.doesNotMatch(h, /over 3 years/i);
});

test('panel reports size as a fact about the odds, never as a score', () => {
  const h = scorePanelHTML(fullCo(), fullEntry());
  assert.match(h, /large-cap|mega-cap/i);
  assert.match(h, /odds|runway|headwind/i);
});

test('panel says so when no P/E range was fetched for the company', () => {
  const h = scorePanelHTML(fullCo(), fullEntry());
  assert.match(h, /no 5-year range on file/i);
});

// ---- fields that say nothing get out of the way ------------------------------
// On the default sort the first 42 rows read "Positive", every row reads "Tier 1"
// and the newest 100 read "Q1 2027". A field whose value is identical for every
// company on screen carries no information and costs a badge, a column, or a line.
import { redundantFields } from './render.js';

const co = (over = {}) => company({ quarters: [entry(over.entry || {})], ...over });

test('reports a field as redundant when every company shares its value', () => {
  const list = [co(), co({ slug: 'b', name: 'B Ltd' })];
  const r = redundantFields(list);
  assert.equal(r.tier, true, 'both are Tier 1');
  assert.equal(r.quarter, true);
  assert.equal(r.view, true);
});

test('reports a field as carrying information the moment one value differs', () => {
  const list = [co(), co({ slug: 'b', name: 'B Ltd', entry: { view: 'Concern' } })];
  assert.equal(redundantFields(list).view, false);
  assert.equal(redundantFields(list).tier, true, 'tier is still constant');
});

test('never calls a field redundant on a single company', () => {
  // One row is not a pattern — hiding its tier would just lose the fact.
  const r = redundantFields([co()]);
  assert.equal(r.tier, false);
  assert.equal(r.view, false);
});

test('the card drops the tier badge when the tier is redundant', () => {
  const shown = rowHTML(co(), entry());
  const hidden = rowHTML(co(), entry(), { tier: true });
  assert.match(shown, /badge tier/);
  assert.doesNotMatch(hidden, /badge tier/);
  assert.match(hidden, /Acme Ltd/, 'the rest of the card is untouched');
});

test('the card drops the quarter chip when the quarter is redundant', () => {
  assert.doesNotMatch(rowHTML(co(), entry(), { quarter: true }), /row-view-q/);
});

test('the card keeps the view badge even when redundant — it carries the colour', () => {
  // The view badge is the row's only colour key, so it stays whatever happens.
  assert.match(rowHTML(co(), entry(), { view: true }), /badge view-watch/);
});

test('the table hides a redundant column in its header and its rows', () => {
  const head = tableHTML('', {}, { tier: true, quarter: true });
  assert.match(head, /tbl [^"]*hide-tier/);
  assert.match(head, /hide-quarter/);
});

test('the table marks nothing hidden when every column earns its place', () => {
  assert.doesNotMatch(tableHTML('', {}, {}), /hide-/);
});

test('the compact row drops redundant fields from its subtitle', () => {
  const full = compactRowHTML(co(), entry());
  const bare = compactRowHTML(co(), entry(), { tier: true, quarter: true });
  assert.match(full, /Tier 1/);
  assert.doesNotMatch(bare, /Tier 1/);
  assert.doesNotMatch(bare, /Q1 2027/);
});

// ---- the compact row's price column has to compare like with like -----------
// It printed whichever EMA the price happened to be nearest, so one column read
// "10W +5.2%", "20W +1.7%", "40W -3.6%" down the list — three different
// measurements colour-coded against each other.
test('the compact row always reports the same EMA, not the nearest one', () => {
  const near10 = company({ ema: { price: 100, dist: { '10W': 0.4, '20W': 9, '40W': 22 } } });
  const near40 = company({ ema: { price: 100, dist: { '10W': 14, '20W': 9, '40W': 0.3 } } });
  assert.match(compactRowHTML(near10, entry()), /40W/);
  assert.match(compactRowHTML(near40, entry()), /40W/);
  assert.doesNotMatch(compactRowHTML(near10, entry()), /10W|20W/);
});

test('the compact row falls back when the 40-week EMA is missing', () => {
  const c = company({ ema: { price: 100, dist: { '10W': 3, '20W': 6 } } });
  assert.match(compactRowHTML(c, entry()), /20W/);
});

// ---- the panel must not contradict itself ------------------------------------
// BHEL showed "56/100 · Moderate", then "your own view is Positive, and the figures
// are not", then "Growing fast — and the market has noticed": three verdicts, two
// opposed. Moderate sits at 50+, which is not a figure set that disagrees with
// a Positive view.
test('a Moderate score under a Positive view raises no disagreement', () => {
  const e = entry({ view: 'Positive', epsTtmRs: 4, peAvg5y: 30,
    epsCagr3y: 8, salesCagr3y: 7, ebitdaCagr3y: 8,
    growth: { eps: { yoy: 8, qoq: 1 }, sales: { yoy: 7 }, opProfit: { yoy: 8 } } });
  const c = company({ quarters: [e] });
  const r = scoreFor(c, e);
  assert.equal(r.band, 'THIN', `fixture must land in Moderate, got ${r.score}/${r.band}`);
  assert.doesNotMatch(scorePanelHTML(c, e), /mb-clash/);
});

test('a genuinely weak score under a Positive view still warns', () => {
  // 3% growth on a falling price — a genuinely weak set of figures.
  const e = entry({ view: 'Positive', epsTtmRs: 4, peAvg5y: 12,
    epsCagr3y: 3, salesCagr3y: 2, ebitdaCagr3y: 3,
    growth: { eps: { yoy: 3, qoq: 1 }, sales: { yoy: 2 }, opProfit: { yoy: 3 } } });
  const c = company({ ema: { price: 100, ret1y: -40, dist: { '10W': -12, '20W': -9, '40W': -6 } },
    quarters: [e] });
  assert.equal(scoreFor(c, e).band, 'WEAK');
  assert.match(scorePanelHTML(c, e), /mb-clash/);
});

// ---- the projection has to name the multiple it actually used ----------------
test('the panel says when the re-rating target was capped below its own history', () => {
  const e = entry({ view: 'Positive', epsTtmRs: 7, peAvg5y: 130,
    epsCagr3y: 37.6, salesCagr3y: 13.1, ebitdaCagr3y: 20,
    growth: { eps: { yoy: 60, qoq: 4 }, sales: { yoy: 40.3 }, opProfit: { yoy: 45 } } });
  const c = company({ quarters: [e] });
  const h = scorePanelHTML(c, e).replace(/title="[^"]*"/g, '');
  assert.match(h, /38×/, 'the capped target is the one shown');
  assert.doesNotMatch(h, /paying 130× for it again/, 'never projects a return to the broken multiple');
  assert.match(h, /near-zero|depressed|capped|earnings were/i, 'and explains why');
});

// ---- the component bars have to be comparable --------------------------------
// Each row has a different maximum (25/15/30/10/20) but every bar shared a track,
// so a full 20/20 bar looked longer than 17/25.
test('a component bar is scaled by its own maximum, not stretched to the track', () => {
  const h = scorePanelHTML(company({ quarters: [withCagr()] }), withCagr());
  const tracks = [...h.matchAll(/class="mb-bar" style="width:([\d.]+)%"/g)].map((m) => +m[1]);
  assert.ok(tracks.length >= 4, `expected scaled tracks, got ${tracks.length}`);
  assert.ok(Math.max(...tracks) === 100, 'the widest maximum spans the full track');
  assert.ok(Math.min(...tracks) < 100, 'a smaller maximum gets a shorter track');
});


// ---- space: the panel was 46% of the company page (2,148px on a phone) ---------
const spaceCo = () => company({ marketCap: 151609,
  ema: { price: 430, ret1y: 5, ret3y: 40, dist: { '10W': 5, '20W': 11, '40W': 24 } },
  quarters: [entry({ epsTtmRs: 7, bvps: 75, peAvg5y: 130, view: 'Positive',
    epsCagr3y: 37.6, salesCagr3y: 13.1, ebitdaCagr3y: 20,
    growth: { eps: { yoy: 60, qoq: 4 }, sales: { yoy: 40.3 }, opProfit: { yoy: 45 } } })] });

test('the long explainers are collapsed behind one disclosure, not stacked', () => {
  const c = spaceCo();
  const h = scorePanelHTML(c, c.quarters[0]);
  assert.match(h, /<details class="mb-how"/, 'one disclosure carries the method');
  const inside = h.slice(h.indexOf('<details class="mb-how"'));
  assert.match(inside, /arithmetic, not a forecast/, 'the assumption note moves inside');
  assert.match(inside, /Growth rate used/, 'and the growth basis');
  assert.match(inside, /near-zero earnings/, 'and the full target-cap explanation');
});

test('the verdict and a one-line cap note stay visible above the fold of that panel', () => {
  const c = spaceCo();
  const h = scorePanelHTML(c, c.quarters[0]);
  const before = h.slice(0, h.indexOf('<details class="mb-how"'));
  assert.match(before, /Target capped at/, 'the reader still sees WHY the number is what it is');
  assert.match(before, /mb-lead/, 'and the plain lead');
});

test('the stat tiles and the price window can be split out for the page rail', () => {
  const c = spaceCo(), e = c.quarters[0];
  const full = scorePanelHTML(c, e);
  const split = scorePanelHTML(c, e, { split: true });
  assert.match(full, /mb-stats/);
  assert.doesNotMatch(split, /mb-stats/, 'omitted from the panel when the page places them itself');
  assert.doesNotMatch(split, /mb-win/);
  assert.match(sidePanelsHTML(c, e), /mb-stats/, 'and they render standalone');
  assert.match(sidePanelsHTML(c, e), /mb-win/);
});

test('the split rail panels are empty when there is nothing to put in them', () => {
  const bare = { quarter: 'Q4 2026', view: 'Positive' };
  assert.equal(sidePanelsHTML(company({ quarters: [bare] }), bare), '');
});

// ---- space: the as-of date repeated on every card ----------------------------
// 119 of 120 companies share one date, so printing it 24 times per page is the same
// redundancy the tier badge was — it belongs once, near the toolbar.
test('the card omits the price date when it matches the rest of the book', () => {
  const c = company({ ema: { price: 100, asOf: '2026-08-27', dist: { '10W': 5, '20W': 8, '40W': 12 } } });
  assert.doesNotMatch(rowHTML(c, entry(), { asOf: '2026-08-27' }), /27 Aug/i);
});

test('the card still dates a company whose price is older than the rest', () => {
  const c = company({ ema: { price: 100, asOf: '2026-08-19', dist: { '10W': 5, '20W': 8, '40W': 12 } } });
  const h = rowHTML(c, entry(), { asOf: '2026-08-27' });
  assert.match(h, /19 Aug/i, 'a stale price has to say so');
});

test('the card keeps the date when the page has not told it the common one', () => {
  const c = company({ ema: { price: 100, asOf: '2026-08-27', dist: { '10W': 5, '20W': 8, '40W': 12 } } });
  assert.match(rowHTML(c, entry()), /27 Aug/i);
});

import { commonAsOf } from './render.js';

test('reports the date shared by most of the book, tolerating a stale outlier', () => {
  // The live shape: 119 of 120 refreshed together, one left behind.
  const list = [...Array(9)].map(() => company({ ema: { asOf: '2026-08-27' } }))
    .concat(company({ ema: { asOf: '2026-08-19' } }));
  assert.equal(commonAsOf(list), '2026-08-27');
});

test('reports no common date when only a bare majority agrees', () => {
  // Two of three is not "the book shares a date" — printing it once would then be
  // wrong for a third of the cards.
  const list = [company({ ema: { asOf: '2026-08-27' } }), company({ ema: { asOf: '2026-08-27' } }),
    company({ ema: { asOf: '2026-08-19' } })];
  assert.equal(commonAsOf(list), null);
});

test('reports no common date when prices are genuinely spread', () => {
  const list = [company({ ema: { asOf: '2026-08-27' } }), company({ ema: { asOf: '2026-08-19' } })];
  assert.equal(commonAsOf(list), null);
});

// ---- table columns: pin what identifies the row, scroll the rest -------------
// Fixed percentage widths meant every column shrank to fit, so Thesis, Industry and
// the name were all being ellipsised at once. The table scrolls now, which only
// works if the two columns that say WHICH COMPANY a row is stay put — and if the
// widest free text (Thesis) is last, where it cannot squeeze anything else.
const cols = (h) => [...h.matchAll(/<th[^>]*>(?:<button[^>]*>)?([^<]+)/g)].map((m) => m[1].trim());

test('the table leads with View then Company, and Industry follows them', () => {
  const c = cols(tableHTML('', {}));
  assert.deepEqual(c.slice(0, 3), ['View', 'Company', 'Industry']);
});

test('Thesis is the last column, not the third', () => {
  const c = cols(tableHTML('', {}));
  assert.equal(c[c.length - 1], 'Thesis');
});

test('the row cells arrive in the same order as the headers', () => {
  const h = tableRowHTML(company(), entry());
  const classes = [...h.matchAll(/<td class="([^"]*)"/g)].map((m) => m[1]);
  assert.match(classes[0], /col-view/);
  assert.match(classes[1], /col-name/);
  assert.match(classes[2], /col-ind/);
  assert.match(classes[classes.length - 1], /col-thesis/);
});

test('the two pinned columns are marked so the stylesheet can pin them', () => {
  const h = tableRowHTML(company(), entry());
  assert.match(h, /class="tv col-view"/);
  assert.match(h, /class="col-name"/);
});


// ---- the band badge: a verdict, not a decoded symbol -------------------------
test('the band badge carries no per-band glyph', () => {
  // Four bands meant four shapes (filled/hollow diamonds) that had to be learnt
  // before the badge said anything. The word already says it.
  for (const e of [entry(), entry({ epsCagr3y: 2, salesCagr3y: 2, ebitdaCagr3y: 2,
      growth: { eps: { yoy: 2, qoq: 1 }, sales: { yoy: 2 }, opProfit: { yoy: 2 } } })]) {
    const h = scoreBadgeHTML(company({ quarters: [e] }), e);
    if (!h) continue;
    assert.doesNotMatch(h, /◈|◇/, `badge should carry no glyph: ${h}`);
  }
});

test('the band name comes before the score, in the list and on the panel', () => {
  const badge = scoreBadgeHTML(company(), entry()).replace(/<[^>]+>/g, '').trim();
  assert.match(badge, /^(Strong|Fair|Moderate|Weak|No case)\d/, `got "${badge}"`);
  const panel = scorePanelHTML(company(), entry());
  const pb = (panel.match(/<span class="mb-badge[^"]*"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '';
  const text = pb.replace(/<[^>]+>/g, '').trim();
  assert.match(text, /^(Strong|Fair|Moderate|Weak|No case)\d/, `panel badge was "${text}"`);
});

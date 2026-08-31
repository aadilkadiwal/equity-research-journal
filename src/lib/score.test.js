// Tests for the Multibagger Setup Score. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score, bandFor, BANDS } from './score.js';

// Synthetic fixtures with round numbers so every expectation is exact.
const growth = (eps, sales, op, epsQoq = 5) => ({
  quarter: 'Q1 2027', view: 'Watch',
  growth: { eps: { yoy: eps, qoq: epsQoq }, sales: { yoy: sales }, opProfit: { yoy: op } },
});
const price = (ret1y, d10 = 5, d20 = 8, d40 = 12) => ({
  price: 100, ret1y, dist: { '10W': d10, '20W': d20, '40W': d40 },
});

test('reports insufficient when the quarter has no growth columns', () => {
  const r = score({ quarter: 'Q4 2026', view: 'Positive' }, price(20));
  assert.equal(r.insufficient, true);
  assert.match(r.reason, /growth/i);
});

test('reports insufficient when there is no price data', () => {
  const r = score(growth(25, 30, 30), null);
  assert.equal(r.insufficient, true);
  assert.match(r.reason, /price/i);
});

test('derives the multiple change from price return and growth', () => {
  // price +60%, trusted growth +25% -> 1.60 / 1.25 = 1.28
  const r = score(growth(25, 30, 30), price(60));
  assert.equal(r.deltaMultiple.toFixed(4), '1.2800');
});

test('takes the growth axis from EPS, leaving sales to the quality leg', () => {
  const r = score(growth(50, 10, 40), price(10));
  assert.equal(r.growth, 50);
});

test('caps the trusted growth rate at 60 percent', () => {
  const r = score(growth(300, 300, 300), price(10));
  assert.equal(r.growth, 60);
});

test('places a de-rating grower in the Treadmill quadrant', () => {
  const r = score(growth(25, 30, 30), price(0));
  assert.equal(r.quadrant.key, 'Q3');
  assert.equal(r.quadrant.name, 'The Treadmill');
});

test('places a re-rating grower in the Multibagger quadrant', () => {
  const r = score(growth(25, 30, 30), price(60));
  assert.equal(r.quadrant.key, 'Q1');
});

test('awards full unpaid-growth points when the multiple has not been paid at all', () => {
  // price flat, growth +50% -> dM = 1/1.5 = 0.667 -> <= 0.70. No P/E recorded, so
  // the change carries the whole 40-point valuation half.
  const r = score(growth(50, 55, 55), price(0));
  assert.equal(r.components.unpaid, 40);
});

test('awards no unpaid-growth points once the multiple has fully re-rated', () => {
  // price +200%, growth +25% -> dM = 3.0/1.25 = 2.4
  const r = score(growth(25, 30, 30), price(200));
  assert.equal(r.components.unpaid, 0);
});

test('flags a base effect when the growth rate is not a compounding rate', () => {
  const r = score(growth(250, 260, 260), price(20));
  assert.ok(r.flags.some((f) => f.key === 'base-effect'));
});

test('does not flag a base effect for an ordinary high grower', () => {
  const r = score(growth(45, 40, 42), price(20));
  assert.ok(!r.flags.some((f) => f.key === 'base-effect'));
});

test('flags EPS growth that sales growth does not back', () => {
  const r = score(growth(90, 10, 20), price(20));
  assert.ok(r.flags.some((f) => f.key === 'not-sales-backed'));
});

test('deducts earnings-quality points when QoQ has collapsed', () => {
  const holding = score(growth(30, 35, 35, 5), price(10));
  const collapsed = score(growth(30, 35, 35, -71), price(10));
  assert.ok(collapsed.components.quality < holding.components.quality,
    `expected collapsed quality (${collapsed.components.quality}) < holding (${holding.components.quality})`);
});

test('flags a falling knife when de-rating below every EMA', () => {
  const r = score(growth(30, 35, 35), price(-20, -6, -9, -14));
  assert.ok(r.flags.some((f) => f.key === 'falling-knife'));
});

test('does not flag a falling knife while the price is above its EMAs', () => {
  const r = score(growth(30, 35, 35), price(-20, 6, 9, 14));
  assert.ok(!r.flags.some((f) => f.key === 'falling-knife'));
});

test('rescales confirmation to the full 20 points while the concall leg is absent', () => {
  const r = score(growth(30, 35, 35), price(10, 5, 8, 12));
  assert.equal(r.components.confirmation, 20);
});

test('gives no confirmation points when the price is below every EMA', () => {
  const r = score(growth(30, 35, 35), price(10, -5, -8, -12));
  assert.equal(r.components.confirmation, 0);
});

test('falls back to the 40-week EMA distance when ret1y is missing', () => {
  const r = score(growth(25, 30, 30), price(undefined, 5, 8, 60));
  assert.equal(r.proxy, true);
  // 1.60 / 1.25 = 1.28, same as a real +60% return
  assert.equal(r.deltaMultiple.toFixed(4), '1.2800');
});

test('marks the price move as real when ret1y is present', () => {
  const r = score(growth(25, 30, 30), price(60));
  assert.equal(r.proxy, false);
});

test('scores a clean unpaid grower as EXCELLENT', () => {
  // growth +30% backed by sales, QoQ holding, price up only 5%, above all EMAs
  const r = score(growth(30, 35, 35, 4), price(5));
  assert.equal(r.band, 'STRONG');
  assert.equal(r.score, r.components.unpaid + r.components.quality
    + r.components.confirmation + r.components.efficiency);
});

test('never returns a score above 100', () => {
  const r = score(growth(60, 65, 65, 20), price(0));
  assert.ok(r.score <= 100, `got ${r.score}`);
});

test('carries a plain-English verdict', () => {
  const r = score(growth(30, 35, 35), price(5));
  assert.equal(typeof r.verdict, 'string');
  assert.ok(r.verdict.length > 10);
});

// ---- P/E level: the gate for "did it already run up?" -----------------------
// deltaMultiple only knows the DIRECTION the multiple moved. A de-rate from 70 to
// 58 and one from 12 to 10 are the same ratio and opposite situations. These tests
// pin the level behaviour that tells them apart.
import { epsTtmFor } from './score.js';

const q = (quarter, epsTtmRs) => ({ quarter, view: 'Watch', epsTtmRs,
  growth: { eps: { yoy: 30, qoq: 4 }, sales: { yoy: 35 }, opProfit: { yoy: 35 } } });

test('reads the trailing-twelve-month EPS straight off the quarter', () => {
  const r = epsTtmFor(q('Q1 2027', 26));
  assert.equal(r.value, 26);
  assert.equal(r.approx, false, 'a TTM figure needs no annualising');
});

test('returns null when the quarter carries no TTM EPS', () => {
  assert.equal(epsTtmFor(q('Q1 2027', null)), null);
  assert.equal(epsTtmFor({ quarter: 'Q4 2026' }), null);
  assert.equal(epsTtmFor(null), null);
});

test('rejects a zero or negative TTM EPS rather than inventing a P/E', () => {
  assert.equal(epsTtmFor(q('Q1 2027', 0)), null);
  assert.equal(epsTtmFor(q('Q1 2027', -4)), null);
});

test('derives the current P/E and the P/E it de-rated from', () => {
  // price 100, TTM EPS 4 -> P/E 25. dM 0.82 -> it was 25/0.82 = 30.5
  const r = score(growth(25, 30, 30), price(2), { epsTtm: 4 });
  assert.equal(r.pe.toFixed(2), '25.00');
  assert.equal(r.peThen.toFixed(1), (r.pe / r.deltaMultiple).toFixed(1));
  assert.ok(r.peThen > r.pe, 'a de-rate means it came down from a higher multiple');
});

test('flags priced-in when the multiple de-rated but is still expensive', () => {
  // P/E 50 after the de-rate against a 30x average -> earnings caught up to a rich price
  const r = score({ ...growth(25, 30, 30), peAvg5y: 30 }, price(2), { epsTtm: 2 });
  assert.equal(r.pe.toFixed(0), '50');
  assert.ok(r.flags.some((f) => f.key === 'priced-in'));
});

test('does not flag priced-in when the de-rated multiple is genuinely low', () => {
  const r = score({ ...growth(25, 30, 30), peAvg5y: 30 }, price(2), { epsTtm: 10 });
  assert.ok(r.pe < 30);
  assert.ok(!r.flags.some((f) => f.key === 'priced-in'));
});

test('an expensive company still fires the flag and scores below a cheap one', () => {
  // the book-percentile yardstick warns but never awards level points, so the
  // level component needs one of the two real yardsticks to engage
  const cheap = score({ ...growth(25, 30, 30), peAvg5y: 40 }, price(2), { epsTtm: 10 });
  const rich  = score({ ...growth(25, 30, 30), peAvg5y: 40 }, price(2), { epsTtm: 1 });
  assert.ok(rich.flags.some((f) => f.key === 'priced-in'), 'P/E 100x vs 40x must flag');
  assert.ok(!cheap.flags.some((f) => f.key === 'priced-in'), 'P/E 10x vs 40x must not');
  assert.ok(rich.score < cheap.score, `rich ${rich.score} must score below cheap ${cheap.score}`);
});

test('never flags priced-in on a company whose multiple re-rated', () => {
  // already re-rating (dM > 1) is the unpaid-growth component's job, not this gate's
  const r = score({ ...growth(25, 30, 30), peAvg5y: 30 }, price(200), { epsTtm: 2 });
  assert.ok(!r.flags.some((f) => f.key === 'priced-in'));
});

test('behaves exactly as before when no EPS figure is available', () => {
  const withCtx = score(growth(25, 30, 30), price(2), { peHigh: 30 });
  const without = score(growth(25, 30, 30), price(2));
  assert.equal(withCtx.score, without.score);
  assert.equal(withCtx.pe, null);
  assert.equal(withCtx.peThen, null);
  assert.ok(!withCtx.flags.some((f) => f.key === 'priced-in'));
});

// ---- benchmark precedence ---------------------------------------------------
// "Still expensive" needs a yardstick, and they are not equally good. The
// company's own 5-year average P/E is sector-neutral and specific; the industry
// P/E is next; the book-wide percentile is the last resort.
const withPe = (over) => ({ ...growth(25, 30, 30), ...over });

test('prefers the company own 5-year average P/E as the benchmark', () => {
  const r = score(withPe({ peAvg5y: 20, peIndustry: 99 }), price(2), { epsTtm: 2 });
  assert.equal(r.peBenchmark.value, 20);
  assert.match(r.peBenchmark.basis, /5-year/i);
  assert.ok(r.flags.some((f) => f.key === 'priced-in'), 'P/E 50 is above its own 20x average');
});

test('falls back to the industry P/E when no 5-year average is recorded', () => {
  const r = score(withPe({ peIndustry: 25 }), price(2), { epsTtm: 2 });
  assert.equal(r.peBenchmark.value, 25);
  assert.match(r.peBenchmark.basis, /industry/i);
});

test('has no benchmark at all when neither yardstick is recorded', () => {
  const r = score(withPe({}), price(2), { epsTtm: 2 });
  assert.equal(r.peBenchmark, null);
  assert.ok(!r.flags.some((f) => f.key === 'priced-in'), 'no yardstick means no verdict');
});

test('clears priced-in when the P/E sits below its own historical average', () => {
  // P/E 50 now, but this company has historically traded at 80x
  const r = score(withPe({ peAvg5y: 80 }), price(2), { epsTtm: 2 });
  assert.ok(!r.flags.some((f) => f.key === 'priced-in'),
    'cheap against its own history is not "priced in", whatever the book says');
  assert.ok(r.components.level >= 16, 'and it earns level marks for being cheap');
});

// ---- negative / collapsed earnings -----------------------------------------
// Real data (Sedemac Q4 2026: EPS -99.76% on sales +59.91%) exposed two bugs:
// the sales-backing test read a NEGATIVE ratio as "fully backed", handing a
// collapsed company full marks; and dividing by (1 + g/100) with g near -100
// blew deltaMultiple up to 467x.
const collapsed = (epsYoy, salesYoy = 60, epsQoq = 30) => ({
  quarter: 'Q4 2026', view: 'Watch',
  growth: { eps: { yoy: epsYoy, qoq: epsQoq }, sales: { yoy: salesYoy }, opProfit: { yoy: 114 } },
});

test('gives no sales-backing credit when EPS fell year-on-year', () => {
  const fell = score(collapsed(-99.76), price(12));
  const grew = score(collapsed(50), price(12));
  assert.ok(fell.components.quality < grew.components.quality,
    `collapsed quality (${fell.components.quality}) must be below healthy (${grew.components.quality})`);
  assert.ok(fell.components.quality <= 10, `expected <=10/30, got ${fell.components.quality}`);
});

test('does not describe a fallen EPS as backed by sales', () => {
  const r = score(collapsed(-99.76), price(12));
  assert.ok(!r.why.quality.some((w) => /backed by sales/i.test(w)),
    `quality reasons must not claim sales backing: ${JSON.stringify(r.why.quality)}`);
});

test('flags an earnings collapse rather than reporting a meaningless multiple', () => {
  const r = score(collapsed(-99.76), price(12));
  assert.ok(r.flags.some((f) => f.key === 'earnings-collapse'));
});

test('does not flag a collapse for an ordinary earnings decline', () => {
  const r = score(collapsed(-20, 10), price(12));
  assert.ok(!r.flags.some((f) => f.key === 'earnings-collapse'));
});

test('still places a collapsed grower in the Hope Trade quadrant', () => {
  // earnings down, multiple up — the return sits entirely in sentiment
  const r = score(collapsed(-99.76), price(12));
  assert.equal(r.quadrant.key, 'Q2');
});

test('leaves healthy positive-growth scoring untouched', () => {
  const r = score(growth(30, 35, 35, 4), price(5));
  assert.equal(r.components.quality, 30);
  assert.ok(!r.flags.some((f) => f.key === 'earnings-collapse'));
});

// ---- the priced-in margin ---------------------------------------------------
// Firing the moment a P/E exceeds its own average condemned half the book —
// roughly half of anything sits above its own average by construction. Real data
// had SPLPETRO flagged at exactly 1.00x and NAVINFLUOR at 1.03x. "Expensive"
// has to mean MEANINGFULLY above, not a rounding error above.
const atMultipleOfAvg = (x) => {
  // price 100, TTM EPS 1 -> P/E 100; set the 5-yr average so P/E = x * average
  const e = { ...growth(25, 30, 30), peAvg5y: 100 / x };
  return score(e, price(2), { epsTtm: 1 });
};

test('does not flag a company trading at its own historical multiple', () => {
  const r = atMultipleOfAvg(1.00);
  assert.ok(!r.flags.some((f) => f.key === 'priced-in'), 'at the average is fair, not expensive');
});

test('does not flag a company a few percent above its average', () => {
  for (const x of [1.03, 1.10, 1.19]) {
    const r = atMultipleOfAvg(x);
    assert.ok(!r.flags.some((f) => f.key === 'priced-in'), `${x}x of average should not flag`);
  }
});

test('flags a company well above its own historical multiple', () => {
  const r = atMultipleOfAvg(1.35);
  assert.ok(r.flags.some((f) => f.key === 'priced-in'));
});

test('withholds more unpaid-growth credit the further above its average it trades', () => {
  const mild = atMultipleOfAvg(1.35);
  const severe = atMultipleOfAvg(2.00);
  assert.ok(severe.components.level < mild.components.level,
    `severe level (${severe.components.level}) must be below mild (${mild.components.level})`);
});

test('a company at its average keeps its full unpaid-growth marks', () => {
  const fair = atMultipleOfAvg(1.00);
  const rich = atMultipleOfAvg(2.00);
  assert.ok(fair.components.level > rich.components.level);
});

// ---- valuation LEVEL as a first-class signal -------------------------------
// The objective is finding companies that ARE cheap while growing, so the level
// has to earn points, not merely avoid a penalty. deltaMultiple answers "how did
// the multiple MOVE"; level answers "is it cheap NOW". Real data showed the
// cheapest growers scoring worst (BORORENEW at 0.20x its own average scored 47).
const atLevel = (ratio, over = {}) => score(
  { ...growth(25, 30, 30), peAvg5y: 100 / ratio, ...over },
  price(2), { epsTtm: 1 });          // price 100, TTM EPS 1 -> P/E 100

test('splits the valuation half into a level component and a change component', () => {
  const r = atLevel(0.7);
  assert.equal(typeof r.components.level, 'number');
  assert.equal(typeof r.components.unpaid, 'number');
  assert.equal(r.max.level, 25);
  assert.equal(r.max.unpaid, 15);
});

test('scores a cheap company above an expensive one on identical growth', () => {
  const cheap = atLevel(0.5), rich = atLevel(1.8);
  assert.ok(cheap.components.level > rich.components.level,
    `cheap level (${cheap.components.level}) must beat rich (${rich.components.level})`);
  assert.ok(cheap.score > rich.score, `cheap ${cheap.score} must beat rich ${rich.score}`);
});

test('rewards deeper discounts more', () => {
  assert.ok(atLevel(0.5).components.level > atLevel(0.9).components.level);
});

test('gives full level marks only when cheap on the ratio AND for its growth', () => {
  // P/E 25 at half its 50x average, growing 60% -> PEG 0.42. Cheap on both lenses.
  const full = score({ quarter: 'Q1 2027', view: 'Watch', peAvg5y: 50,
    growth: { eps: { yoy: 60, qoq: 5 }, sales: { yoy: 65 }, opProfit: { yoy: 65 } } },
    price(2), { epsTtm: 4 });
  assert.equal(full.components.level, 25);
  // same P/E, but now above its average and dear for slower growth
  const none = score({ quarter: 'Q1 2027', view: 'Watch', peAvg5y: 12,
    growth: { eps: { yoy: 8, qoq: 5 }, sales: { yoy: 9 }, opProfit: { yoy: 9 } } },
    price(2), { epsTtm: 4 });
  assert.equal(none.components.level, 0);
});

test('names the own 5-year average first and weights it above the industry', () => {
  const own = atLevel(0.6);
  assert.match(own.valuation.basis, /5-year/i);
  const ind = score({ ...growth(25, 30, 30), peIndustry: 100 / 0.6 }, price(2), { epsTtm: 1 });
  assert.match(ind.valuation.basis, /industry/i);
  // the same discount counts for more against its own history than against a sector
  assert.ok(own.components.level > ind.components.level,
    `own-average leg (${own.components.level}) must outweigh industry leg (${ind.components.level})`);
});

test('blends both yardsticks when both are recorded', () => {
  const bothCheap = score({ ...growth(25, 30, 30), peAvg5y: 200, peIndustry: 200 }, price(2), { epsTtm: 1 });
  const onlyOwn  = score({ ...growth(25, 30, 30), peAvg5y: 200, peIndustry: 50 }, price(2), { epsTtm: 1 });
  assert.ok(bothCheap.components.level > onlyOwn.components.level,
    'cheap on both yardsticks must beat cheap on one');
});

test('rescales the valuation half onto the change alone when no P/E is available', () => {
  const noPe = score(growth(25, 30, 30), price(0));   // flat price, +25% growth
  assert.equal(noPe.components.level, null);
  assert.equal(noPe.max.unpaid, 40, 'with no level to judge, the change is worth all 40');
  // dM here is 1.00/1.25 = 0.80, the "mostly unpaid" band -> 84% of 40
  assert.equal(noPe.components.unpaid, 34);
  // and with a P/E present the same band is worth 84% of 15 instead
  const withPe = score({ ...growth(25, 30, 30), peAvg5y: 50 }, price(0), { epsTtm: 2 });
  assert.equal(withPe.max.unpaid, 15);
  assert.equal(withPe.components.unpaid, 13);
});

test('still totals to the sum of its parts', () => {
  const r = atLevel(0.7);
  const parts = [r.components.level, r.components.unpaid, r.components.quality,
    r.components.confirmation, r.components.efficiency];
  assert.equal(r.score, Math.min(100, parts.reduce((a, b) => a + (b || 0), 0)));
});

// ---- level: growth-adjusted, and anchored in absolute terms -----------------
// Two blind spots the real data exposed. IMFA at 14x earnings growing 35% scored
// 35 WEAK purely for being above its own average — cheap for its growth, but the
// level component never related the two. And VIYASH at 119x read as "0.60x its own
// average" — cheap only because its average was 198x, which anchors nothing.
const lvl = (over, ctx) => score({ quarter: 'Q1 2027', view: 'Watch',
  growth: { eps: { yoy: 35, qoq: 5 }, sales: { yoy: 40 }, opProfit: { yoy: 40 } }, ...over },
  price(10), ctx);

test('treats a low multiple on strong growth as cheap even above its own average', () => {
  // P/E 14 on 35% growth (PEG 0.4) but 1.5x its own 9x average
  const pegCheap = lvl({ peAvg5y: 9.3 }, { epsTtm: 100 / 14 });
  // P/E 40 on the same growth (PEG 1.1), same 1.5x its own average
  const pegRich  = lvl({ peAvg5y: 26.7 }, { epsTtm: 100 / 40 });
  assert.ok(pegCheap.components.level > pegRich.components.level,
    `PEG 0.4 (${pegCheap.components.level}) must beat PEG 1.1 (${pegRich.components.level}) at equal ratio`);
});

test('flags a multiple that is high in absolute terms whatever its history', () => {
  const r = lvl({ peAvg5y: 200 }, { epsTtm: 100 / 120 });   // P/E 120, 0.60x its own average
  assert.ok(r.flags.some((f) => f.key === 'absolute-stretch'),
    'P/E 120x must be flagged however cheap it looks against its own past');
});

test('does not flag an ordinary multiple as an absolute stretch', () => {
  const r = lvl({ peAvg5y: 30 }, { epsTtm: 100 / 25 });      // P/E 25
  assert.ok(!r.flags.some((f) => f.key === 'absolute-stretch'));
});

test('withholds full level marks from a very high multiple', () => {
  const stretched = lvl({ peAvg5y: 400 }, { epsTtm: 100 / 120 });  // 0.30x own, but 120x
  const modest    = lvl({ peAvg5y: 60 },  { epsTtm: 100 / 18 });   // 0.30x own, and 18x
  assert.ok(stretched.components.level < modest.components.level,
    `120x (${stretched.components.level}) must score below 18x (${modest.components.level}) at the same ratio`);
});

// ---- re-rate headroom: conditional upside, never a probability -------------
test('reports what a return to its own multiple would be worth', () => {
  // P/E 20 now, 30x average -> multiple x1.5 ; growth 35% -> x1.35 ; total x2.03
  const r = lvl({ peAvg5y: 30 }, { epsTtm: 100 / 20 });
  assert.ok(r.headroom != null, 'headroom must be computed when a yardstick exists');
  assert.equal(r.headroom.toFixed(2), '1.03', 'expressed as a fraction, so 1.03 = +103%');
});

test('reports no headroom when the multiple is already above its yardstick', () => {
  const r = lvl({ peAvg5y: 20 }, { epsTtm: 100 / 40 });   // trading at 2x its average
  assert.ok(r.headroom < 0.4, 'a re-rate down leaves little or negative headroom');
});

test('reports no headroom at all without a yardstick', () => {
  const r = lvl({}, { epsTtm: 100 / 20 });
  assert.equal(r.headroom, null);
});

// ---- asset-heavy sectors: P/B instead of P/E -------------------------------
// For a developer, earnings are lumpy revenue-recognition events, so P/E readings
// are noise. KOLTEPATIL ranked #1 in the whole book on a 0.25x P/E reading.
const dev = (over, ctx) => score({ quarter: 'Q1 2027', view: 'Watch', industry: 'Real Estate Developer',
  growth: { eps: { yoy: 35, qoq: 5 }, sales: { yoy: 40 }, opProfit: { yoy: 40 } }, ...over }, price(10), ctx);

test('judges an asset-heavy company on price-to-book, not its P/E history', () => {
  const r = dev({ peAvg5y: 90, bvps: 50 }, { epsTtm: 100 / 22 });   // P/E 22 vs 90 avg, P/B 2.0
  assert.match(r.valuation.basis, /book/i, `expected a book-value basis, got: ${r.valuation.basis}`);
  assert.ok(r.flags.some((f) => f.key === 'earnings-lens'),
    'must say out loud that the P/E lens was set aside');
});

test('rates a developer near book value as cheap and far above it as dear', () => {
  const cheap = dev({ bvps: 120 }, { epsTtm: 100 / 22 });   // P/B 0.83
  const dear  = dev({ bvps: 12 },  { epsTtm: 100 / 22 });   // P/B 8.3
  assert.ok(cheap.components.level > dear.components.level,
    `near book (${cheap.components.level}) must beat 8x book (${dear.components.level})`);
});

test('falls back to the P/E lens for an asset-heavy company with no book value', () => {
  const r = dev({ peAvg5y: 90 }, { epsTtm: 100 / 22 });
  assert.match(r.valuation.basis, /5-year/i);
});

test('leaves ordinary sectors on the P/E lens', () => {
  const r = lvl({ peAvg5y: 30, bvps: 50 }, { epsTtm: 100 / 25 });
  assert.match(r.valuation.basis, /5-year/i);
  assert.ok(!r.flags.some((f) => f.key === 'earnings-lens'));
});

test('does not quote P/E-based headroom for a company judged on book value', () => {
  // KOLTEPATIL printed "+529%" from a P/E yardstick it is no longer judged on
  const r = dev({ peAvg5y: 90, bvps: 50 }, { epsTtm: 100 / 22 });
  assert.equal(r.headroom, null, 'no P/B yardstick exists to re-rate toward');
});

test('reserves the absolute-stretch flag for genuine outliers', () => {
  // the book median is ~53x, so a 60x flag would mark 42% of companies
  assert.ok(!lvl({ peAvg5y: 80 }, { epsTtm: 100 / 70 }).flags.some((f) => f.key === 'absolute-stretch'),
    '70x should not be flagged in a book whose median is 53x');
  assert.ok(lvl({ peAvg5y: 200 }, { epsTtm: 100 / 120 }).flags.some((f) => f.key === 'absolute-stretch'),
    '120x should be');
});

test('still tapers level marks as the multiple climbs, below the flag threshold', () => {
  const at30 = lvl({ peAvg5y: 100 }, { epsTtm: 100 / 30 });
  const at80 = lvl({ peAvg5y: 267 }, { epsTtm: 100 / 80 });   // same 0.30x ratio
  assert.ok(at80.components.level < at30.components.level,
    `80x (${at80.components.level}) must score below 30x (${at30.components.level}) at equal ratio`);
});

// ---- the growth axis moves to a 3-year CAGR --------------------------------
// The framework's axis is "EARNINGS GROWTH (EPS CAGR)" over 3 years. One quarter
// was a stand-in, and a bad one: STLTECH read +60% on its latest quarter while its
// 3-year EPS CAGR is -74%. Real data had 36 of 124 companies non-positive over 3
// years and almost none non-positive on the quarter.
const cagr = (over) => ({ quarter: 'Q1 2027', view: 'Watch', peAvg5y: 30,
  growth: { eps: { yoy: 60, qoq: 5 }, sales: { yoy: 65 }, opProfit: { yoy: 65 } }, ...over });

test('takes the growth axis from the 3-year CAGR when it is recorded', () => {
  const r = score(cagr({ epsCagr3y: 18, salesCagr3y: 22, ebitdaCagr3y: 25 }), price(10), { epsTtm: 4 });
  assert.equal(r.growth, 18, 'the 3-year EPS CAGR');
  assert.match(r.growthBasis, /3-year/i);
});

test('prefers the 3-year figure over a flattering quarter', () => {
  // quarterly +60% but the 3-year record is negative — the quarter must not win
  const r = score(cagr({ epsCagr3y: -74, salesCagr3y: 12, ebitdaCagr3y: 5 }), price(10), { epsTtm: 4 });
  assert.equal(r.growth, -74);
  assert.ok(r.growth < 0, 'a shareholder who lost ground over 3 years is not a grower');
});

test('falls back to the quarter when no 3-year figure exists, and says so', () => {
  const r = score(cagr({}), price(10), { epsTtm: 4 });
  assert.match(r.growthBasis, /quarter/i);
  assert.ok(r.flags.some((f) => f.key === 'short-history'));
});

test('reports both windows so a disagreement is visible', () => {
  const r = score(cagr({ epsCagr3y: 10, salesCagr3y: 12, ebitdaCagr3y: 15 }), price(10), { epsTtm: 4 });
  assert.equal(r.growth, 10);
  assert.ok(r.growthQuarter > 50, 'the quarterly EPS figure stays available alongside');
});

test('flags an inflection when the quarter is far ahead of the 3-year record', () => {
  const r = score(cagr({ epsCagr3y: 4, salesCagr3y: 6, ebitdaCagr3y: 8 }), price(10), { epsTtm: 4 });
  assert.ok(r.flags.some((f) => f.key === 'inflection'), 'quarter +60 vs 3-year +4 is an inflection');
});

test('flags fading when the 3-year record is far ahead of the quarter', () => {
  const e = cagr({ epsCagr3y: 45, salesCagr3y: 50, ebitdaCagr3y: 55 });
  e.growth.eps.yoy = 4; e.growth.sales.yoy = 5; e.growth.opProfit.yoy = 5;
  const r = score(e, price(10), { epsTtm: 4 });
  assert.ok(r.flags.some((f) => f.key === 'fading'));
});

test('treats a 3-year CAGR above 100 percent as a base effect', () => {
  // GVT&D printed 490%: earnings restarted from near zero, so the rate is a reset
  // rather than something that compounds from here.
  const r = score(cagr({ epsCagr3y: 490, salesCagr3y: 31, ebitdaCagr3y: 126 }), price(10), { epsTtm: 4 });
  assert.ok(r.flags.some((f) => f.key === 'base-effect'));
  assert.equal(r.growth, 60, 'and the rate itself is still capped');
});

test('gives no valuation-level credit when growth is not positive', () => {
  // falling P/E on falling EPS is not "cheap" — the image's own tell for Q4
  const shrinking = score(cagr({ epsCagr3y: -20, salesCagr3y: -5, ebitdaCagr3y: -10 }),
    price(10), { epsTtm: 10 });   // P/E 10 against a 30x average: looks very cheap
  assert.equal(shrinking.components.level, 0,
    'a low multiple on shrinking earnings must earn nothing');
});

test('still credits level for a genuine grower at the same multiple', () => {
  const growing = score(cagr({ epsCagr3y: 20, salesCagr3y: 22, ebitdaCagr3y: 25 }),
    price(10), { epsTtm: 10 });
  assert.ok(growing.components.level > 0);
});

// ---- growth gate + the starting FORWARD multiple ---------------------------
// The caption is explicit: "Multibaggers only happen when there is a valuation
// multiple rerating + high earnings growth". Cheapness alone was reaching
// EXCELLENT on +3% growth (the image's Q2 Hope Trade scored 82).
const gated = (g3, ttm = 4) => score({ quarter: 'Q1 2027', view: 'Watch', peAvg5y: 30,
  epsCagr3y: g3, salesCagr3y: g3 + 4, ebitdaCagr3y: g3 + 6,
  growth: { eps: { yoy: g3, qoq: 5 }, sales: { yoy: g3 + 4 }, opProfit: { yoy: g3 + 6 } } },
  price(5), { epsTtm: ttm });

test('a slow grower cannot reach the top bands however cheap it looks', () => {
  const slow = gated(3, 10);            // P/E 10 vs a 30x average — very cheap
  assert.ok(!['STRONG', 'FAIR'].includes(slow.band),
    `+3% growth must not reach ${slow.band} (score ${slow.score})`);
  assert.ok(slow.flags.some((f) => f.key === 'low-growth'));
});

test('a fast grower at the same multiple is not gated', () => {
  const fast = gated(30, 10);
  assert.ok(!fast.flags.some((f) => f.key === 'low-growth'));
  assert.ok(fast.score > gated(3, 10).score);
});

test('the gate is reported so the capped band is explainable', () => {
  const slow = gated(3, 10);
  assert.ok(slow.gate != null, 'the reason for the cap must be exposed');
});

test('computes the starting forward multiple, not just the trailing one', () => {
  const r = gated(25, 4);               // P/E 25 trailing at 25% growth
  assert.ok(r.peForward != null);
  assert.equal(r.peForward.toFixed(2), (r.pe / 1.25).toFixed(2),
    'forward = trailing / (1 + growth)');
  assert.ok(r.peForward < r.pe);
});

test('scores PEG on the forward multiple, which is what an entry pays', () => {
  const r = gated(25, 4);
  assert.equal(r.valuation.peg.toFixed(3), (r.peForward / r.growth).toFixed(3));
});

test('keeps the ratio comparisons trailing, so the yardstick is like-for-like', () => {
  // the 5-year average is a TRAILING figure; comparing a forward P/E to it would
  // make every grower look cheap by a factor of (1 + growth)
  const r = gated(25, 4);
  assert.equal(r.valuation.ratio.toFixed(3), (r.pe / 30).toFixed(3));
});

test('no forward multiple when growth is not positive', () => {
  const r = gated(-10, 4);
  assert.equal(r.peForward, null);
});

// ---- forward outlook: the point of the panel -------------------------------
// The panel was reading as a verdict on the past year. The framework's question is
// forward: "what would it take to multiply, and is that precedented?" Return over
// three years = (1+CAGR)^3 x (target multiple / current multiple). Trailing P/E on
// both sides, because the target (a 5-year average) is a trailing figure.
const fwd = (g3, ttm, avg) => score({ quarter: 'Q1 2027', view: 'Watch', peAvg5y: avg,
  epsCagr3y: g3, salesCagr3y: g3 + 4, ebitdaCagr3y: g3 + 6,
  growth: { eps: { yoy: g3, qoq: 5 }, sales: { yoy: g3 + 4 }, opProfit: { yoy: g3 + 6 } } },
  price(10), { epsTtm: ttm });

test('projects a three-year outlook, not a one-year one', () => {
  // P/E 25 now, 30x target, 20% CAGR -> (30/25) x 1.2^3 = 2.07 -> +107%
  const r = fwd(20, 4, 30);
  assert.equal(r.pe.toFixed(0), '25');
  assert.equal(r.outlook3y.toFixed(2), '1.07');
});

test('states the multiple a double and a triple would each require', () => {
  const r = fwd(20, 4, 30);
  // 2x needs 2 * 25 / 1.2^3 = 28.9 ; 3x needs 43.4
  assert.equal(r.needFor2x.toFixed(1), '28.9');
  assert.equal(r.needFor3x.toFixed(1), '43.4');
});

test('says whether the multiple a triple needs is precedented', () => {
  const easy = fwd(41, 4, 39);   // fast grower, generous target
  const hard = fwd(8, 4, 12);    // slow grower, low target
  assert.ok(easy.needFor3x < easy.peBenchmark.value, 'a 3x needs less than its own average');
  assert.ok(hard.needFor3x > hard.peBenchmark.value, 'a 3x needs more than it has ever averaged');
});

test('reports no outlook without a growth rate or a target', () => {
  const noTarget = score({ quarter: 'Q1 2027', view: 'Watch', epsCagr3y: 20, salesCagr3y: 24,
    ebitdaCagr3y: 26, growth: { eps: { yoy: 20, qoq: 5 }, sales: { yoy: 24 }, opProfit: { yoy: 26 } } },
    price(10), { epsTtm: 4 });
  assert.equal(noTarget.outlook3y, null);
  const shrinking = fwd(-10, 4, 30);
  assert.equal(shrinking.outlook3y, null, 'a shrinking company has no compounding to project');
});

test('a faster compounder needs a smaller re-rate for the same multiple', () => {
  assert.ok(fwd(40, 4, 30).needFor3x < fwd(10, 4, 30).needFor3x);
});

// ---- the gate must lower the score, not just relabel it --------------------
// Capping only the band left 7 real companies showing a score above the band they
// were labelled with — ACE scored 74 and read "Fair", WENDT 52 and read "Weak".
// Harmless while the list showed the band alone; a visible contradiction the
// moment the score sits beside it.
test('a gated company scores inside the band it is labelled with', () => {
  const slow = gated(3, 10);
  assert.equal(slow.band, bandFor(slow.score),
    `band ${slow.band} must match bandFor(${slow.score}) = ${bandFor(slow.score)}`);
});

test('the gate caps the score at its band ceiling, and says what it was', () => {
  const slow = gated(3, 10);
  assert.ok(slow.score <= 64, `capped below the GOOD floor, got ${slow.score}`);
  assert.ok(slow.scoreUncapped > slow.score, 'the pre-cap score stays available');
  assert.ok(slow.gate != null);
});

test('a shrinking company is capped harder still', () => {
  const shrinking = gated(-10, 10);
  assert.ok(shrinking.score <= 47, `capped below the FAIR floor, got ${shrinking.score}`);
  assert.equal(shrinking.band, bandFor(shrinking.score));
});

test('an ungated company keeps its full score', () => {
  const fast = gated(30, 10);
  assert.equal(fast.score, fast.scoreUncapped);
  assert.equal(fast.gate, null);
});

// ---- band labels: a ladder anyone can order --------------------------------
// "Fair" above "Moderate" only reads as an order to someone who already knows the
// scale, and "No case" read as missing data — which the separate "Not enough data"
// filter option actually is.
test('the five bands are a self-ordering ladder, keyed to their thresholds', () => {
  assert.deepEqual(Object.keys(BANDS), ['STRONG', 'FAIR', 'THIN', 'WEAK', 'NONE']);
  assert.deepEqual(Object.values(BANDS).map((b) => b.label),
    ['Strong', 'Good', 'Average', 'Weak', 'Poor']);
});

// ---- the price window ------------------------------------------------------
// The band moves with price and nothing else. Solving for where it flips turns a
// static score into a price plan. Not monotonic: below its 40-week EMA the
// Confirmation component collapses, so a cheaper price can score WORSE.
import { priceWindow } from './score.js';

const win = (price) => {
  const e = { quarter: 'Q1 2027', view: 'Watch', epsTtmRs: 19.4, peAvg5y: 38.5,
    epsCagr3y: 88.1, salesCagr3y: 41, ebitdaCagr3y: 43.4,
    growth: { eps: { yoy: 70, qoq: 50 }, sales: { yoy: 29 }, opProfit: { yoy: 40 } } };
  const ema = { price, ret1y: 7, ema: { '10W': 535, '20W': 512, '40W': 487 },
    dist: { '10W': 4.6, '20W': 9.3, '40W': 14.9 } };
  return priceWindow(e, ema, { industry: 'Power' });
};

test('reports the price range over which the current band holds', () => {
  const w = win(560);
  assert.equal(w.band, 'STRONG');
  assert.ok(w.low < 560 && w.high > 560, `560 must sit inside [${w.low}, ${w.high}]`);
  assert.ok(w.high - w.low > 0);
});

test('names what it becomes just above and just below the window', () => {
  const w = win(560);
  assert.ok(w.above && w.above.band !== 'STRONG', 'a different band above');
  assert.ok(w.below && w.below.band !== 'STRONG', 'a different band below');
  assert.ok(w.above.price > 560 && w.below.price < 560);
});

test('the upper edge is where the multiple reaches its own average', () => {
  const w = win(560);
  // P/E 38.5x on EPS 19.4 is a price of about 747
  assert.ok(w.moderateAt == null || Math.abs(w.moderateAt - 747) < 40,
    `expected the Moderate edge near 747, got ${w.moderateAt}`);
});

test('handles a price already below its own trend', () => {
  const w = win(400);   // under the 40-week EMA
  assert.ok(w.band != null);
  assert.ok(w.low <= 400 && w.high >= 400);
});

test('returns nothing when the company cannot be scored', () => {
  const bare = { quarter: 'Q4 2026', view: 'Positive' };
  assert.equal(priceWindow(bare, { price: 100, dist: {} }, {}), null);
});

test('reports no price window when the growth gate is what caps the band', () => {
  // Nestle's band is capped for low growth, so it spanned Rs 438-5772 — a range
  // that says nothing, because price is not what is holding it back.
  const e = { quarter: 'Q1 2027', view: 'Watch', epsTtmRs: 20, peAvg5y: 60,
    epsCagr3y: 4, salesCagr3y: 5, ebitdaCagr3y: 6,
    growth: { eps: { yoy: 4, qoq: 2 }, sales: { yoy: 5 }, opProfit: { yoy: 6 } } };
  const ema = { price: 500, ret1y: 10, dist: { '10W': 3, '20W': 6, '40W': 9 } };
  const w = priceWindow(e, ema, {});
  assert.equal(w, null, 'a gated company has no meaningful price window');
});

test('still reports a window for an ungated company', () => {
  const w = win(560);
  assert.ok(w != null && w.high > w.low);
});

// ---- precedent: the range, not just the average -----------------------------
// "A triple needs 31x versus a 38.5x average" is a soft comparison. With the
// 5-year high/low it becomes a fact: it traded there, or it never has.
test('carries the P/E range through when one is supplied', () => {
  const e = { quarter: 'Q1 2027', view: 'Watch', epsTtmRs: 20, peAvg5y: 38.5,
    epsCagr3y: 41, salesCagr3y: 41, ebitdaCagr3y: 43,
    growth: { eps: { yoy: 41, qoq: 5 }, sales: { yoy: 41 }, opProfit: { yoy: 43 } } };
  const ema = { price: 560, ret1y: 7, dist: { '10W': 5, '20W': 9, '40W': 15 } };
  const r = score(e, ema, { epsTtm: 20, peRange: { high: 69.9, low: 16.1, median: 38.3 } });
  assert.deepEqual(r.peRange, { high: 69.9, low: 16.1, median: 38.3 });
});

test('says a triple is precedented when the multiple it needs is inside the range', () => {
  const e = { quarter: 'Q1 2027', view: 'Watch', epsTtmRs: 20, peAvg5y: 38.5,
    epsCagr3y: 41, salesCagr3y: 41, ebitdaCagr3y: 43,
    growth: { eps: { yoy: 41, qoq: 5 }, sales: { yoy: 41 }, opProfit: { yoy: 43 } } };
  const ema = { price: 560, ret1y: 7, dist: { '10W': 5, '20W': 9, '40W': 15 } };
  const r = score(e, ema, { epsTtm: 20, peRange: { high: 69.9, low: 16.1, median: 38.3 } });
  assert.ok(r.needFor3x < r.peRange.high, 'the multiple a triple needs is inside its 5-year range');
  assert.equal(r.precedent3x, true);
});

test('says a triple is unprecedented when it needs more than the 5-year high', () => {
  const e = { quarter: 'Q1 2027', view: 'Watch', epsTtmRs: 20, peAvg5y: 38.5,
    epsCagr3y: 16, salesCagr3y: 16, ebitdaCagr3y: 18,
    growth: { eps: { yoy: 16, qoq: 5 }, sales: { yoy: 16 }, opProfit: { yoy: 18 } } };
  const ema = { price: 560, ret1y: 7, dist: { '10W': 5, '20W': 9, '40W': 15 } };
  const r = score(e, ema, { epsTtm: 20, peRange: { high: 45, low: 16, median: 30 } });
  assert.ok(r.needFor3x > 45);
  assert.equal(r.precedent3x, false);
});

test('leaves the precedent unknown when no range is available', () => {
  const r = gated(30, 4);
  assert.equal(r.peRange, null);
  assert.equal(r.precedent3x, null);
});

test('a gated lead never rounds the growth rate up to the bar it is failing', () => {
  // ACE printed "grew 15% a year. A re-pricing usually needs more than 15% a year"
  // — self-contradicting, because 14.9 rounded up. Same bug class as the gate message.
  const e = { quarter: 'Q1 2027', view: 'Watch', epsTtmRs: 10, peAvg5y: 30,
    epsCagr3y: 14.94, salesCagr3y: 16, ebitdaCagr3y: 17,
    growth: { eps: { yoy: 14.94, qoq: 2 }, sales: { yoy: 16 }, opProfit: { yoy: 17 } } };
  const r = score(e, { price: 200, ret1y: 5, dist: { '10W': 2, '20W': 4, '40W': 8 } },
    { epsTtm: 10 });
  assert.ok(r.gate, 'this growth rate is gated');
  assert.ok(r.growth < 15);
});

// ---- the multiple change is measured over the growth window -----------------
// deltaMultiple divided a ONE-year price return by a THREE-year CAGR, which is
// only right if the trailing year happened to grow at the CAGR. ret3y is already
// stored for 91 of the book, so the identity can run over its own window.
const cagr3 = (rate, over = {}) => ({
  quarter: 'Q1 2027', view: 'Watch',
  epsCagr3y: rate, salesCagr3y: rate, ebitdaCagr3y: rate,
  growth: { eps: { yoy: rate, qoq: 5 }, sales: { yoy: rate }, opProfit: { yoy: rate } },
  ...over,
});

test('measures the multiple change over three years when a 3-year return is stored', () => {
  // +100% over 3y against a 20% CAGR: 2.00 / 1.20^3 = 1.1574 over the window,
  // which annualises to the cube root, 1.0499 — a slow re-rate, not a fast one.
  const r = score(cagr3(20), { price: 100, ret1y: 10, ret3y: 100, dist: { '10W': 5, '20W': 8, '40W': 12 } });
  assert.equal(r.multipleWindow, '3y');
  assert.equal(r.deltaMultiple.toFixed(4), '1.0499');
});

test('reports the whole-window multiple change alongside the annualised one', () => {
  const r = score(cagr3(20), { price: 100, ret1y: 10, ret3y: 100, dist: { '10W': 5, '20W': 8, '40W': 12 } });
  assert.equal(r.deltaMultipleFull.toFixed(4), '1.1574');
});

test('falls back to the one-year window when no 3-year return is stored', () => {
  // 1.10 / 1.20 = 0.9167 — the old identity, unchanged where ret3y is absent.
  const r = score(cagr3(20), { price: 100, ret1y: 10, dist: { '10W': 5, '20W': 8, '40W': 12 } });
  assert.equal(r.multipleWindow, '1y');
  assert.equal(r.deltaMultiple.toFixed(4), '0.9167');
});

test('keeps the one-year window when the growth axis is a single quarter', () => {
  // No 3-year CAGR recorded, so the rate is a quarterly YoY figure. Cubing it
  // would compound a number that was never a three-year rate.
  const e = { quarter: 'Q1 2027', view: 'Watch',
    growth: { eps: { yoy: 20, qoq: 5 }, sales: { yoy: 20 }, opProfit: { yoy: 20 } } };
  const r = score(e, { price: 100, ret1y: 10, ret3y: 100, dist: { '10W': 5, '20W': 8, '40W': 12 } });
  assert.equal(r.multipleWindow, '1y');
});

test('reports the multiple it de-rated from over the window it measured', () => {
  // peThen is the multiple at the START of the window: 3 years ago, not one.
  const r = score(cagr3(20, { epsTtmRs: 10, peAvg5y: 30 }),
    { price: 100, ret1y: 10, ret3y: 100, dist: { '10W': 5, '20W': 8, '40W': 12 } },
    { epsTtm: 10 });
  assert.equal(r.multipleWindow, '3y');
  assert.equal(r.peThen.toFixed(2), (r.pe / r.deltaMultipleFull).toFixed(2));
});

// ---- the growth axis is EPS, discounted once -------------------------------
// min(EPS, sales, EBITDA) penalised margin-driven growth on the growth axis, then
// earningsQuality deducted for it again, then `not-sales-backed` flagged it a
// third time — 40 of 109 live companies carried that flag. Operating leverage is a
// real multibagger engine; it belongs in the quality leg, once.
const eps3 = (e, s, o, over = {}) => ({ quarter: 'Q1 2027', view: 'Watch', peAvg5y: 30,
  epsCagr3y: e, salesCagr3y: s, ebitdaCagr3y: o,
  growth: { eps: { yoy: e, qoq: 5 }, sales: { yoy: s }, opProfit: { yoy: o } }, ...over });

test('takes the growth axis from EPS CAGR alone', () => {
  const r = score(eps3(40, 10, 12), price(10), { epsTtm: 4 });
  assert.equal(r.growth, 40, 'the shareholder’s number leads; sales does not cap it');
});

test('falls back to the quarter’s own EPS growth, not the weakest of three', () => {
  const e = { quarter: 'Q1 2027', view: 'Watch', peAvg5y: 30,
    growth: { eps: { yoy: 25, qoq: 5 }, sales: { yoy: 10 }, opProfit: { yoy: 12 } } };
  const r = score(e, price(10), { epsTtm: 4 });
  assert.equal(r.growth, 25);
  assert.equal(r.growthWindow, '1q');
});

test('a margin-driven grower is no longer gated out by its sales line', () => {
  const r = score(eps3(40, 5, 8), price(10), { epsTtm: 4 });
  assert.equal(r.gate, null, '40% EPS CAGR clears the re-rate bar on its own');
  assert.ok(!r.flags.some((f) => f.key === 'low-growth'));
});

test('measures sales backing over the same window the growth axis uses', () => {
  // 3-year CAGRs recorded, so the backing test must compare CAGR to CAGR. The
  // quarter here is deliberately the opposite shape, to prove which one was read.
  const e = eps3(40, 10, 12, { growth: { eps: { yoy: 12, qoq: 5 }, sales: { yoy: 40 }, opProfit: { yoy: 40 } } });
  const r = score(e, price(10), { epsTtm: 4 });
  assert.ok(r.why.quality.some((w) => /margin/i.test(w)),
    'EPS CAGR 4x its sales CAGR is margin-driven, whatever the quarter shows');
});

test('discounts margin-driven growth once, in the quality leg', () => {
  const backed = score(eps3(40, 38, 39), price(10), { epsTtm: 4 });
  const margin = score(eps3(40, 10, 12), price(10), { epsTtm: 4 });
  assert.equal(backed.growth, margin.growth, 'same growth axis');
  assert.ok(margin.components.quality < backed.components.quality,
    'the discount lands on quality, not on the growth rate');
  assert.ok(margin.score < backed.score);
});

test('flags EPS growth that sales does not back, over the measured window', () => {
  // The quarter is sales-backed and the 3-year record is not; the flag must read
  // the window the growth axis came from.
  const e = eps3(40, 10, 12, { growth: { eps: { yoy: 20, qoq: 5 }, sales: { yoy: 19 }, opProfit: { yoy: 19 } } });
  const r = score(e, price(10), { epsTtm: 4 });
  assert.ok(r.flags.some((f) => f.key === 'not-sales-backed'));
});

test('compares like with like when reporting a divergence', () => {
  // growthQuarter is the quarter's EPS growth, so it sits on the same axis as the
  // 3-year EPS CAGR it is being compared against.
  const e = eps3(10, 50, 50, { growth: { eps: { yoy: 55, qoq: 5 }, sales: { yoy: 8 }, opProfit: { yoy: 8 } } });
  const r = score(e, price(10), { epsTtm: 4 });
  assert.equal(r.growthQuarter, 55);
  assert.ok(r.flags.some((f) => f.key === 'inflection'));
});

// ---- D · capital efficiency: what the business earns on its own book --------
// The strongest empirical multibagger marker was missing entirely, while the input
// sat in the sheet unused: epsTtmRs / bvps is an implied ROE, available for 125 of
// 127 live companies. Viyash (3% ROE, 119x) and Kernex (71% ROE, 17x) scored 17
// points apart before this leg existed.
const roeCase = (epsTtmRs, bvps, over = {}) => ({ quarter: 'Q1 2027', view: 'Watch',
  peAvg5y: 30, epsTtmRs, bvps, epsCagr3y: 25, salesCagr3y: 24, ebitdaCagr3y: 26,
  growth: { eps: { yoy: 25, qoq: 5 }, sales: { yoy: 24 }, opProfit: { yoy: 26 } }, ...over });

test('scores capital efficiency from what the company earns on its book', () => {
  const r = score(roeCase(25, 100), price(10), { epsTtm: 25 });
  assert.equal(r.roe, 25);
  assert.equal(r.components.efficiency, 10, '25% on book earns the full leg');
});

test('gives no efficiency credit to a business earning little on its book', () => {
  const r = score(roeCase(4, 100), price(10), { epsTtm: 4 });
  assert.equal(r.roe, 4);
  assert.equal(r.components.efficiency, 0);
});

test('does not punish a company that records no book value', () => {
  const r = score(roeCase(10, undefined), price(10), { epsTtm: 10 });
  assert.equal(r.roe, null);
  assert.equal(r.components.efficiency, 4, 'unknown, not punished — the QoQ idiom');
  assert.match(r.why.efficiency, /no book value/i);
});

test('separates two identically-priced growers by what they earn on capital', () => {
  const efficient = score(roeCase(25, 100), price(10), { epsTtm: 25 });
  const not = score(roeCase(25, 500), price(10), { epsTtm: 25 });
  assert.ok(efficient.components.efficiency > not.components.efficiency);
  assert.ok(efficient.score > not.score);
});

test('flags a return on book so high the book itself is the anomaly', () => {
  // Timex prints 113.8% — either exceptional or a book depleted by write-offs and
  // buybacks. Worth saying out loud; not worth withholding the marks over.
  const r = score(roeCase(90, 100), price(10), { epsTtm: 90 });
  assert.ok(r.flags.some((f) => f.key === 'thin-book'));
  assert.equal(r.components.efficiency, 10);
});

test('does not flag an ordinary high return on book', () => {
  const r = score(roeCase(30, 100), price(10), { epsTtm: 30 });
  assert.ok(!r.flags.some((f) => f.key === 'thin-book'));
});

test('trims the valuation half to make room for capital efficiency', () => {
  const r = score(roeCase(25, 100), price(10), { epsTtm: 25 });
  assert.equal(r.max.level, 25);
  assert.equal(r.max.unpaid, 15);
  assert.equal(r.max.efficiency, 10);
});

test('the five legs still total the uncapped score', () => {
  const r = score(roeCase(25, 100), price(10), { epsTtm: 25 });
  const c = r.components;
  assert.equal(c.level + c.unpaid + c.quality + c.confirmation + c.efficiency, r.scoreUncapped);
});

test('the five maximums still total 100', () => {
  const r = score(roeCase(25, 100), price(10), { epsTtm: 25 });
  const m = r.max;
  assert.equal(m.level + m.unpaid + m.quality + m.confirmation + m.efficiency, 100);
});

// ---- size: the runway, reported not scored ---------------------------------
// marketCap sat in the data unused. A Rs 2.66 lakh cr FMCG major and a Rs 771 cr
// company cannot multibag on the same odds, but size is a fact about the ODDS, not
// about the strength of the case — so it is reported and flagged, never scored.
// Anything else would let a big number quietly overwrite the analysis.
const sized = (marketCap) => score(roeCase(25, 100), price(10),
  { epsTtm: 25, marketCap });

test('names the size bucket a company sits in', () => {
  assert.equal(sized(771).size.bucket, 'micro');
  assert.equal(sized(6497).size.bucket, 'small');
  assert.equal(sized(20000).size.bucket, 'mid');
  assert.equal(sized(60000).size.bucket, 'large');
  assert.equal(sized(265881).size.bucket, 'mega');
});

test('flags size as a headwind for a company already too big to triple easily', () => {
  const r = sized(265881);
  assert.ok(r.flags.some((f) => f.key === 'size-headwind'));
});

test('does not flag size for a company with room to run', () => {
  assert.ok(!sized(771).flags.some((f) => f.key === 'size-headwind'));
  assert.ok(!sized(6497).flags.some((f) => f.key === 'size-headwind'));
});

test('reports the market value a triple would have to add', () => {
  assert.equal(sized(265881).size.tripleTo, 797643);
});

test('leaves size out of the score entirely', () => {
  const tiny = sized(771), huge = sized(265881);
  assert.equal(tiny.score, huge.score, 'size changes the odds, not the case');
  assert.deepEqual(tiny.components, huge.components);
});

test('reports no size when no market cap is recorded', () => {
  const r = score(roeCase(25, 100), price(10), { epsTtm: 25 });
  assert.equal(r.size, null);
});

// ---- bands recalibrated to the book they have to sort ----------------------
// The old floors put the median company at 47 and the top of the book at 82: 93%
// of the scored book landed in Moderate or below, and verdictFor's own top rung
// (s >= 85) could not fire on any real company. Floors are set from the live
// distribution so the top band is a shortlist and the ladder is fully reachable.
test('places the band floors where the book actually separates', () => {
  assert.equal(bandFor(100), 'STRONG');
  assert.equal(bandFor(75), 'STRONG');
  assert.equal(bandFor(74), 'FAIR');
  assert.equal(bandFor(65), 'FAIR');
  assert.equal(bandFor(64), 'THIN');
  assert.equal(bandFor(50), 'THIN');
  assert.equal(bandFor(49), 'WEAK');
  assert.equal(bandFor(32), 'WEAK');
  assert.equal(bandFor(31), 'NONE');
  assert.equal(bandFor(0), 'NONE');
});

test('every gate ceiling holds one point below the band it caps into', () => {
  // The invariant that keeps bandFor(score) agreeing with the printed label. The
  // ceiling is a cap, not a floor: a company scoring under it keeps its own number.
  const slow = gated(3, 10);
  assert.equal(slow.band, bandFor(slow.score));
  assert.ok(slow.score <= BANDS.FAIR.min - 1, 'held below the Fair floor');
  const shrinking = gated(-10, 10);
  assert.equal(shrinking.band, bandFor(shrinking.score));
  assert.ok(shrinking.score <= BANDS.THIN.min - 1, 'held below the Moderate floor');
});

test('the strongest verdict is reachable, and fires at the top band', () => {
  // growth +39% unpaid, sales-backed, QoQ holding, above every EMA, 25% on book.
  const r = score({ quarter: 'Q1 2027', view: 'Watch', epsTtmRs: 25, bvps: 100, peAvg5y: 60,
    epsCagr3y: 39, salesCagr3y: 38, ebitdaCagr3y: 40,
    growth: { eps: { yoy: 39, qoq: 4 }, sales: { yoy: 38 }, opProfit: { yoy: 40 } } },
    { price: 500, ret1y: 3, dist: { '10W': 6, '20W': 10, '40W': 16 } }, { epsTtm: 25 });
  assert.equal(r.quadrant.key, 'Q3');
  assert.equal(r.band, 'STRONG');
  assert.match(r.verdict, /pre-re-rate/i);
});

test('the verdict ladder follows the bands, not numbers of its own', () => {
  // Same company walked down the ladder by price alone: each band gets its own rung,
  // and no rung is stranded above the highest score the book can produce.
  const entry = { quarter: 'Q1 2027', view: 'Watch', epsTtmRs: 25, bvps: 100, peAvg5y: 60,
    epsCagr3y: 39, salesCagr3y: 38, ebitdaCagr3y: 40,
    growth: { eps: { yoy: 39, qoq: 4 }, sales: { yoy: 38 }, opProfit: { yoy: 40 } } };
  const at = (price, ret1y) => score(entry,
    { price, ret1y, dist: { '10W': 6, '20W': 10, '40W': 16 } }, { epsTtm: 25 });
  const seen = new Map();
  for (let p = 300; p <= 3000; p += 25) {
    const r = at(p, 3);
    if (r.quadrant.key === 'Q3') seen.set(r.band, r.verdict);
  }
  assert.ok(seen.size >= 2, `Q3 reached ${seen.size} bands across the price range`);
  assert.equal(new Set(seen.values()).size, seen.size, 'each band gets a distinct verdict');
  // and the rung for every band it reached is one the ladder can actually produce
  for (const [band, verdict] of seen) assert.ok(verdict, `${band} has a verdict`);
});

// ---- the outlook says how far it can be trusted ----------------------------
// Sorting the book by outlook put Borosil (x19.4) at the top on a 57% CAGR that
// sales does not back, while it de-rates below every EMA. The projection is a
// product of two uncertain terms, so it is loudest exactly where it is least
// reliable. The number stays; whether it can be leaned on travels with it.
test('marks the outlook unreliable when the growth behind it is a base reset', () => {
  const r = score(cagr({ epsCagr3y: 490, salesCagr3y: 480, ebitdaCagr3y: 485 }),
    price(10), { epsTtm: 4 });
  assert.ok(r.flags.some((f) => f.key === 'base-effect'));
  assert.equal(r.outlookReliable, false);
});

test('marks the outlook unreliable while the price is a falling knife', () => {
  const r = score(eps3(30, 29, 31), { price: 100, ret1y: -40, dist: { '10W': -12, '20W': -9, '40W': -5 } },
    { epsTtm: 4 });
  assert.ok(r.flags.some((f) => f.key === 'falling-knife'));
  assert.equal(r.outlookReliable, false);
});

test('marks the outlook unreliable when sales does not back the growth', () => {
  const r = score(eps3(40, 10, 12), price(10), { epsTtm: 4 });
  assert.equal(r.outlookReliable, false);
});

test('leaves a clean projection reliable', () => {
  const r = score(eps3(30, 29, 31), price(10), { epsTtm: 4 });
  assert.equal(r.outlookReliable, true);
});

test('has no reliability verdict where there is no outlook to qualify', () => {
  const r = score(growth(25, 30, 30), price(10));   // no P/E, no benchmark
  assert.equal(r.outlook3y, null);
  assert.equal(r.outlookReliable, null);
});

// ---- the re-rating target has to be a multiple the growth rate can carry -------
// BHEL averaged 130x for five years because its profit was near zero, not because
// buyers valued it there. Projecting a return to 130x prices in the collapse rather
// than the recovery, and produced a x5.5 headline on the live page. The target is
// therefore capped at the multiple the growth rate itself supports (PEG 1).
const bhelLike = () => ({
  quarter: 'Q1 2027', view: 'Positive', epsTtmRs: 7, peAvg5y: 130,
  epsCagr3y: 37.6, salesCagr3y: 13.1, ebitdaCagr3y: 20,
  growth: { eps: { yoy: 60, qoq: 4 }, sales: { yoy: 40.3 }, opProfit: { yoy: 45 } },
});

test('caps the re-rating target at the multiple the growth rate supports', () => {
  const r = score(bhelLike(), price(30), { epsTtm: 7 });
  assert.equal(r.peBenchmark.value, 130, 'the historical average stays reported as a fact');
  assert.ok(r.peTarget < r.peBenchmark.value, 'but the projection cannot lean on it');
  assert.equal(Math.round(r.peTarget), 38, 'PEG 1 on a 37.6% grower');
});

test('says the target was capped, rather than capping it silently', () => {
  const r = score(bhelLike(), price(30), { epsTtm: 7 });
  assert.ok(r.peTargetCapped, 'the panel needs to be able to explain the number');
});

test('leaves the target alone where history is already inside what growth supports', () => {
  // 30% grower whose own average is 20x: 20x is under the PEG-1 multiple of 30x.
  const e = { quarter: 'Q1 2027', view: 'Watch', epsTtmRs: 5, peAvg5y: 20,
    epsCagr3y: 30, salesCagr3y: 28, ebitdaCagr3y: 29,
    growth: { eps: { yoy: 30, qoq: 4 }, sales: { yoy: 28 }, opProfit: { yoy: 29 } } };
  const r = score(e, price(20), { epsTtm: 5 });
  assert.equal(r.peTarget, 20);
  assert.equal(r.peTargetCapped, false);
});

test('the three-year outlook is built on the capped target, not the raw average', () => {
  const r = score(bhelLike(), price(30), { epsTtm: 7 });
  const dEps3 = Math.pow(1 + r.growth / 100, 3);
  assert.equal((r.outlook3y + 1).toFixed(3), ((r.peTarget / r.pe) * dEps3).toFixed(3));
});

test('leaves an ordinary rich multiple alone — the cap is for broken denominators', () => {
  // 30x average on a 20% grower is above PEG 1, but 30x is a multiple real earnings
  // can carry. Capping here would quietly de-rate most of the book.
  const r = fwd(20, 4, 30);
  assert.equal(r.peTarget, 30);
  assert.equal(r.peTargetCapped, false);
});

test('the bottom band reads as a verdict, not as an absence', () => {
  // The badge prints "<label> <score>/100", so "None 27/100" read as a broken
  // value rather than as the judgement it is. The filter has a separate
  // "Not enough data" option for genuine absence, and the two must not collide.
  for (const absence of [/^none$/i, /^n\/?a$/i, /unscored/i, /not scored/i, /no data/i])
    assert.doesNotMatch(BANDS.NONE.label, absence);
});

#!/usr/bin/env python3
"""python3 scripts/pe/test_pe_core.py — no deps, no network."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pe_core import company_path_from_search, id_from_page, pe_range_from_series  # noqa: E402


class CompanyPathFromSearch(unittest.TestCase):
    def test_takes_the_page_path_of_the_first_hit_with_one(self):
        hits = [{"name": "Concord Control Systems Ltd",
                 "url": "/company/543619/consolidated/"}]
        self.assertEqual(company_path_from_search(hits), "/company/543619/consolidated/")

    def test_accepts_a_symbol_path_too(self):
        # The path is only used to fetch a page; symbol or scrip code both work.
        hits = [{"url": "/company/ATHERENERG/"}]
        self.assertEqual(company_path_from_search(hits), "/company/ATHERENERG/")

    def test_skips_hits_that_carry_no_company_path(self):
        hits = [{"name": "a warehouse"}, {"url": "/screens/12/x/"},
                {"url": "/company/542669/"}]
        self.assertEqual(company_path_from_search(hits), "/company/542669/")

    def test_returns_none_when_nothing_matches(self):
        self.assertIsNone(company_path_from_search([]))
        self.assertIsNone(company_path_from_search(None))


class IdFromPage(unittest.TestCase):
    def test_reads_the_internal_id_which_is_not_the_bse_scrip_code(self):
        # The bug this exists for: Concord's URL says 543619, but the chart
        # endpoint only answers to 1275319.
        html = '<div class="card" data-company-id="1275319" data-warehouse-id="9">'
        self.assertEqual(id_from_page(html), "1275319")

    def test_falls_back_to_an_api_path_when_the_attribute_is_absent(self):
        self.assertEqual(id_from_page('<a href="/api/company/4083/add/">watch</a>'),
                         "4083")

    def test_returns_none_when_the_page_carries_no_id(self):
        self.assertIsNone(id_from_page("<html><body>not found</body></html>"))
        self.assertIsNone(id_from_page(""))


class PeRangeFromSeries(unittest.TestCase):
    def series(self, pairs):
        return {"datasets": [
            {"metric": "EPS", "values": [["2026-08-01", "9"]]},
            {"metric": "Price to Earning", "values": pairs},
        ]}

    def test_takes_high_low_and_median_over_the_window(self):
        pairs = [[f"2025-01-{d:02d}", str(v)]
                 for d, v in zip(range(1, 26), range(10, 35))]
        r = pe_range_from_series(self.series(pairs), years=5)
        self.assertEqual(r["low"], 10.0)
        self.assertEqual(r["high"], 34.0)
        self.assertEqual(r["median"], 22.0)
        self.assertEqual(r["points"], 25)

    def test_measures_five_years_back_from_the_last_point_not_from_today(self):
        # An old, delisted-looking series must still yield its own last 5 years,
        # never an empty window because "now" has moved on.
        old = [[f"2014-{m:02d}-01", "20"] for m in range(1, 13)]
        recent = [[f"2018-{m:02d}-01", "50"] for m in range(1, 13)]
        r = pe_range_from_series(self.series(old + recent), years=5)
        self.assertEqual(r["low"], 20.0)     # 2014 is inside 5y of 2018
        self.assertEqual(r["asOf"], "2018-12-01")

    def test_drops_points_outside_the_window(self):
        old = [["2010-01-01", "999"]]
        recent = [[f"2026-0{m}-01", "20"] for m in range(1, 9)] \
            + [[f"2025-0{m}-01", "30"] for m in range(1, 9)] \
            + [[f"2024-0{m}-01", "40"] for m in range(1, 9)]
        r = pe_range_from_series(self.series(old + recent), years=5)
        self.assertEqual(r["high"], 40.0, "the 2010 spike is outside the window")

    def test_ignores_nulls_and_non_positive_values(self):
        pairs = [["2026-01-01", None]] + [["2026-01-02", "0"]] \
            + [[f"2026-02-{d:02d}", "25"] for d in range(1, 26)]
        r = pe_range_from_series(self.series(pairs), years=5)
        self.assertEqual(r["points"], 25)
        self.assertEqual(r["low"], 25.0)

    def test_returns_none_when_the_series_is_too_thin_to_call_a_range(self):
        # A handful of weeks is not a five-year range; better no claim than a wrong one.
        pairs = [[f"2026-01-{d:02d}", "25"] for d in range(1, 6)]
        self.assertIsNone(pe_range_from_series(self.series(pairs), years=5))

    def test_returns_none_when_the_company_has_no_pe_at_all(self):
        # Loss-making names (Ather) have an EPS series but no P/E series.
        no_pe = {"datasets": [{"metric": "EPS", "values": [["2026-08-01", "-3"]]}]}
        self.assertIsNone(pe_range_from_series(no_pe, years=5))


if __name__ == "__main__":
    unittest.main(verbosity=2)

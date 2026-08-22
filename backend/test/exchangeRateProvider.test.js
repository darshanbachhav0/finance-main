import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchLatestUsdPenSellingRate,
  parseBcrpPayload,
  parseBcrpDate,
  selectLatestSellingRate
} from "../src/services/exchangeRateProvider.js";

test("BCRP daily period labels are converted to ISO dates", () => {
  assert.equal(parseBcrpDate("13.Jul.26"), "2026-07-13");
  assert.equal(parseBcrpDate("01.Set.2026"), "2026-09-01");
  assert.equal(parseBcrpDate("invalid"), null);
});

test("latest published rate ignores unavailable and out-of-order periods", () => {
  const latest = selectLatestSellingRate({
    periods: [
      { name: "14.Jul.26", values: ["n.d."] },
      { name: "10.Jul.26", values: ["3.397"] },
      { name: "13.Jul.26", values: ["3.406"] }
    ]
  });

  assert.deepEqual(latest, { date: "2026-07-13", rate: 3.406 });
});

test("BCRP JSON is parsed even when its server appends an HTML diagnostic", () => {
  const payload = parseBcrpPayload('{"periods":[{"name":"13.Jul.26","values":["3.406"]}]}<br><html>notice</html>');
  assert.equal(payload.periods[0].values[0], "3.406");
});

test("online lookup returns an editable USD-PEN rate payload", async () => {
  const fetchImpl = async () => ({
    ok: true,
    text: async () => '{"periods":[{"name":"13.Jul.26","values":["3.406"]}]}'
  });

  const result = await fetchLatestUsdPenSellingRate({ fetchImpl, timeoutMs: 100 });
  assert.equal(result.date, "2026-07-13");
  assert.equal(result.period, "2026-07");
  assert.equal(result.rate, 3.406);
  assert.equal(result.baseCurrency, "USD");
  assert.equal(result.quoteCurrency, "PEN");
  assert.match(result.source, /BCRPData/);
});

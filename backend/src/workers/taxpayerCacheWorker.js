import { TaxpayerProfileCache } from "../services/taxpayerProfileCache.js";
import { getSupplierAutomaticPrefill } from "../services/supplierPadronLookupService.js";

// Bounded serial work avoids launching many Chromium pages on a small web instance.
export function startTaxpayerCacheWorker() {
  let stopping = false;
  let timer;
  let wake;
  const done = (async () => {
    while (!stopping) {
      try {
        const records = await TaxpayerProfileCache.find({ nextRefreshAt: { $lte: new Date() } }).sort({ nextRefreshAt: 1 }).limit(10).lean();
        for (const record of records) {
          if (stopping) break;
          try { await getSupplierAutomaticPrefill(record._id); }
          catch {
            // Keep original evidence unchanged; expired results cannot authorize validation.
            await TaxpayerProfileCache.updateOne({ _id: record._id, expiresAt: record.expiresAt }, { $set: { nextRefreshAt: new Date(Date.now() + 3600000) } });
            console.warn("[SUNAT CACHE] Refresh unavailable; retry scheduled.");
          }
        }
      } catch { console.warn("[SUNAT CACHE] Scan unavailable; retry scheduled."); }
      if (!stopping) await new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, 300000); });
    }
  })();
  return { name: "sunat-cache", done, async stop() { stopping = true; clearTimeout(timer); wake?.(); await done; } };
}

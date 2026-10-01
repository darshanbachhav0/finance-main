import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";

// Only public taxpayer profiles live here; never invoice approvals or manual exceptions.
const schema = new mongoose.Schema({
  _id: String,
  profile: mongoose.Schema.Types.Mixed,
  expiresAt: Date,
  nextRefreshAt: Date
}, { timestamps: true });
export const TaxpayerProfileCache = mongoose.models.TaxpayerProfileCache || mongoose.model("TaxpayerProfileCache", schema);
export function cloudTaxpayerMode(env = process.env) {
  return String(env.SUNAT_TAXPAYER_CACHE_MODE || "").toUpperCase() === "MONGO";
}

export function profileExpiry(profile, ruc, now = Date.now()) {
  if (profile?.officialSource !== true || !["SUNAT_CONSULTA_RUC", "SUNAT_PUBLIC_PADRON_RUC"].includes(profile.source)
    || profile.found !== true || profile.data?.rucDni !== ruc || !profile.data?.legalName) {
    throw new AppError(503, "SUNAT did not return an official taxpayer profile matching this RUC.");
  }
  // Never renew old dataset evidence merely because it was read again.
  const evidenceDate = profile.source === "SUNAT_PUBLIC_PADRON_RUC" ? profile.datasetDate : profile.queriedAt;
  const timestamp = Date.parse(evidenceDate);
  const expires = timestamp + 24 * 60 * 60 * 1000;
  if (!Number.isFinite(timestamp) || timestamp > now + 60000 || expires <= now) {
    throw new AppError(503, "SUNAT taxpayer evidence is expired or unavailable. A fresh official lookup is required.");
  }
  return new Date(expires);
}

const pending = new Map();
export async function cachedTaxpayerProfile(ruc, lookup, { model = TaxpayerProfileCache, now = Date.now() } = {}) {
  if (!/^\d{11}$/.test(ruc)) throw new AppError(422, "SUNAT lookup requires an 11-digit RUC.");
  const saved = await model.findById(ruc).lean();
  if (saved?.profile && new Date(saved.expiresAt).getTime() > now) {
    profileExpiry(saved.profile, ruc, now);
    return { ...saved.profile, cached: true, cacheExpiresAt: saved.expiresAt };
  }
  if (pending.has(ruc)) return pending.get(ruc);
  const work = (async () => {
    const profile = await lookup();
    const expiresAt = profileExpiry(profile, ruc);
    await model.updateOne({ _id: ruc }, { $set: { profile, expiresAt, nextRefreshAt: expiresAt } }, { upsert: true });
    return { ...profile, cached: false, cacheExpiresAt: expiresAt };
  })();
  pending.set(ruc, work);
  try { return await work; } finally { pending.delete(ruc); }
}

export function exchangeRateDescription(evidence, source, rate, date) {
  if (!evidence) return `${source || "Historical source not recorded"} · ${rate ?? "—"} · ${String(date || "").slice(0, 10)} · Historical evidence (authority not recorded)`;
  return `${evidence.source || source} · ${evidence.rate ?? rate} · ${String(evidence.date || date || "").slice(0, 10)} · ${evidence.providerMode === "PEN" ? "PEN — no conversion" : evidence.authoritative ? "Official SUNAT" : "Reference — not authoritative"}${evidence.fallback?.used ? ` · Fallback: ${evidence.fallback.reason}; requested ${String(evidence.requestedDate || evidence.fallback.requestedDate || "").slice(0, 10)}` : ""}`;
}


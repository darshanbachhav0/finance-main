// SUNAT calendar dates have no time of day. Keep them date-only in storage.
export function sunatCalendarDate(value) {
  const text = String(value || "").trim();
  const local = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = local ? `${local[3]}-${local[2]}-${local[1]}` : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : "";
}

export function representativeDocumentType(value) {
  const type = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
  if (type === "DNI" || type.includes("NACIONAL DE IDENTIDAD")) return "DNI";
  if (type === "CE" || type.includes("EXTRANJER")) return "CE";
  if (type === "RUC") return "RUC";
  if (type === "PASAPORTE" || type === "PASSPORT") return "PASAPORTE";
  return "";
}

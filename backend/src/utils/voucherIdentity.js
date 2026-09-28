// Canonical fiscal-voucher identity shared by duplicate checks, SunatVoucher, AccountsPayable and
// the A2 batch parser. SUNAT identifies a CPE by issuer RUC + document type (Tabla 10) + series +
// correlative number, where the correlative is numeric: F001-00001234 and F001-1234 are the same
// voucher, and document type "01" is FACTURA.

// SUNAT Tabla 10 (tipos de comprobante) codes for the document types this platform handles.
export const SUNAT_DOCUMENT_TYPE_CODES = Object.freeze({
  FACTURA: "01",
  RXH: "02",
  BOLETA: "03",
  NOTA_CREDITO: "07",
  NOTA_DEBITO: "08",
  TICKET: "12",
  RECIBO: "00"
});

const aliases = Object.freeze({
  "01": "FACTURA", "1": "FACTURA", FACTURA: "FACTURA", "FACTURAELECTRONICA": "FACTURA",
  "02": "RXH", "2": "RXH", RXH: "RXH", "RECIBOPORHONORARIOS": "RXH", "RECIBOHONORARIOS": "RXH",
  "03": "BOLETA", "3": "BOLETA", BOLETA: "BOLETA", "BOLETADEVENTA": "BOLETA", "BOLETAELECTRONICA": "BOLETA",
  "07": "NOTA_CREDITO", "7": "NOTA_CREDITO", "NOTACREDITO": "NOTA_CREDITO", "NOTADECREDITO": "NOTA_CREDITO", NC: "NOTA_CREDITO", CREDITNOTE: "NOTA_CREDITO",
  "08": "NOTA_DEBITO", "8": "NOTA_DEBITO", "NOTADEBITO": "NOTA_DEBITO", "NOTADEDEBITO": "NOTA_DEBITO", ND: "NOTA_DEBITO", DEBITNOTE: "NOTA_DEBITO",
  "12": "TICKET", TICKET: "TICKET"
});

export const ADJUSTMENT_NOTE_TYPES = Object.freeze(["NOTA_CREDITO", "NOTA_DEBITO"]);

// Voucher types whose IGV cannot be claimed as tax credit.
export const NON_CREDITABLE_IGV_VOUCHER_TYPES = Object.freeze(["BOLETA", "TICKET"]);

function compact(value) {
  return String(value ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toUpperCase().replace(/[\s_.-]+/g, "");
}

export function canonicalVoucherType(value, fallback = "FACTURA") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return aliases[compact(raw)] || raw.toUpperCase().replace(/\s+/g, "_");
}

export function sunatDocumentTypeCode(value) {
  return SUNAT_DOCUMENT_TYPE_CODES[canonicalVoucherType(value)] || "";
}

// Every stored spelling of one canonical voucher type, so legacy rows ("01", "FACTURA") still match.
export function voucherTypeVariants(value) {
  const canonical = canonicalVoucherType(value);
  const code = SUNAT_DOCUMENT_TYPE_CODES[canonical];
  return [...new Set([canonical, code, code ? String(Number(code)) : undefined].filter(Boolean))];
}

export function canonicalSeries(value) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

// Strips leading zeros from a purely numeric correlative; non-numeric correlatives are kept as-is.
export function canonicalVoucherNumber(value) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (/^\d+$/.test(normalized)) return normalized.replace(/^0+(?=\d)/, "");
  return normalized;
}

export function isAdjustmentNote(voucherType) {
  return ADJUSTMENT_NOTE_TYPES.includes(canonicalVoucherType(voucherType));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Matches a stored number with or without leading zeros (legacy rows were stored unpadded or padded).
export function voucherNumberPattern(number) {
  const canonical = canonicalVoucherNumber(number);
  return /^\d+$/.test(canonical) ? new RegExp(`^0*${canonical}$`) : new RegExp(`^${escapeRegex(canonical)}$`);
}

export function seriesNumberPattern(series, number) {
  const canonical = canonicalVoucherNumber(number);
  const seriesPart = escapeRegex(canonicalSeries(series));
  return /^\d+$/.test(canonical) ? new RegExp(`^${seriesPart}-0*${canonical}$`) : new RegExp(`^${seriesPart}-${escapeRegex(canonical)}$`);
}

export function canonicalSeriesNumber(value) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const [series, ...rest] = normalized.split("-");
  if (!rest.length) return normalized;
  return `${series}-${canonicalVoucherNumber(rest.join("-"))}`;
}

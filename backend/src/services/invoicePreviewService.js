import Supplier from "../models/Supplier.js";
import { parseInvoiceEvidence } from "./xmlValidationService.js";

// Reads a factura (XML or PDF) dropped on a new request so the form can fill itself: the invoice
// fields as the platform reads them, and the registered supplier with that RUC, if any. Nothing
// is stored; the file is attached to the request only when the request itself is saved.
export async function previewInvoiceForRequest(filePath, { env = process.env } = {}) {
  const buyerRuc = String(env.SIRE_TAXPAYER_RUC || "").replace(/\D/g, "") || undefined;
  const { source, data } = await parseInvoiceEvidence(filePath, { buyerRuc });
  const supplier = data.ruc
    ? await Supplier.findOne({ $or: [{ normalizedIdentifier: data.ruc }, { rucDni: data.ruc }] })
      .select("_id legalName name rucDni supplierCode homologationStatus active")
      .lean()
    : null;
  return { source, invoice: data, supplier: supplier || null };
}

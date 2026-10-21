import Supplier from "../models/Supplier.js";
import { canSeeSupplier } from "./supplierVisibilityService.js";
import { parseInvoiceEvidence, readInvoiceXmlLines } from "./xmlValidationService.js";

// Reads a factura (XML or PDF) dropped on a new request so the form can fill itself: the invoice
// fields as the platform reads them, its item lines (XML only) and the registered supplier with
// that RUC, if any. Nothing is stored; the file is attached to the request only when the request
// itself is saved.
export async function previewInvoiceForRequest(filePath, { env = process.env, user } = {}) {
  const buyerRuc = String(env.SIRE_TAXPAYER_RUC || "").replace(/\D/g, "") || undefined;
  const { source, data } = await parseInvoiceEvidence(filePath, { buyerRuc });
  const lines = source === "XML" ? await readInvoiceXmlLines(filePath) : [];
  const supplier = data.ruc
    ? await Supplier.findOne({ $or: [{ normalizedIdentifier: data.ruc }, { rucDni: data.ruc }] })
      .select("_id legalName name rucDni supplierCode homologationStatus active departments proposedBy")
      .lean()
    : null;
  // Another area's supplier is not offered: the requester is told it is registered and can ask
  // Accounting to share it.
  if (supplier && user && !canSeeSupplier(supplier, user)) {
    return { source, invoice: { ...data, lines }, supplier: null, supplierElsewhere: { _id: supplier._id, supplierCode: supplier.supplierCode, legalName: supplier.legalName || supplier.name } };
  }
  if (supplier) {
    delete supplier.departments;
    delete supplier.proposedBy;
  }
  return { source, invoice: { ...data, lines }, supplier: supplier || null };
}

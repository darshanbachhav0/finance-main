// Reuse evidence only while the identity, validity and risk signals still agree.
// This concerns the supplier's RUC; it never validates an individual invoice.
export function supplierVerificationCurrent(supplier, now = new Date()) {
  const evidence = supplier?.taxpayerValidation;
  const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return Boolean(evidence?.status === "VALID" && evidence.validatedAt && !evidence.revalidationRequired
    && ["ACTIVE", "MANUALLY_VALIDATED"].includes(supplier.taxpayerStatus)
    && evidence.identifierMatch === "MATCH" && evidence.legalNameMatch === "MATCH"
    && normalize(evidence.returnedIdentifier) === normalize(supplier.normalizedIdentifier || supplier.rucDni)
    && normalize(evidence.returnedLegalName) === normalize(supplier.legalName || supplier.name)
    && (!supplier.homologationValidUntil || new Date(supplier.homologationValidUntil) >= now)
    && !["OBSERVED", "REJECTED", "INACTIVE"].includes(supplier.homologationStatus)
    && supplier.complianceReview?.result !== "REJECTED");
}

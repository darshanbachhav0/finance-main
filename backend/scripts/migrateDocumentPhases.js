import "dotenv/config";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import { connectDB } from "../src/config/db.js";

const apply = process.argv.includes("--apply");
const legacyCodes = [
  "DOC-UMA-COTIZACION", "DOC-UMA-REEMBOLSO", "DOC-UMA-BIENES", "DOC-UMA-SERVICIOS",
  "DOC-UMA-MANTENIMIENTO", "DOC-UMA-VIAJE", "DOC-UMA-CAJA", "DOC-UMA-LIQUIDACION"
];

const canonicalRules = [
  ["DOC-A1-GOODS-SUBMISSION", "A1", "SUBMISSION", "*", "GOODS", [["QUOTATION", 3, "tres cotizaciones"]]],
  ["DOC-A1-GOODS-INVOICE", "A1", "INVOICE_REGISTRATION", "*", "GOODS", [["XML", 1, "XML de factura"], ["PDF", 1, "PDF de factura"]]],
  ["DOC-A1-GOODS-ACCOUNTING", "A1", "ACCOUNTING", "*", "GOODS", [["CONFORMITY", 1, "conformidad de bienes"]]],
  ["DOC-A1-SERVICES-SUBMISSION", "A1", "SUBMISSION", "*", "SERVICES", [["CONTRACT", 1, "contrato o acuerdo de servicio"]]],
  ["DOC-A1-SERVICES-INVOICE", "A1", "INVOICE_REGISTRATION", "*", "SERVICES", [["XML", 1, "XML de factura"], ["PDF", 1, "PDF de factura"]]],
  ["DOC-A1-SERVICES-ACCOUNTING", "A1", "ACCOUNTING", "*", "SERVICES", [["CONFORMITY", 1, "conformidad del servicio"]]],
  ["DOC-A1-FEES-SUBMISSION", "A1", "SUBMISSION", "*", "PROFESSIONAL_FEES", [["CONTRACT", 1, "contrato o acuerdo de servicio"]]],
  ["DOC-A1-FEES-INVOICE", "A1", "INVOICE_REGISTRATION", "*", "PROFESSIONAL_FEES", [["XML", 1, "XML del recibo"], ["FEE_RECEIPT", 1, "Recibo por Honorarios"]]],
  ["DOC-A1-FEES-ACCOUNTING", "A1", "ACCOUNTING", "*", "PROFESSIONAL_FEES", [["ACTIVITY_REPORT", 1, "informe de actividades"]]],
  ["DOC-A2-INVOICE", "A2", "INVOICE_REGISTRATION", "*", "*", [["XML", 1, "XML de factura"], ["PDF", 1, "PDF de factura"]]],
  ["DOC-B-SUBMISSION", "B", "SUBMISSION", "*", "*", [["XML", 1, "XML de comprobante"], ["PDF", 1, "PDF de comprobante"]]],
  ["DOC-C-RENDITION", "C", "RENDITION", "*", "*", [["RENDITION", 1, "documentos de sustento de rendición"]]]
];

function ruleDocument([code, flowType, phase, requestType, expenseNature, requirements]) {
  return {
    code, flowType, phase, requestType, expenseNature,
    requirements: requirements.map(([kind, minCount, labelKey]) => ({ kind, minCount, labelKey })),
    quotationPolicy: {
      enabled: requirements.some(([kind]) => kind === "QUOTATION"),
      minimumCount: requirements.find(([kind]) => kind === "QUOTATION")?.[1] || 3,
      allowAuthorizedException: true,
      exceptionReasonRequired: true
    },
    active: true,
    updatedAt: new Date()
  };
}

export async function migrateDocumentPhases(db, { apply = false } = {}) {
  const rules = db.collection("documentrules");
  const report = {
    mode: apply ? "APPLY" : "DRY_RUN",
    legacyRulesToDeactivate: await rules.countDocuments({ code: { $in: legacyCodes }, active: true }),
    legacyCustomRulesToDefault: await rules.countDocuments({ code: { $nin: legacyCodes }, $or: [{ flowType: { $exists: false } }, { phase: { $exists: false } }] }),
    canonicalRulesToUpsert: canonicalRules.length,
    trackBViceRectorRuleToUpsert: true,
    historicalApprovalSnapshotsModified: 0
  };
  if (apply) {
    await rules.updateMany({ code: { $in: legacyCodes }, active: true }, { $set: { active: false, updatedAt: new Date() } });
    await rules.updateMany({ code: { $nin: legacyCodes }, flowType: { $exists: false } }, { $set: { flowType: "*", updatedAt: new Date() } });
    await rules.updateMany({ code: { $nin: legacyCodes }, phase: { $exists: false } }, { $set: { phase: "SUBMISSION", updatedAt: new Date() } });
    for (const source of canonicalRules) {
      const document = ruleDocument(source);
      // Seed missing policy only; rerunning a migration must not overwrite UMA's approved configuration.
      await rules.updateOne({ code: document.code }, { $setOnInsert: { ...document, createdAt: new Date() } }, { upsert: true });
    }
    await db.collection("approvalrules").updateOne(
      { name: "Vicerrectorado - Vía B" },
      { $setOnInsert: { approvalLevel: "VICE_RECTOR", role: "Approver", area: "*", amountFrom: 0, requestType: "*", flowType: "B", required: true, sequence: 2, slaHours: 4, active: true, updatedAt: new Date(), createdAt: new Date() } },
      { upsert: true }
    );
    await rules.createIndex({ active: 1, phase: 1, flowType: 1, requestType: 1, expenseNature: 1 });
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await connectDB();
    console.log(JSON.stringify(await migrateDocumentPhases(mongoose.connection.db, { apply }), null, 2));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
}

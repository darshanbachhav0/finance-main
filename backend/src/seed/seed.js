import bcrypt from "bcrypt";
import crypto from "crypto";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";
import AccountingMapping from "../models/AccountingMapping.js";
import AccountingPeriod from "../models/AccountingPeriod.js";
import AccountsPayable from "../models/AccountsPayable.js";
import ApprovalRule from "../models/ApprovalRule.js";
import BankFormatConfiguration from "../models/BankFormatConfiguration.js";
import BudgetAllocation from "../models/BudgetAllocation.js";
import BudgetRule from "../models/BudgetRule.js";
import CostCenter from "../models/CostCenter.js";
import Counter from "../models/Counter.js";
import DirectPaymentEligibilityRule from "../models/DirectPaymentEligibilityRule.js";
import DocumentRule from "../models/DocumentRule.js";
import ExchangeRate from "../models/ExchangeRate.js";
import ExpenseType from "../models/ExpenseType.js";
import EmployeeReimbursementBankAccount from "../models/EmployeeReimbursementBankAccount.js";
import FinanceConfiguration from "../models/FinanceConfiguration.js";
import FinancialRequest from "../models/FinancialRequest.js";
import MassUploadBatch from "../models/MassUploadBatch.js";
import Project from "../models/Project.js";
import Supplier from "../models/Supplier.js";
import SupplierBankAccount from "../models/SupplierBankAccount.js";
import User from "../models/User.js";
import { approvalDecisionOptions, commitApprovedRequestBudget, decideApproval } from "../services/approvalService.js";
import { processAccountsPayable } from "../services/accountingService.js";
import { recordAudit, workflowEvent } from "../services/auditService.js";
import { createMassUploadBatch, processMassUploadBatch } from "../services/batchInvoiceService.js";
import { closeFinancialRequest, submitFinancialRequest } from "../services/requestService.js";
import { defaultQuotationPolicy } from "../services/documentRuleService.js";
import { getSunatPadronStatus } from "../services/sunatPadronService.js";
import { ensureSpotCategories, pendingDetractionAmount } from "../services/detractionService.js";
import { requiresPurchaseOrder } from "../services/procurementReadinessService.js";
import { issueProcurementOrder } from "../services/purchaseOrderService.js";
import { reviewRendition, submitRendition } from "../services/renditionService.js";
import { generatedRoot, uploadRoot } from "../services/storageService.js";
import {
  confirmTreasuryPayment,
  recordDetractionDeposit,
  generatePaymentBatch,
  reconcilePayment,
  schedulePayments
} from "../services/treasuryService.js";
import { connectDB } from "../config/db.js";
import { isMainModule } from "../workers/isMainModule.js";
import {
  APPROVAL_STAGES,
  EXPENSE_NATURE,
  FLOW_TYPE,
  FINANCE_CONFIGURATION_KEYS,
  REQUEST_STATUS,
  REQUEST_TYPE,
  ROLES
} from "../utils/constants.js";

// Only the CLI entry point reads backend/.env; an importer (e.g. the smoke test) sets its own environment.
if (isMainModule(import.meta.url)) dotenv.config();

const now = new Date();
const currentDate = now.toISOString().slice(0, 10);
const currentPeriod = currentDate.slice(0, 7);
const previousMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const closedPeriod = previousMonthDate.toISOString().slice(0, 7);
// Non-production only (guarded below): read from env so no credential is hardcoded in source.
// If unset, a random password is generated per run and printed in the seed summary notice.
const demoPassword = process.env.SEED_DEMO_PASSWORD || crypto.randomBytes(9).toString("base64url");
const demoUsdRate = 3.75;
const DEMO_RATE_LABEL = "DEMO - tipo de cambio ficticio del seed de desarrollo UMA (formato SUNAT; no publicado por SUNAT)";
const fakeReq = {
  headers: { "user-agent": "UMA development seed" },
  ip: "127.0.0.1",
  socket: { remoteAddress: "127.0.0.1" }
};

const AREAS = Object.freeze({
  HEALTH: "Facultad de Ciencias de la Salud",
  PHARMACY: "Facultad de Farmacia y Bioquímica",
  ENGINEERING: "Facultad de Ingeniería y Negocios",
  FINANCE: "Administración y Finanzas",
  RESEARCH: "Investigación y Posgrado",
  RECTORATE: "Rectorado",
  IT: "Tecnología de la Información"
});

async function upsert(Model, filter, values) {
  const insertOnly = Object.fromEntries(Object.entries(filter).filter(([key]) => values[key] === undefined));
  return Model.findOneAndUpdate(
    filter,
    { $set: values, $setOnInsert: insertOnly },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  );
}

async function seedCostCenters() {
  const definitions = {
    health: ["CC-SAL-LAB-101", "Laboratorios de Ciencias de la Salud", AREAS.HEALTH, 780000],
    pharmacy: ["CC-FAR-LAB-201", "Laboratorios de Farmacia y Bioquímica", AREAS.PHARMACY, 620000],
    engineering: ["CC-ING-TI-301", "Ingeniería e Innovación Digital", AREAS.ENGINEERING, 1050000],
    finance: ["CC-ADM-FIN-401", "Administración y Finanzas", AREAS.FINANCE, 480000],
    research: ["CC-INV-POS-501", "Investigación y Posgrado", AREAS.RESEARCH, 280000],
    rectorate: ["CC-REC-601", "Rectorado y Gerencia General", AREAS.RECTORATE, 260000]
  };
  const result = {};
  for (const [key, [code, name, area, annualBudget]] of Object.entries(definitions)) {
    result[key] = await upsert(CostCenter, { code }, {
      name,
      area,
      annualBudget,
      budgetMode: "ACTIVE",
      active: true
    });
  }
  return result;
}

async function seedUsers(costCenters) {
  const definitions = [
    {
      key: "admin",
      name: "Administración ERP UMA (Demo)",
      email: "demo.admin@uma.edu.pe",
      dni: "10000001",
      role: ROLES.ADMIN,
      area: AREAS.IT,
      approvalAreas: ["*"]
    },
    {
      key: "solicitorHealth",
      name: "Solicitante Ciencias de la Salud (Demo)",
      email: "demo.solicitante.salud@uma.edu.pe",
      dni: "10000002",
      role: ROLES.SOLICITOR,
      area: AREAS.HEALTH,
      costCenter: costCenters.health,
      authorizedCostCenters: [costCenters.health]
    },
    {
      key: "directorHealth",
      name: "Dirección de Ciencias de la Salud (Demo)",
      email: "demo.director.salud@uma.edu.pe",
      dni: "10000003",
      role: ROLES.AREA_DIRECTOR,
      approvalLevel: APPROVAL_STAGES.AREA_DIRECTOR,
      area: AREAS.HEALTH,
      approvalAreas: [AREAS.HEALTH]
    },
    {
      key: "viceRector",
      name: "Vicerrectorado Académico UMA (Demo)",
      email: "demo.vicerrector@uma.edu.pe",
      dni: "10000004",
      role: ROLES.VICE_RECTOR,
      approvalLevel: APPROVAL_STAGES.VICE_RECTOR,
      area: AREAS.RECTORATE,
      approvalAreas: ["*"]
    },
    {
      key: "budget",
      name: "Presupuesto UMA (Demo)",
      email: "demo.presupuesto@uma.edu.pe",
      dni: "10000007",
      role: ROLES.BUDGET,
      area: AREAS.FINANCE,
      approvalAreas: ["*"]
    },
    {
      key: "procurement",
      name: "Abastecimiento UMA (Demo)",
      email: "demo.abastecimiento@uma.edu.pe",
      dni: "10000013",
      role: ROLES.PROCUREMENT,
      area: AREAS.FINANCE,
      approvalAreas: ["*"]
    },
    {
      key: "accounting",
      name: "Contabilidad UMA (Demo)",
      email: "demo.contabilidad@uma.edu.pe",
      dni: "10000005",
      role: ROLES.ACCOUNTING,
      area: AREAS.FINANCE,
      approvalAreas: ["*"]
    },
    {
      key: "treasury",
      name: "Tesorería UMA (Demo)",
      email: "demo.tesoreria@uma.edu.pe",
      dni: "10000006",
      role: ROLES.TREASURY,
      area: AREAS.FINANCE,
      approvalAreas: ["*"]
    },
    {
      key: "management",
      name: "Gerencia / Rectorado UMA (Demo)",
      email: "demo.gerencia@uma.edu.pe",
      dni: "10000008",
      role: ROLES.MANAGEMENT,
      approvalLevel: APPROVAL_STAGES.RECTORATE,
      area: AREAS.RECTORATE,
      approvalAreas: ["*"]
    },
    {
      key: "solicitorPharmacy",
      name: "Solicitante Farmacia y Bioquímica (Demo)",
      email: "demo.solicitante.farmacia@uma.edu.pe",
      dni: "10000009",
      role: ROLES.SOLICITOR,
      area: AREAS.PHARMACY,
      costCenter: costCenters.pharmacy,
      authorizedCostCenters: [costCenters.pharmacy]
    },
    {
      key: "directorPharmacy",
      name: "Dirección de Farmacia y Bioquímica (Demo)",
      email: "demo.director.farmacia@uma.edu.pe",
      dni: "10000010",
      role: ROLES.AREA_DIRECTOR,
      approvalLevel: APPROVAL_STAGES.AREA_DIRECTOR,
      area: AREAS.PHARMACY,
      approvalAreas: [AREAS.PHARMACY]
    },
    {
      key: "solicitorEngineering",
      name: "Solicitante Ingeniería y Negocios (Demo)",
      email: "demo.solicitante.ingenieria@uma.edu.pe",
      dni: "10000011",
      role: ROLES.SOLICITOR,
      area: AREAS.ENGINEERING,
      costCenter: costCenters.engineering,
      authorizedCostCenters: [costCenters.engineering, costCenters.research]
    },
    {
      key: "directorEngineering",
      name: "Dirección de Ingeniería y Negocios (Demo)",
      email: "demo.director.ingenieria@uma.edu.pe",
      dni: "10000012",
      role: ROLES.AREA_DIRECTOR,
      approvalLevel: APPROVAL_STAGES.AREA_DIRECTOR,
      area: AREAS.ENGINEERING,
      approvalAreas: [AREAS.ENGINEERING]
    }
  ];

  const users = {};
  for (const [index, definition] of definitions.entries()) {
    const passwordHash = await bcrypt.hash(demoPassword, 12);
    users[definition.key] = await upsert(User, { email: definition.email }, {
      name: definition.name,
      employeeCode: `UMA-DEMO-${String(index + 1).padStart(3, "0")}`,
      email: definition.email,
      dni: definition.dni,
      passwordHash,
      role: definition.role,
      approvalLevel: definition.approvalLevel,
      approvalAreas: definition.approvalAreas || [],
      costCenter: definition.costCenter?._id,
      authorizedCostCenters: (definition.authorizedCostCenters || []).map((item) => item._id),
      area: definition.area,
      active: true
    });
  }
  users.directorsByArea = {
    [AREAS.HEALTH]: users.directorHealth,
    [AREAS.PHARMACY]: users.directorPharmacy,
    [AREAS.ENGINEERING]: users.directorEngineering
  };

  // A small manager chain so the feature is demoable without running the real
  // org-roster import: Solicitor -> Area Director -> Vice Rector -> (root).
  const chainLinks = [
    ["solicitorHealth", "directorHealth"],
    ["directorHealth", "viceRector"],
    ["solicitorPharmacy", "directorPharmacy"],
    ["directorPharmacy", "viceRector"],
    ["solicitorEngineering", "directorEngineering"],
    ["directorEngineering", "viceRector"]
  ];
  for (const [reportKey, jefeKey] of chainLinks) {
    if (users[reportKey] && users[jefeKey]) {
      users[reportKey].jefe = users[jefeKey]._id;
      await users[reportKey].save();
    }
  }
  return users;
}

async function seedExpenseTypes() {
  const definitions = {
    laboratorySupplies: {
      code: "OPE-603201",
      name: "Suministros y reactivos de laboratorio",
      category: "OPEX",
      accountingClass: "CLASS_6",
      accountNumber: "603201",
      permittedRequestTypes: [REQUEST_TYPE.OPEX, REQUEST_TYPE.PAGO_CON_COTIZACION],
      permittedExpenseNatures: [EXPENSE_NATURE.GOODS, EXPENSE_NATURE.LABORATORIES]
    },
    professionalServices: {
      code: "OPE-632101",
      name: "Servicios profesionales y consultoría",
      category: "OPEX",
      accountingClass: "CLASS_6",
      accountNumber: "632101",
      permittedRequestTypes: [
        REQUEST_TYPE.OPEX,
        REQUEST_TYPE.PAGO_CON_COTIZACION,
        REQUEST_TYPE.REEMBOLSO_CON_SUSTENTO
      ],
      permittedExpenseNatures: [
        EXPENSE_NATURE.SERVICES,
        EXPENSE_NATURE.PROFESSIONAL_FEES,
        EXPENSE_NATURE.CONSULTING
      ]
    },
    maintenance: {
      code: "OPE-634301",
      name: "Mantenimiento de laboratorios e infraestructura",
      category: "OPEX",
      accountingClass: "CLASS_6",
      accountNumber: "634301",
      // SPOT Anexo 3, 020 - Mantenimiento y reparación de bienes muebles (12% above PEN 700).
      spotCategoryCode: "020",
      permittedRequestTypes: [REQUEST_TYPE.OPEX, REQUEST_TYPE.PAGO_CON_COTIZACION],
      permittedExpenseNatures: [EXPENSE_NATURE.MAINTENANCE, EXPENSE_NATURE.INFRASTRUCTURE]
    },
    travel: {
      code: "OPE-631101",
      name: "Movilidad, viajes y entregas a rendir",
      category: "OPEX",
      accountingClass: "CLASS_6",
      accountNumber: "631101",
      permittedRequestTypes: [REQUEST_TYPE.OPEX, REQUEST_TYPE.ENTREGA_RENDIR],
      permittedExpenseNatures: [EXPENSE_NATURE.TRAVEL, EXPENSE_NATURE.PETTY_CASH]
    },
    technologyAssets: {
      code: "CAP-336101",
      name: "Equipos de cómputo y tecnología educativa",
      category: "CAPEX",
      accountingClass: "CLASS_3",
      accountNumber: "336101",
      permittedRequestTypes: [REQUEST_TYPE.CAPEX],
      permittedExpenseNatures: [EXPENSE_NATURE.EQUIPMENT, EXPENSE_NATURE.TECHNOLOGY]
    },
    laboratoryAssets: {
      code: "CAP-333111",
      name: "Equipamiento científico y de laboratorio",
      category: "CAPEX",
      accountingClass: "CLASS_3",
      accountNumber: "333111",
      permittedRequestTypes: [REQUEST_TYPE.CAPEX],
      permittedExpenseNatures: [EXPENSE_NATURE.EQUIPMENT, EXPENSE_NATURE.LABORATORIES, EXPENSE_NATURE.RESEARCH]
    },
    nonDeductible: {
      code: "NOD-659999",
      name: "Gasto no deducible configurado",
      category: "NON_DEDUCTIBLE",
      accountingClass: "NON_DEDUCTIBLE",
      accountNumber: "659999",
      permittedRequestTypes: [REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO],
      permittedExpenseNatures: [EXPENSE_NATURE.REIMBURSEMENT_LIQUIDATION],
      deductible: false
    }
  };
  const result = {};
  for (const [key, values] of Object.entries(definitions)) {
    result[key] = await upsert(ExpenseType, { code: values.code }, {
      ...values,
      deductible: values.deductible !== false,
      active: true
    });
  }
  return result;
}

async function ensureEvidence(domain, entityId, name, content) {
  const directory = path.join(uploadRoot, domain, String(entityId));
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, name);
  await fs.writeFile(filePath, content);
  return {
    originalName: name,
    filename: name,
    path: filePath,
    url: `/uploads/${domain}/${entityId}/${name}`,
    mimetype: name.endsWith(".xml") ? "application/xml" : "application/pdf",
    size: Buffer.byteLength(content)
  };
}

function minimalPdf(label) {
  return `%PDF-1.4\n% UMA DEMO EVIDENCE - ${label}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
}

function invoiceXml({ supplier, number, date, currency, net, igv, total }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <ID>${number}</ID>
  <IssueDate>${date}</IssueDate>
  <DocumentCurrencyCode>${currency}</DocumentCurrencyCode>
  <AccountingSupplierParty>
    <Party>
      <PartyIdentification><ID>${supplier.rucDni}</ID></PartyIdentification>
      <PartyLegalEntity><RegistrationName>${supplier.legalName}</RegistrationName></PartyLegalEntity>
    </Party>
  </AccountingSupplierParty>
  <TaxTotal><TaxAmount>${igv}</TaxAmount></TaxTotal>
  <LegalMonetaryTotal>
    <LineExtensionAmount>${net}</LineExtensionAmount>
    <TaxExclusiveAmount>${net}</TaxExclusiveAmount>
    <TaxInclusiveAmount>${total}</TaxInclusiveAmount>
    <PayableAmount>${total}</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>`;
}

async function seedSupplier({ key, supplierCode, identifier, name, bank, account, cci, currency, address, supplierType, admin, previousAccount, detractionAccount }) {
  const supplier = await upsert(Supplier, { rucDni: identifier }, {
    supplierCode,
    identifierType: identifier.length === 8 ? "DNI" : "RUC",
    normalizedIdentifier: identifier,
    legalName: name,
    commercialName: name,
    name,
    taxAddress: address,
    fiscalAddress: address,
    legalRepresentative: "Representante autorizado (Demo)",
    contactName: "Contacto de compras (Demo)",
    email: `proveedor.${key.toLowerCase()}@example.test`,
    phone: "900000000",
    supplierType,
    currency,
    bankName: bank,
    bankAccount: account,
    cci,
    taxpayerStatus: "MANUALLY_VALIDATED",
    complianceStatus: "COMPLIANT",
    homologationStatus: "HOMOLOGATED",
    active: true,
    status: "ACTIVE",
    compliance: {
      taxpayerActive: true,
      compliant: true,
      validatedAt: now,
      validatedBy: admin._id,
      comments: "Validación manual DEMO. No representa una consulta de producción a SUNAT."
    },
    declarations: {
      stateSanctions: { answer: "NO", comments: "Declaración ficticia para demostración.", declaredAt: now },
      complianceModel: { answer: "YES", comments: "Declaración ficticia para demostración.", declaredAt: now }
    },
    complianceReview: {
      result: "APPROVED",
      reviewedBy: admin._id,
      reviewedAt: now,
      comments: "Revisión manual DEMO; no corresponde a una validación externa."
    },
    reviewedBy: admin._id,
    reviewedAt: now,
    reviewComments: "Proveedor ficticio homologado para demostración UMA.",
    // Banco de la Nación detracciones account (fictional), where SPOT deposits go.
    ...(detractionAccount ? { detractionAccount: { accountNumber: detractionAccount, updatedAt: now, updatedBy: admin._id } } : {})
  });

  if (!supplier.documents?.length) {
    for (const [kind, fileName] of [
      ["RUC_FILE", "ficha-ruc-demo.pdf"],
      ["BANK_CERTIFICATE", "constancia-bancaria-demo.pdf"],
      ["LEGAL_REP_ID", "identidad-representante-demo.pdf"]
    ]) {
      const file = await ensureEvidence("suppliers", supplier._id, fileName, minimalPdf(`${name} - ${kind}`));
      supplier.documents.push({ kind, ...file, uploadedBy: admin._id });
    }
  }

  if (previousAccount) {
    await upsert(SupplierBankAccount, {
      supplier: supplier._id,
      bank,
      currency,
      accountNumber: previousAccount.account
    }, {
      cci: previousAccount.cci,
      accountType: "CURRENT",
      accountHolderName: name,
      active: false,
      preferred: false,
      verificationStatus: "LEGACY_ACCEPTED",
      ownershipResult: "MANUAL_ACCEPTED",
      validFrom: previousMonthDate,
      validTo: now,
      createdBy: admin._id,
      changedBy: admin._id
    });
    if (!(supplier.bankHistory || []).some((item) => item.bankAccount === previousAccount.account)) {
      supplier.bankHistory.push({
        bankName: bank,
        currency,
        accountType: "CURRENT",
        accountHolderName: name,
        bankAccount: previousAccount.account,
        cci: previousAccount.cci,
        status: "INACTIVE",
        preferred: false,
        verificationStatus: "LEGACY_ACCEPTED",
        ownershipResult: "MANUAL_ACCEPTED",
        validFrom: previousMonthDate,
        validTo: now,
        createdBy: admin._id,
        changedBy: admin._id
      });
    }
  }

  const bankAccount = await upsert(SupplierBankAccount, {
    supplier: supplier._id,
    bank,
    currency,
    accountNumber: account
  }, {
    cci,
    accountType: "CURRENT",
    accountHolderName: name,
    validFrom: now,
    active: true,
    preferred: true,
    verificationStatus: "VERIFIED",
    ownershipResult: "MANUAL_ACCEPTED",
    verifiedBy: admin._id,
    verifiedAt: now,
    verificationSource: "UMA_DEMO_MANUAL_REVIEW",
    createdBy: admin._id,
    changedBy: admin._id
  });
  if (!(supplier.bankHistory || []).some((item) => item.status === "ACTIVE" && item.bankAccount === account)) {
    supplier.bankHistory.push({
      bankName: bank,
      currency,
      accountType: "CURRENT",
      accountHolderName: name,
      bankAccount: account,
      cci,
      status: "ACTIVE",
      preferred: true,
      verificationStatus: "VERIFIED",
      ownershipResult: "MANUAL_ACCEPTED",
      verifiedBy: admin._id,
      verifiedAt: now,
      verificationSource: "UMA_DEMO_MANUAL_REVIEW",
      validFrom: now,
      createdBy: admin._id,
      changedBy: admin._id
    });
  }
  await supplier.save();
  return { supplier, bankAccount };
}

async function seedSuppliers(admin) {
  const definitions = [
    {
      key: "health",
      identifier: "20609999111",
      name: "Diagnóstico Académico Andino S.A.C. (Demo)",
      bank: "BCP",
      account: "1912345678901",
      cci: "00219101234567890123",
      currency: "PEN",
      address: "San Juan de Lurigancho, Lima (domicilio ficticio)",
      supplierType: "Equipos e insumos biomédicos"
    },
    {
      key: "pharmacy",
      identifier: "20609999226",
      name: "Reactivos Universitarios del Pacífico S.A.C. (Demo)",
      bank: "BBVA",
      account: "00110101000201234567",
      cci: "01100101234567890123",
      currency: "PEN",
      address: "Ate, Lima (domicilio ficticio)",
      supplierType: "Reactivos y material farmacéutico",
      previousAccount: { account: "00110109000209876543", cci: "01100109876543210987" }
    },
    {
      key: "engineering",
      identifier: "20609999331",
      name: "Tecnología de Laboratorios Digitales S.A.C. (Demo)",
      bank: "INTERBANK",
      account: "2003001234567",
      cci: "00320000300123456789",
      currency: "USD",
      address: "Santiago de Surco, Lima (domicilio ficticio)",
      supplierType: "Tecnología y equipamiento educativo"
    },
    {
      key: "services",
      identifier: "20609999447",
      name: "Servicios Generales Canto Bello S.R.L. (Demo)",
      bank: "SCOTIABANK",
      account: "0001234567890",
      cci: "00900000123456789012",
      currency: "PEN",
      address: "San Juan de Lurigancho, Lima (domicilio ficticio)",
      supplierType: "Mantenimiento e infraestructura",
      detractionAccount: "00000123456"
    },
    {
      key: "beneficiary",
      identifier: "11111111",
      name: "Beneficiario interno UMA (Demo)",
      bank: "BCP",
      account: "1940000000001",
      cci: "00219400000000000001",
      currency: "PEN",
      address: "Lima, Perú (persona ficticia)",
      supplierType: "Persona natural / beneficiario de rendición"
    }
  ];
  const result = {};
  for (const [index, definition] of definitions.entries()) {
    result[definition.key] = await seedSupplier({ ...definition, supplierCode: `PRV-${String(index + 1).padStart(4, "0")}`, admin });
  }

  result.pending = {
    supplier: await upsert(Supplier, { rucDni: "20609999668" }, {
      identifierType: "RUC",
      normalizedIdentifier: "20609999668",
      legalName: "Mobiliario Académico Lima S.A.C. (Demo)",
      name: "Mobiliario Académico Lima S.A.C. (Demo)",
      taxAddress: "Lima, Perú (domicilio ficticio)",
      fiscalAddress: "Lima, Perú (domicilio ficticio)",
      email: "proveedor.pendiente@example.test",
      phone: "900000000",
      supplierType: "Mobiliario educativo",
      currency: "PEN",
      taxpayerStatus: "PENDING",
      complianceStatus: "PENDING",
      homologationStatus: "PENDING_VALIDATION",
      active: false,
      status: "PENDING_VALIDATION",
      reviewComments: "Pendiente de ficha RUC, certificado bancario y revisión de Contabilidad."
    })
  };
  return result;
}

async function seedEmployeeReimbursementBanking(users) {
  await upsert(EmployeeReimbursementBankAccount, { user: users.solicitorHealth._id, active: true, preferred: true }, {
    bank: "BCP",
    currency: "PEN",
    accountHolderName: users.solicitorHealth.name,
    accountNumber: "1941000000001",
    cci: "00219410000000000001",
    verificationStatus: "VERIFIED",
    verifiedBy: users.accounting._id,
    verifiedAt: now,
    verificationSource: "UMA_DEMO_MANUAL_REVIEW",
    validFrom: now,
    createdBy: users.admin._id,
    changedBy: users.accounting._id
  });
}

async function seedPeriodsAndRates(admin) {
  await upsert(AccountingPeriod, { period: currentPeriod }, {
    status: "OPEN",
    openedAt: now,
    openedBy: admin._id,
    comments: "Periodo abierto para la demostración integral UMA.",
    history: [{ action: "CREATED", at: now, by: admin._id, comments: "Periodo demo UMA." }]
  });
  await upsert(FinanceConfiguration, {
    key: FINANCE_CONFIGURATION_KEYS.LOCAL_MOBILITY_DAILY_LIMIT,
    effectiveFrom: new Date(Date.UTC(2026, 0, 1))
  }, {
    numericValue: 41,
    currency: "PEN",
    behavior: "WARNING",
    effectiveTo: null,
    active: true,
    description: "Monto diario de movilidad local por colaborador; genera advertencia, no rechazo automático.",
    source: "Formato_Rendicion_Gastos_UMA.xlsx, Rendición de Gastos, A12:E12",
    createdBy: admin._id,
    updatedBy: admin._id
  });
  await upsert(FinanceConfiguration, {
    key: FINANCE_CONFIGURATION_KEYS.RENDITION_OVERDUE_DAYS,
    effectiveFrom: new Date(Date.UTC(2026, 0, 1))
  }, {
    numericValue: 10,
    currency: "PEN",
    behavior: "INFORMATION",
    effectiveTo: null,
    active: true,
    description: "Días hábiles (sin fines de semana ni feriados) permitidos para rendir un anticipo (Track C) desde su pago; una rendición vencida y no presentada bloquea nuevos anticipos.",
    source: "Configuración Finanzas - Rendición de Gastos",
    createdBy: admin._id,
    updatedBy: admin._id
  });
  await upsert(FinanceConfiguration, {
    key: FINANCE_CONFIGURATION_KEYS.SUPPLIER_HOMOLOGATION_VALIDITY_MONTHS,
    effectiveFrom: new Date(Date.UTC(2026, 0, 1))
  }, {
    numericValue: 12,
    currency: "PEN",
    behavior: "INFORMATION",
    effectiveTo: null,
    active: true,
    description: "Meses de vigencia de la homologación de un proveedor antes de requerir re-homologación.",
    source: "Configuración Finanzas - Homologación de Proveedores",
    createdBy: admin._id,
    updatedBy: admin._id
  });
  await upsert(AccountingPeriod, { period: closedPeriod }, {
    status: "CLOSED",
    openedAt: previousMonthDate,
    openedBy: admin._id,
    closedAt: now,
    closingDate: now,
    closedBy: admin._id,
    comments: "Periodo cerrado para demostrar el bloqueo contable.",
    history: [
      { action: "CREATED", at: previousMonthDate, by: admin._id },
      { action: "CLOSED", at: now, by: admin._id, comments: "Cierre mensual demo UMA." }
    ]
  });
  // DEMO exchange rates. The rate service only accepts a saved rate as authoritative when it is
  // stored as a SUNAT selling rate, so the seed stores one per calendar day from the start of the
  // closed demo period through today. They are fictional values that merely use SUNAT's record
  // shape (sourceLabel says so) - this lets the seed run offline, without
  // SUNAT_EXCHANGE_RATE_ENDPOINT and without EXCHANGE_RATE_ALLOW_REFERENCE_FALLBACK. Only an
  // existing DEMO record is ever overwritten; a real rate already stored for a day is left alone.
  for (let day = new Date(previousMonthDate); day.toISOString().slice(0, 10) <= currentDate; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = new Date(day);
    const existing = await ExchangeRate.findOne({ currency: "USD", date }).lean();
    if (existing && existing.sourceLabel !== DEMO_RATE_LABEL) continue;
    await upsert(ExchangeRate, { currency: "USD", date }, {
      quoteCurrency: "PEN",
      period: date.toISOString().slice(0, 7),
      rate: demoUsdRate,
      source: "SUNAT",
      sourceLabel: DEMO_RATE_LABEL,
      providerMode: "SUNAT",
      authoritative: true,
      retrievedAt: now,
      active: true,
      createdBy: admin._id
    });
  }
}

const DEMO_BBVA_NOTES = "DEMO / NO CERTIFICADO. Layout BBVA 151/277 con cuenta de cargo y contactos ficticios del seed de desarrollo; reemplazar por los parámetros reales confirmados por Tesorería y certificar con BBVA.";

// The BBVA adapter only generates a file from a Treasury-confirmed fixed-width configuration.
// The seed installs one with the 151/277 layout constants but a fictional debit account and
// contacts, left uncertified (a non-production environment accepts that). It never replaces a
// configuration that Treasury/Admin set up themselves.
async function seedBbvaFormat(currency) {
  const existing = await BankFormatConfiguration.findOne({ bank: "BBVA", currency }).lean();
  if (existing && existing.mode !== "DEMO" && existing.notes !== DEMO_BBVA_NOTES) return;
  await upsert(BankFormatConfiguration, { bank: "BBVA", currency }, {
    mode: "FIXED_WIDTH",
    specificationVersion: "UMA-BBVA-151-277-v1",
    certified: false,
    certifiedAt: null,
    certifiedBy: null,
    certificationReference: "",
    notes: DEMO_BBVA_NOTES,
    active: true,
    bbva: {
      confirmed: true,
      encoding: "latin1",
      lineEnding: "LF",
      finalNewline: false,
      truncateText: true,
      debitAccount: currency === "PEN" ? "00110999000100000001" : "00110999000100000002",
      headerPrefix: "750",
      headerControl: "A".padEnd(10),
      headerLabel: "PAGO PROV".padEnd(25),
      headerTrailer: "S000000000000000000".padEnd(69),
      detailPrefix: "002",
      rucCode: "R",
      dniCode: "L",
      internalCode: "P",
      interbankCode: "I",
      internalAccountLength: 20,
      internalAccountPrefix: "",
      descriptionControl: "N",
      contactControl: "E",
      detailTrailer: "0".repeat(32).padEnd(50),
      defaultContact: "tesoreria.demo@example.test",
      orderingContact: "TESORERIA UMA DEMO",
      defaultDocumentCode: "F",
      documentCodes: { B: "B", F: "F" }
    }
  });
}

async function seedRulesAndMappings({ costCenters, expenseTypes }) {
  for (const area of [AREAS.HEALTH, AREAS.PHARMACY, AREAS.ENGINEERING]) {
    await upsert(ApprovalRule, { name: `Dirección de Área - ${area}` }, {
      approvalLevel: APPROVAL_STAGES.AREA_DIRECTOR,
      role: ROLES.AREA_DIRECTOR,
      area,
      amountFrom: 0,
      requestType: "*",
      flowType: "*",
      required: true,
      sequence: 1,
      slaHours: 24,
      active: true
    });
  }
  await upsert(ApprovalRule, { name: "Vicerrectorado - ruta institucional UMA" }, {
    approvalLevel: APPROVAL_STAGES.VICE_RECTOR,
    role: ROLES.VICE_RECTOR,
    area: "*",
    amountFrom: 0,
    requestType: "*",
    flowType: "*",
    required: true,
    sequence: 2,
    slaHours: 24,
    active: true
  });
  await upsert(ApprovalRule, { name: "Rectorado - CAPEX mayor a PEN 100,000" }, {
    approvalLevel: APPROVAL_STAGES.RECTORATE,
    role: ROLES.MANAGEMENT,
    area: "*",
    amountFrom: 100000,
    requestType: REQUEST_TYPE.CAPEX,
    flowType: "*",
    required: true,
    sequence: 3,
    slaHours: 36,
    active: true
  });
  await upsert(ApprovalRule, { name: "Pago directo express - Vía B" }, {
    approvalLevel: APPROVAL_STAGES.AREA_DIRECTOR,
    role: ROLES.AREA_DIRECTOR,
    area: "*",
    amountFrom: 0,
    requestType: "*",
    flowType: FLOW_TYPE.B,
    required: true,
    sequence: 1,
    slaHours: 4,
    active: true
  });
  await upsert(ApprovalRule, { name: "Vicerrectorado - Vía B" }, {
    approvalLevel: APPROVAL_STAGES.VICE_RECTOR,
    role: ROLES.VICE_RECTOR,
    area: "*",
    amountFrom: 0,
    requestType: "*",
    flowType: FLOW_TYPE.B,
    required: true,
    sequence: 2,
    slaHours: 4,
    active: true
  });
  // Track B (direct payment) is only available where Finance has configured it as an
  // exception - a modest starter threshold demonstrating the feature, adjustable by Admin.
  await upsert(DirectPaymentEligibilityRule, { name: "Excepción estándar de pago directo" }, {
    area: "*",
    expenseNature: "*",
    maxAmount: 5000,
    active: true,
    effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
    notes: "Umbral inicial de demostración; ajustar según la política real de Finanzas."
  });

  const documentRules = [
    ["DOC-A1-GOODS-SUBMISSION", FLOW_TYPE.A1, "SUBMISSION", "*", EXPENSE_NATURE.GOODS, [{ kind: "QUOTATION", minCount: 1, labelKey: "al menos una cotización" }]],
    ["DOC-A1-GOODS-INVOICE", FLOW_TYPE.A1, "INVOICE_REGISTRATION", "*", EXPENSE_NATURE.GOODS, [{ kind: "XML", minCount: 1, labelKey: "XML de factura" }, { kind: "PDF", minCount: 1, labelKey: "PDF de factura" }]],
    ["DOC-A1-GOODS-ACCOUNTING", FLOW_TYPE.A1, "ACCOUNTING", "*", EXPENSE_NATURE.GOODS, [{ kind: "CONFORMITY", minCount: 1, labelKey: "conformidad de bienes" }]],
    ["DOC-A1-SERVICES-SUBMISSION", FLOW_TYPE.A1, "SUBMISSION", "*", EXPENSE_NATURE.SERVICES, [{ kind: "CONTRACT", minCount: 1, labelKey: "contrato o acuerdo de servicio" }]],
    ["DOC-A1-SERVICES-INVOICE", FLOW_TYPE.A1, "INVOICE_REGISTRATION", "*", EXPENSE_NATURE.SERVICES, [{ kind: "XML", minCount: 1, labelKey: "XML de factura" }, { kind: "PDF", minCount: 1, labelKey: "PDF de factura" }]],
    ["DOC-A1-SERVICES-ACCOUNTING", FLOW_TYPE.A1, "ACCOUNTING", "*", EXPENSE_NATURE.SERVICES, [{ kind: "CONFORMITY", minCount: 1, labelKey: "conformidad del servicio" }]],
    ["DOC-A1-FEES-SUBMISSION", FLOW_TYPE.A1, "SUBMISSION", "*", EXPENSE_NATURE.PROFESSIONAL_FEES, [{ kind: "CONTRACT", minCount: 1, labelKey: "contrato o acuerdo de servicio" }]],
    ["DOC-A1-FEES-INVOICE", FLOW_TYPE.A1, "INVOICE_REGISTRATION", "*", EXPENSE_NATURE.PROFESSIONAL_FEES, [{ kind: "XML", minCount: 1, labelKey: "XML del recibo" }, { kind: "FEE_RECEIPT", minCount: 1, labelKey: "Recibo por Honorarios" }]],
    ["DOC-A1-FEES-ACCOUNTING", FLOW_TYPE.A1, "ACCOUNTING", "*", EXPENSE_NATURE.PROFESSIONAL_FEES, [{ kind: "ACTIVITY_REPORT", minCount: 1, labelKey: "informe de actividades" }]],
    ["DOC-A2-INVOICE", FLOW_TYPE.A2, "INVOICE_REGISTRATION", "*", "*", [{ kind: "XML", minCount: 1, labelKey: "XML de factura" }, { kind: "PDF", minCount: 1, labelKey: "PDF de factura" }]],
    ["DOC-B-SUBMISSION", FLOW_TYPE.B, "SUBMISSION", "*", "*", [{ kind: "XML", minCount: 1, labelKey: "XML de comprobante" }, { kind: "PDF", minCount: 1, labelKey: "PDF de comprobante" }]],
    ["DOC-C-RENDITION", FLOW_TYPE.C, "RENDITION", "*", "*", [{ kind: "RENDITION", minCount: 1, labelKey: "documentos de sustento de rendición" }]]
  ];
  for (const [code, flowType, phase, requestType, expenseNature, requirements] of documentRules) {
    const quotationRequirement = requirements.find((item) => item.kind === "QUOTATION");
    await upsert(DocumentRule, { code }, {
      requestType,
      expenseNature,
      flowType,
      phase,
      requirements,
      quotationPolicy: {
        enabled: Boolean(quotationRequirement),
        minimumCount: 1
      },
      active: true
    });
  }

  const mappings = [
    ["MAP-UMA-CXP", "Cuentas por pagar comerciales", "ACCOUNTS_PAYABLE", "*", "*", "*", "*", "421201"],
    ["MAP-UMA-IGV", "IGV crédito fiscal", "IGV", "*", "*", "*", "*", "401111"],
    ["MAP-UMA-ENTREGA", "Entregas a rendir - Cuenta 14", "ADVANCE_TRANSIT", REQUEST_TYPE.ENTREGA_RENDIR, "*", "*", "*", "141301"],
    ["MAP-UMA-DEVOLUCION", "Devolución de entrega a rendir", "RETURN_RECEIVABLE", REQUEST_TYPE.ENTREGA_RENDIR, "*", "*", "*", "101199"]
  ];
  for (const [code, name, purpose, requestType, expenseNature, bank, currency, accountNumber] of mappings) {
    await upsert(AccountingMapping, { code }, {
      name,
      purpose,
      requestType,
      expenseNature,
      bank,
      currency,
      accountNumber,
      active: true
    });
  }
  for (const [bank, accountNumber] of Object.entries({
    BCP: "104101",
    BBVA: "104102",
    INTERBANK: "104103",
    SCOTIABANK: "104104"
  })) {
    for (const currency of ["PEN", "USD"]) {
      await upsert(AccountingMapping, { code: `MAP-UMA-BANCO-${bank}-${currency}` }, {
        name: `Cuenta bancaria UMA ${bank} ${currency}`,
        purpose: "BANK",
        requestType: "*",
        expenseNature: "*",
        bank,
        currency,
        accountNumber,
        active: true
      });
      // Only BBVA can actually generate an outbound payment file (assertBbvaSource) - a
      // BankFormatConfiguration for any other bank would never be usable, so the schema
      // itself only allows BBVA here. UMA's own cash/bank GL account at each bank is still
      // recorded above via AccountingMapping regardless of this restriction.
      if (bank === "BBVA") await seedBbvaFormat(currency);
    }
  }

  const budgetDimensions = [
    ["Presupuesto Salud - suministros", costCenters.health, expenseTypes.laboratorySupplies, "", 360000, "REJECT"],
    ["Presupuesto Salud - servicios", costCenters.health, expenseTypes.professionalServices, "", 220000, "REJECT"],
    ["Presupuesto Salud - mantenimiento", costCenters.health, expenseTypes.maintenance, "", 180000, "REJECT"],
    ["Presupuesto Salud - viajes", costCenters.health, expenseTypes.travel, "", 20000, "REJECT"],
    ["Presupuesto Salud - no deducible", costCenters.health, expenseTypes.nonDeductible, "", 10000, "REJECT"],
    ["Presupuesto Farmacia - reactivos", costCenters.pharmacy, expenseTypes.laboratorySupplies, "", 320000, "REJECT"],
    ["Presupuesto Farmacia - servicios", costCenters.pharmacy, expenseTypes.professionalServices, "", 160000, "REJECT"],
    ["Presupuesto Ingeniería - tecnología", costCenters.engineering, expenseTypes.technologyAssets, "PRJ-CAMPUS-DIGITAL-2026", 850000, "REJECT"],
    ["Presupuesto Ingeniería - servicios", costCenters.engineering, expenseTypes.professionalServices, "", 150000, "REJECT"],
    ["Presupuesto Investigación - equipos", costCenters.research, expenseTypes.laboratoryAssets, "PRJ-INV-BIOMED-2026", 1000, "EXTRAORDINARY_APPROVAL"],
    ["Presupuesto Finanzas - servicios", costCenters.finance, expenseTypes.professionalServices, "", 220000, "REJECT"]
  ];
  for (const [name, costCenter, expenseType, project, assignedAmount, exceptionStrategy] of budgetDimensions) {
    await upsert(BudgetRule, { name }, {
      mode: "ACTIVE",
      exceptionStrategy,
      costCenter: costCenter._id,
      expenseType: expenseType._id,
      project: project || "*",
      active: true
    });
    await upsert(BudgetAllocation, {
      period: currentPeriod,
      costCenter: costCenter._id,
      expenseType: expenseType._id,
      project
    }, {
      assignedAmount,
      active: true
    });
  }

  await upsert(Project, { code: "PRJ-CAMPUS-DIGITAL-2026" }, {
    name: "Campus Digital UMA 2026",
    description: "Renovación de laboratorios de cómputo y simulación académica.",
    costCenter: costCenters.engineering._id,
    active: true
  });
  await upsert(Project, { code: "PRJ-INV-BIOMED-2026" }, {
    name: "Investigación Biomédica UMA 2026",
    description: "Equipamiento científico sujeto a excepción presupuestal.",
    costCenter: costCenters.research._id,
    active: true
  });
}

async function addAttachment(request, kind, fileName, content, user) {
  const file = await ensureEvidence("requests", request._id, fileName, content);
  request.attachments.push({ kind, ...file, uploadedBy: user._id });
}

// The supplier's invoice (PDF + UBL XML) matching the request's single line exactly, dated today
// so it posts in the current (open) period.
async function addInvoiceEvidence(request, supplier, user, voucherNumber) {
  await addAttachment(request, "PDF", `factura-${request.requestNumber}.pdf`, minimalPdf(`Factura ${voucherNumber}`), user);
  await addAttachment(request, "XML", `factura-${request.requestNumber}.xml`, invoiceXml({
    supplier,
    number: voucherNumber,
    date: currentDate,
    currency: request.currency,
    net: request.lines[0].netAmount,
    igv: request.lines[0].igvAmount,
    total: request.lines[0].totalAmount
  }), user);
}

async function addEvidenceProfile(request, profile, supplier, user, voucherNumber) {
  if (profile === "GOODS_XML") {
    for (let index = 1; index <= 3; index += 1) {
      await addAttachment(request, "QUOTATION", `cotizacion-${index}-${request.requestNumber}.pdf`, minimalPdf(`Cotización ${index} - ${request.requestNumber}`), user);
    }
    await addInvoiceEvidence(request, supplier, user, voucherNumber);
  } else if (profile === "SERVICE" || profile === "MAINTENANCE") {
    await addInvoiceEvidence(request, supplier, user, voucherNumber);
    await addAttachment(request, "CONTRACT", `contrato-${request.requestNumber}.pdf`, minimalPdf(`Contrato - ${request.requestNumber}`), user);
    await addAttachment(request, "CONFORMITY", `conformidad-${request.requestNumber}.pdf`, minimalPdf(`Conformidad - ${request.requestNumber}`), user);
  } else if (profile === "SUPPORTED_XML") {
    await addAttachment(request, "PDF", `reembolso-${request.requestNumber}.pdf`, minimalPdf(`Reembolso sustentado - ${request.requestNumber}`), user);
    await addAttachment(request, "XML", `reembolso-${request.requestNumber}.xml`, invoiceXml({
      supplier,
      number: voucherNumber,
      date: currentDate,
      currency: request.currency,
      net: request.lines[0].netAmount,
      igv: request.lines[0].igvAmount,
      total: request.lines[0].totalAmount
    }), user);
  } else if (profile === "CAPEX") {
    for (let index = 1; index <= 3; index += 1) {
      await addAttachment(request, "QUOTATION", `propuesta-capex-${index}-${request.requestNumber}.pdf`, minimalPdf(`Propuesta CAPEX ${index} - ${request.requestNumber}`), user);
    }
    await addAttachment(request, "SUPPORTING", `ficha-tecnica-${request.requestNumber}.pdf`, minimalPdf(`Ficha técnica - ${request.requestNumber}`), user);
    await addInvoiceEvidence(request, supplier, user, voucherNumber);
  } else if (profile === "DIRECT_PAYMENT") {
    await addInvoiceEvidence(request, supplier, user, voucherNumber);
  } else if (profile === "QUOTATION_ONLY") {
    await addAttachment(request, "QUOTATION", `cotizacion-1-${request.requestNumber}.pdf`, minimalPdf(`Cotización 1 - ${request.requestNumber}`), user);
  } else if (profile === "SUPPORTING") {
    await addAttachment(request, "SUPPORTING", `sustento-${request.requestNumber}.pdf`, minimalPdf(`Sustento - ${request.requestNumber}`), user);
  }
}

async function seedRequest({
  key,
  number,
  requester,
  supplier,
  costCenter,
  expenseType,
  requestType,
  expenseNature,
  description,
  net,
  igv,
  total,
  currency = "PEN",
  project = "",
  priority = "MEDIA",
  evidence = "SUPPORTING",
  voucherNumber = `F001-${number.slice(-5)}`,
  period = currentPeriod,
  competingSuppliers = [],
  supplierSelectionReason = "",
  title = "",
  detailedDescription = "",
  businessJustification = "",
  nonApprovalRisk = "",
  capexDetails,
  expenseFrequency = "ONE_OFF",
  flowType = [REQUEST_TYPE.ENTREGA_RENDIR, REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO].includes(requestType) ? FLOW_TYPE.C : FLOW_TYPE.A1
}) {
  const existing = await FinancialRequest.findOne({ developmentScenarioKey: key });
  if (existing) return existing;
  const projectRecord = requestType === REQUEST_TYPE.CAPEX && project ? await Project.findOne({ code: project }) : null;
  const exchangeRate = currency === "USD" ? demoUsdRate : 1;
  const request = new FinancialRequest({
    developmentScenarioKey: key,
    flowType,
    requestNumber: number,
    issueDate: new Date(`${period === currentPeriod ? currentDate : `${period}-01`}T00:00:00.000Z`),
    accountingPeriod: period,
    requester: requester._id,
    solicitor: requester._id,
    requesterArea: requester.area,
    requestingArea: requester.area,
    requesterCostCenter: costCenter._id,
    schoolOrDepartment: requester.area,
    requestType,
    expenseNature,
    priority,
    project,
    currency,
    exchangeRate,
    exchangeRateDate: new Date(`${currentDate}T00:00:00.000Z`),
    exchangeRateSource: currency === "USD" ? "SUNAT" : "PEN",
    supplier: supplier._id,
    supplierSnapshot: {
      identifierType: supplier.identifierType,
      identifier: supplier.normalizedIdentifier,
      legalName: supplier.legalName,
      homologationStatus: supplier.homologationStatus
    },
    supplierSelectionReason,
    title,
    detailedDescription,
    businessJustification,
    nonApprovalRisk,
    ...(requestType === REQUEST_TYPE.CAPEX
      ? { capexDetails: { ...capexDetails, projectPep: project, projectSnapshot: projectRecord ? { id: projectRecord._id } : undefined } }
      : requestType === REQUEST_TYPE.OPEX ? { opexDetails: { expenseFrequency } } : {}),
    description,
    lines: [{
      costCenter: costCenter._id,
      expenseType: expenseType._id,
      projectId: project,
      netAmount: net,
      igvAmount: igv,
      totalAmount: total,
      currency,
      exchangeRate
    }],
    draftSavedAt: now
  });
  if (evidence !== "NONE") await addEvidenceProfile(request, evidence, supplier, requester, voucherNumber);
  const needsQuotation = request.flowType !== FLOW_TYPE.C && defaultQuotationPolicy(request).enabled;
  if (!competingSuppliers.length && needsQuotation && supplier && !request.attachments.some((attachment) => attachment.kind === "QUOTATION")) {
    // Single-quotation purchase: at least one quotation is required and more are optional.
    await addAttachment(request, "QUOTATION", `cotizacion-1-${request.requestNumber}.pdf`, minimalPdf(`Cotización 1 - ${request.requestNumber}`), requester);
  }
  if (!competingSuppliers.length && needsQuotation && supplier) {
    const quotationAttachment = request.attachments.find((attachment) => attachment.kind === "QUOTATION");
    request.quotations = [{ supplier: supplier._id, amount: total, currency, attachment: quotationAttachment?._id, recommended: true }];
    request.supplierSelectionReason ||= "Proveedor seleccionado por mejor propuesta técnica y económica (DEMO).";
  }
  if (competingSuppliers.length) {
    // The 3 QUOTATION-kind attachments were just pushed by addEvidenceProfile (in that order) -
    // build the structured comparison the quotation policy requires, referencing them by id.
    const quotationAttachments = request.attachments.filter((attachment) => attachment.kind === "QUOTATION");
    const bidders = [{ supplier, amount: total, recommended: true }, ...competingSuppliers.map((competitor, index) => ({
      supplier: competitor,
      amount: Math.round(total * (1.08 + index * 0.04) * 100) / 100,
      recommended: false
    }))];
    request.quotations = bidders.map((bidder, index) => ({
      supplier: bidder.supplier._id,
      amount: bidder.amount,
      currency,
      attachment: quotationAttachments[index]?._id,
      recommended: bidder.recommended
    }));
  }
  request.approvalHistory.push(workflowEvent({
    action: "CREATED",
    to: REQUEST_STATUS.DRAFT,
    user: requester,
    req: fakeReq,
    comments: "Solicitud de demostración UMA creada.",
    request
  }));
  await request.save();
  await recordAudit({
    entityType: "FinancialRequest",
    entity: request,
    requestId: request._id,
    action: "CREATED",
    user: requester,
    req: fakeReq,
    module: "REQUESTS",
    newValues: { status: request.status, developmentScenarioKey: key }
  });
  return request;
}

function userById(users, id) {
  return Object.values(users).find((user) => user?._id && String(user._id) === String(id?._id || id));
}

async function refresh(request) {
  return FinancialRequest.findById(request._id);
}

async function submitIfDraft(request, users) {
  let current = await refresh(request);
  if (current.status === REQUEST_STATUS.DRAFT) {
    await submitFinancialRequest({
      id: current._id,
      user: users,
      req: fakeReq,
      comments: "Enviada para el circuito de aprobación UMA."
    });
    current = await refresh(current);
  }
  return current;
}

async function approveNext(request, users) {
  const current = await refresh(request);
  const stage = current.approvalStage;
  const pendingStep = (current.approvalRouteSnapshot || []).find((step) => step.required !== false && step.status === "PENDING");
  // A manager-chain step is bound to a specific identity (step.approverUser), not a generic
  // role/stage label - approvalStage there is a human-readable "Jefe: Name" string, not an
  // APPROVAL_STAGES value, so it can't be used to infer the actor the way a rule-based step can.
  const actor = pendingStep?.approverUser
    ? Object.values(users).find((user) => user?._id && String(user._id) === String(pendingStep.approverUser))
    : stage === APPROVAL_STAGES.AREA_DIRECTOR
      ? users.directorsByArea[current.requesterArea]
      : stage === APPROVAL_STAGES.VICE_RECTOR
        ? users.viceRector
        : users.management;
  if (!actor) throw new Error(`No demo approver is configured for ${current.requesterArea} / ${stage}.`);
  try {
    await decideApproval({
      id: current._id,
      action: "APPROVE",
      comments: `Aprobación electrónica DEMO - ${stage}.`,
      // Walk the demo request up the chain while a jefe above exists, then finalize.
      forward: (await approvalDecisionOptions(current)).canForward,
      user: actor,
      req: fakeReq
    });
  } catch (error) {
    const rectorateApproved = stage === APPROVAL_STAGES.RECTORATE
      && error.code === "FORBIDDEN"
      && error.details?.targetStatus === REQUEST_STATUS.BUDGET_COMMITTED;
    if (!rectorateApproved) throw error;
    const approved = await refresh(current);
    await commitApprovedRequestBudget({
      request: approved,
      user: users.budget,
      req: fakeReq
    });
  }
  return refresh(current);
}

async function approveUntilComplete(request, users, stopBeforeStage) {
  let current = await refresh(request);
  for (let index = 0; index < 5; index += 1) {
    if (stopBeforeStage && current.approvalStage === stopBeforeStage) return current;
    if (![REQUEST_STATUS.PENDING_APPROVAL, REQUEST_STATUS.DIRECTOR_APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED].includes(current.status)) return current;
    const pending = (current.approvalRouteSnapshot || []).some((step) => step.required !== false && step.status === "PENDING");
    if (!pending) return current;
    current = await approveNext(current, users);
  }
  return current;
}

function accountingPayload(request, sequence, accountNumber) {
  return {
    voucherType: request.requestType === REQUEST_TYPE.ENTREGA_RENDIR ? "RECIBO_INTERNO" : "FACTURA",
    series: request.requestType === REQUEST_TYPE.ENTREGA_RENDIR ? "ER01" : "F001",
    number: String(sequence).padStart(8, "0"),
    documentDate: currentDate,
    accountingDate: currentDate,
    fiscalPeriod: currentPeriod,
    accountNumber,
    comments: `Validación fiscal y provisión DEMO UMA para ${request.requestNumber}.`
  };
}

async function moveToAccounting(request, users, sequence, accountNumber) {
  let current = await approveUntilComplete(request, users);
  if ([
    REQUEST_STATUS.ACCOUNTED,
    REQUEST_STATUS.SCHEDULED,
    REQUEST_STATUS.BANK_FILE_GENERATED,
    REQUEST_STATUS.PAID,
    REQUEST_STATUS.RENDITION_PENDING,
    REQUEST_STATUS.RECONCILED,
    REQUEST_STATUS.CLOSED
  ].includes(current.status)) return current;
  const routeComplete = [REQUEST_STATUS.APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED].includes(current.status)
    && !(current.approvalRouteSnapshot || []).some((step) => step.required !== false && step.status === "PENDING");
  if (routeComplete) {
    await commitApprovedRequestBudget({
      request: current,
      user: users.budget,
      req: fakeReq
    });
    current = await refresh(current);
  }
  if (current.status !== REQUEST_STATUS.BUDGET_COMMITTED) {
    throw new Error(`${current.requestNumber} did not reach budget commitment; current status ${current.status}.`);
  }
  if (current.requestType === REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO && !current.rendition?.number) {
    await submitRendition({
      requestId: current._id,
      payload: {
        unsupportedExpenseLines: [{
          date: currentDate,
          description: current.description,
          goodsServiceType: "SERVICES",
          grossAmount: current.totalAmount
        }],
        confirmedExceptionalUse: true,
        exceptionalUseComments: "Declaración excepcional DEMO del colaborador UMA.",
        beneficiaryAcknowledged: true,
        comments: "Detalle oficial de reembolso sin sustento enviado para revisión financiera."
      },
      files: {},
      user: users.solicitorHealth,
      req: fakeReq
    });
    await reviewRendition({
      requestId: current._id,
      action: "APPROVE",
      comments: "Detalle oficial revisado manualmente por Contabilidad.",
      user: users.accounting,
      req: fakeReq
    });
    current = await refresh(current);
    // Accounting's approval of the signed declaration provisions the payable itself.
    if (current.status === REQUEST_STATUS.ACCOUNTED) return current;
  }
  // Track A1 purchases of goods/services need Procurement's order before the invoice is booked.
  if (requiresPurchaseOrder(current) && !current.purchaseOrder) {
    await issueProcurementOrder({ requestId: current._id, user: users.procurement, req: fakeReq });
    current = await refresh(current);
  }
  // The goods reception / service conformity certificate is signed once the order is delivered.
  if (current.flowType === FLOW_TYPE.A1 && !current.attachments.some((attachment) => attachment.kind === "CONFORMITY")) {
    await addAttachment(current, "CONFORMITY", `conformidad-${current.requestNumber}.pdf`, minimalPdf(`Acta de conformidad - ${current.requestNumber}`), userById(users, current.requester));
    await current.save();
  }
  await processAccountsPayable({
    requestId: current._id,
    payload: accountingPayload(current, sequence, accountNumber),
    user: users.accounting,
    req: fakeReq
  });
  return refresh(current);
}

// BBVA is UMA's only source bank for outbound files (the beneficiary's own bank can differ).
// A file waiting for the bank uses the default next 15th/30th cycle date; a scenario that is
// paid during the seed is scheduled for today with the audited off-cycle reason instead, because
// a payment can never be confirmed before it happens.
async function moveToBankFile(request, users, sequence, accountNumber, { payToday = false } = {}) {
  const current = await moveToAccounting(request, users, sequence, accountNumber);
  if ([
    REQUEST_STATUS.BANK_FILE_GENERATED,
    REQUEST_STATUS.PAID,
    REQUEST_STATUS.RENDITION_PENDING,
    REQUEST_STATUS.RECONCILED,
    REQUEST_STATUS.CLOSED
  ].includes(current.status)) return current;
  await generatePaymentBatch({
    requestIds: [current._id.toString()],
    bank: "BBVA",
    currency: current.currency,
    ...(payToday ? { paymentDate: currentDate, paymentDateReason: "Pago adelantado autorizado por Tesorería (escenario DEMO pagado en el día)." } : {}),
    user: users.treasury,
    req: fakeReq
  });
  return refresh(current);
}

async function confirmPayment(request, users, operationSuffix) {
  const current = await refresh(request);
  if ([
    REQUEST_STATUS.PAID,
    REQUEST_STATUS.RENDITION_PENDING,
    REQUEST_STATUS.RECONCILED,
    REQUEST_STATUS.CLOSED
  ].includes(current.status)) return current;
  const accountsPayable = await AccountsPayable.findOne({ request: current._id, status: { $ne: "CANCELLED" } });
  // The BBVA transfer pays the supplier's portion; a SPOT detraccion is deposited separately.
  const detraction = pendingDetractionAmount(accountsPayable);
  await confirmTreasuryPayment({
    requestId: current._id,
    payload: {
      operationNumber: `UMA-BBVA-${operationSuffix}`,
      paidAt: currentDate,
      confirmedAmount: Math.round((accountsPayable.outstandingAmount - detraction) * 100) / 100,
      comments: "Pago bancario confirmado manualmente para demostración UMA."
    },
    user: users.treasury,
    req: fakeReq
  });
  if (detraction > 0) {
    await recordDetractionDeposit({
      accountsPayableId: accountsPayable._id,
      payload: {
        constancyNumber: `DEMO-BN-${operationSuffix}`,
        depositDate: currentDate,
        amount: detraction,
        comments: "Depósito de detracción SPOT en Banco de la Nación (constancia DEMO)."
      },
      user: users.treasury,
      req: fakeReq
    });
  }
  return refresh(current);
}

async function reconcileAndClose(request, users, bank, referenceSuffix, { close = true } = {}) {
  let current = await refresh(request);
  if (current.status === REQUEST_STATUS.CLOSED) return current;
  if (current.status !== REQUEST_STATUS.RECONCILED) {
    await reconcilePayment({
      requestId: current._id,
      payload: {
        bankReference: `EECC-${bank}-${referenceSuffix}`,
        statementAmount: current.totalAmount,
        comments: "Conciliación manual DEMO sin diferencia."
      },
      user: users.treasury,
      req: fakeReq
    });
    current = await refresh(current);
  }
  if (close && current.status === REQUEST_STATUS.RECONCILED) {
    await closeFinancialRequest({
      id: current._id,
      user: users.accounting,
      req: fakeReq,
      comments: "Solicitud cerrada después de pago y conciliación."
    });
  }
  return refresh(current);
}

async function seedScenarios({ users, suppliers, costCenters, expenseTypes }) {
  const scenarios = {};

  scenarios.draft = await seedRequest({
    key: "UMA_01_BORRADOR_SALUD",
    number: "SOL-2026-30001",
    requester: users.solicitorHealth,
    supplier: suppliers.health.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.laboratorySupplies,
    requestType: REQUEST_TYPE.OPEX,
    expenseNature: EXPENSE_NATURE.GOODS,
    title: "Kits de bioseguridad para prácticas de Ciencias de la Salud",
    detailedDescription: "Adquisición de kits de bioseguridad (mandiles, guantes, mascarillas N95 y lentes de protección) para las prácticas de laboratorio del ciclo en curso.",
    businessJustification: "Los kits son obligatorios según el protocolo de bioseguridad de los laboratorios de la Facultad.",
    nonApprovalRisk: "Sin los kits no se podrían dictar las prácticas presenciales de laboratorio.",
    description: "Borrador: kits de bioseguridad para prácticas de Ciencias de la Salud.",
    net: 5000,
    igv: 900,
    total: 5900,
    evidence: "NONE"
  });

  scenarios.directorPending = await seedRequest({
    key: "UMA_02_PENDIENTE_DIRECTOR",
    number: "SOL-2026-30002",
    requester: users.solicitorHealth,
    supplier: suppliers.services.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.maintenance,
    requestType: REQUEST_TYPE.OPEX,
    expenseNature: EXPENSE_NATURE.MAINTENANCE,
    title: "Mantenimiento preventivo del laboratorio clínico",
    detailedDescription: "Servicio de mantenimiento preventivo de cabinas de bioseguridad, centrífugas y autoclaves del laboratorio clínico, incluye informe técnico por equipo.",
    businessJustification: "El fabricante exige mantenimiento semestral para conservar la garantía y la certificación de las cabinas.",
    nonApprovalRisk: "Pérdida de garantía y riesgo de paralización de las prácticas por falla de equipos críticos.",
    expenseFrequency: "EVERY_3_MONTHS",
    description: "Mantenimiento preventivo de cabinas y equipos del laboratorio clínico.",
    net: 16000,
    igv: 2880,
    total: 18880,
    priority: "ALTA",
    evidence: "MAINTENANCE"
  });
  scenarios.directorPending = await submitIfDraft(scenarios.directorPending, users.solicitorHealth);

  scenarios.vicePending = await seedRequest({
    key: "UMA_03_PENDIENTE_VICERRECTOR",
    number: "SOL-2026-30003",
    requester: users.solicitorPharmacy,
    supplier: suppliers.pharmacy.supplier,
    costCenter: costCenters.pharmacy,
    expenseType: expenseTypes.laboratorySupplies,
    requestType: REQUEST_TYPE.OPEX,
    expenseNature: EXPENSE_NATURE.GOODS,
    description: "Reactivos para control de calidad en el laboratorio de Farmacia y Bioquímica.",
    net: 20000,
    igv: 3600,
    total: 23600,
    evidence: "GOODS_XML",
    voucherNumber: "F001-30003",
    competingSuppliers: [suppliers.health.supplier, suppliers.engineering.supplier],
    supplierSelectionReason: "Mejor precio y plazo de entrega frente a las otras dos cotizaciones recibidas.",
    title: "Reactivos de control de calidad - Farmacia y Bioquímica",
    detailedDescription: "Compra de reactivos de control de calidad requeridos para las prácticas del laboratorio de Farmacia y Bioquímica del presente semestre.",
    businessJustification: "El stock actual de reactivos se agota antes del cierre del semestre y es indispensable para las prácticas acreditadas.",
    nonApprovalRisk: "Sin la compra, las prácticas de laboratorio quedarían suspendidas, afectando la acreditación del curso."
  });
  scenarios.vicePending = await submitIfDraft(scenarios.vicePending, users.solicitorPharmacy);
  if (scenarios.vicePending.status === REQUEST_STATUS.PENDING_APPROVAL) scenarios.vicePending = await approveNext(scenarios.vicePending, users);

  scenarios.rectoratePending = await seedRequest({
    key: "UMA_04_PENDIENTE_RECTORADO",
    number: "SOL-2026-30004",
    requester: users.solicitorEngineering,
    supplier: suppliers.engineering.supplier,
    costCenter: costCenters.engineering,
    expenseType: expenseTypes.technologyAssets,
    requestType: REQUEST_TYPE.CAPEX,
    expenseNature: EXPENSE_NATURE.TECHNOLOGY,
    title: "Renovación de estaciones de simulación - Ingeniería e IA",
    detailedDescription: "Adquisición de doce estaciones de trabajo de alto rendimiento para los laboratorios de simulación e Inteligencia Artificial del proyecto Campus Digital 2026.",
    businessJustification: "Los equipos actuales tienen seis años de antigüedad y no soportan las herramientas de simulación del nuevo plan de estudios.",
    nonApprovalRisk: "Los cursos de simulación e IA del próximo semestre no podrían dictarse con el software requerido.",
    capexDetails: { assetCategory: "IT_HARDWARE", usefulLifeYears: 4, npv: { amount: 52000, currency: "USD" }, payback: { value: 30, unit: "MONTHS" } },
    description: "Renovación CAPEX de estaciones de simulación para Ingeniería e Inteligencia Artificial.",
    net: 36000,
    igv: 6480,
    total: 42480,
    currency: "USD",
    project: "PRJ-CAMPUS-DIGITAL-2026",
    priority: "ALTA",
    evidence: "CAPEX"
  });
  scenarios.rectoratePending = await submitIfDraft(scenarios.rectoratePending, users.solicitorEngineering);
  scenarios.rectoratePending = await approveUntilComplete(scenarios.rectoratePending, users, APPROVAL_STAGES.RECTORATE);

  scenarios.budgetCommitted = await seedRequest({
    key: "UMA_05_COMPROMISO_PRESUPUESTAL",
    number: "SOL-2026-30005",
    requester: users.solicitorPharmacy,
    supplier: suppliers.services.supplier,
    costCenter: costCenters.pharmacy,
    expenseType: expenseTypes.professionalServices,
    requestType: REQUEST_TYPE.OPEX,
    expenseNature: EXPENSE_NATURE.SERVICES,
    title: "Calibración y certificación de equipos de Farmacia",
    detailedDescription: "Servicio de calibración acreditada de balanzas analíticas, pHmetros y espectrofotómetros del laboratorio de Farmacia y Bioquímica, con certificados emitidos por laboratorio acreditado.",
    businessJustification: "La calibración anual es requisito para la validez de los ensayos y para la acreditación del programa.",
    nonApprovalRisk: "Los ensayos del laboratorio perderían validez técnica ante auditorías de acreditación.",
    expenseFrequency: "ANNUAL_RENEWAL",
    description: "Calibración y certificación de equipos del laboratorio de Farmacia.",
    net: 15000,
    igv: 2700,
    total: 17700,
    evidence: "SERVICE"
  });
  scenarios.budgetCommitted = await submitIfDraft(scenarios.budgetCommitted, users.solicitorPharmacy);
  scenarios.budgetCommitted = await approveUntilComplete(scenarios.budgetCommitted, users);

  scenarios.accounted = await seedRequest({
    key: "UMA_06_CONTABILIZADO",
    number: "SOL-2026-30006",
    requester: users.solicitorHealth,
    supplier: suppliers.health.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.laboratorySupplies,
    requestType: REQUEST_TYPE.OPEX,
    expenseNature: EXPENSE_NATURE.GOODS,
    description: "Material descartable para prácticas de Enfermería, provisionado y pendiente de Tesorería.",
    net: 12000,
    igv: 2160,
    total: 14160,
    evidence: "GOODS_XML",
    voucherNumber: "F001-30006",
    competingSuppliers: [suppliers.pharmacy.supplier, suppliers.services.supplier],
    supplierSelectionReason: "Mejor precio y plazo de entrega frente a las otras dos cotizaciones recibidas.",
    title: "Material descartable para prácticas de Enfermería",
    detailedDescription: "Adquisición de material descartable de uso clínico para las prácticas de la Facultad de Ciencias de la Salud.",
    businessJustification: "El material actual se encuentra por debajo del nivel mínimo requerido para continuar las prácticas programadas.",
    nonApprovalRisk: "Sin el material, las prácticas clínicas programadas no podrían realizarse con las condiciones de bioseguridad exigidas."
  });
  scenarios.accounted = await submitIfDraft(scenarios.accounted, users.solicitorHealth);
  scenarios.accounted = await moveToAccounting(scenarios.accounted, users, 30006, expenseTypes.laboratorySupplies.accountNumber);

  scenarios.scheduled = await seedRequest({
    key: "UMA_07_PROGRAMADO",
    number: "SOL-2026-30007",
    requester: users.solicitorHealth,
    supplier: suppliers.health.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.professionalServices,
    requestType: REQUEST_TYPE.OPEX,
    expenseNature: EXPENSE_NATURE.SERVICES,
    title: "Mantenimiento del software de simulación clínica",
    detailedDescription: "Servicio anual de soporte y actualización del software de simulación clínica usado en los maniquíes de alta fidelidad.",
    businessJustification: "El soporte incluye actualizaciones de escenarios clínicos requeridos por el plan de estudios.",
    nonApprovalRisk: "Los simuladores quedarían sin soporte ni actualizaciones, limitando las prácticas de simulación.",
    expenseFrequency: "ANNUAL_RENEWAL",
    description: "Servicio de mantenimiento del software de simulación clínica programado para pago.",
    net: 8000,
    igv: 1440,
    total: 9440,
    evidence: "SERVICE"
  });
  scenarios.scheduled = await submitIfDraft(scenarios.scheduled, users.solicitorHealth);
  scenarios.scheduled = await moveToAccounting(scenarios.scheduled, users, 30007, expenseTypes.professionalServices.accountNumber);
  if (scenarios.scheduled.status === REQUEST_STATUS.ACCOUNTED) {
    // No paymentDate: Treasury's default, the next 15th/30th payment cycle.
    await schedulePayments({
      requestIds: [scenarios.scheduled._id.toString()],
      bank: "BBVA",
      currency: "PEN",
      user: users.treasury,
      req: fakeReq
    });
    scenarios.scheduled = await refresh(scenarios.scheduled);
  }

  scenarios.scotiabankTxt = await seedRequest({
    key: "UMA_08_TXT_SCOTIABANK",
    number: "SOL-2026-30008",
    requester: users.solicitorHealth,
    supplier: suppliers.services.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.maintenance,
    requestType: REQUEST_TYPE.OPEX,
    expenseNature: EXPENSE_NATURE.MAINTENANCE,
    title: "Adecuación eléctrica del laboratorio de Ciencias de la Salud",
    detailedDescription: "Adecuación del tablero eléctrico y del circuito estabilizado del laboratorio para la nueva línea de equipos biomédicos.",
    businessJustification: "Los equipos nuevos requieren un circuito estabilizado independiente según las especificaciones del fabricante.",
    nonApprovalRisk: "Riesgo de daño a los equipos biomédicos y de cortes durante las prácticas.",
    description: "Adecuación eléctrica de laboratorio incluida en un TXT BBVA (abono a cuenta Scotiabank del proveedor), pago aún no confirmado.",
    net: 10000,
    igv: 1800,
    total: 11800,
    evidence: "MAINTENANCE"
  });
  scenarios.scotiabankTxt = await submitIfDraft(scenarios.scotiabankTxt, users.solicitorHealth);
  scenarios.scotiabankTxt = await moveToBankFile(scenarios.scotiabankTxt, users, 30008, expenseTypes.maintenance.accountNumber);

  scenarios.interbankTxt = await seedRequest({
    key: "UMA_09_TXT_INTERBANK_USD",
    number: "SOL-2026-30009",
    requester: users.solicitorEngineering,
    supplier: suppliers.engineering.supplier,
    costCenter: costCenters.engineering,
    expenseType: expenseTypes.technologyAssets,
    requestType: REQUEST_TYPE.CAPEX,
    expenseNature: EXPENSE_NATURE.EQUIPMENT,
    title: "Servidores GPU para el laboratorio de Inteligencia Artificial",
    detailedDescription: "Adquisición de dos servidores con aceleradores GPU para el laboratorio de Inteligencia Artificial del proyecto Campus Digital 2026.",
    businessJustification: "Los cursos y proyectos de investigación de IA requieren capacidad de cómputo acelerado que hoy no existe en el campus.",
    nonApprovalRisk: "Los proyectos de IA dependerían de servicios externos de mayor costo o no podrían ejecutarse.",
    capexDetails: { assetCategory: "IT_HARDWARE", usefulLifeYears: 5, npv: { amount: 41000, currency: "USD" }, payback: { value: 3, unit: "YEARS" } },
    description: "Servidores GPU para el laboratorio de Inteligencia Artificial incluidos en un TXT BBVA USD (abono a cuenta Interbank del proveedor).",
    net: 30000,
    igv: 5400,
    total: 35400,
    currency: "USD",
    project: "PRJ-CAMPUS-DIGITAL-2026",
    evidence: "CAPEX"
  });
  scenarios.interbankTxt = await submitIfDraft(scenarios.interbankTxt, users.solicitorEngineering);
  scenarios.interbankTxt = await moveToBankFile(scenarios.interbankTxt, users, 30009, expenseTypes.technologyAssets.accountNumber);

  scenarios.bbvaPaid = await seedRequest({
    key: "UMA_10_PAGADO_BBVA",
    number: "SOL-2026-30010",
    requester: users.solicitorPharmacy,
    supplier: suppliers.pharmacy.supplier,
    costCenter: costCenters.pharmacy,
    expenseType: expenseTypes.laboratorySupplies,
    requestType: REQUEST_TYPE.OPEX,
    expenseNature: EXPENSE_NATURE.GOODS,
    description: "Estándares de referencia farmacéutica pagados por BBVA y pendientes de conciliación.",
    net: 25000,
    igv: 4500,
    total: 29500,
    evidence: "GOODS_XML",
    voucherNumber: "F001-30010",
    competingSuppliers: [suppliers.health.supplier, suppliers.services.supplier],
    supplierSelectionReason: "Mejor precio y plazo de entrega frente a las otras dos cotizaciones recibidas.",
    title: "Estándares de referencia farmacéutica",
    detailedDescription: "Compra de estándares de referencia certificados para los ensayos de control de calidad de Farmacia y Bioquímica.",
    businessJustification: "Los estándares vigentes están próximos a vencer y son indispensables para mantener la validez de los ensayos.",
    nonApprovalRisk: "Sin estándares vigentes, los ensayos de control de calidad no podrían certificarse conforme a la normativa aplicable."
  });
  scenarios.bbvaPaid = await submitIfDraft(scenarios.bbvaPaid, users.solicitorPharmacy);
  scenarios.bbvaPaid = await moveToBankFile(scenarios.bbvaPaid, users, 30010, expenseTypes.laboratorySupplies.accountNumber, { payToday: true });
  scenarios.bbvaPaid = await confirmPayment(scenarios.bbvaPaid, users, "30010");

  scenarios.bcpClosed = await seedRequest({
    key: "UMA_11_CERRADO_BCP",
    number: "SOL-2026-30011",
    requester: users.solicitorHealth,
    supplier: suppliers.health.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.laboratorySupplies,
    requestType: REQUEST_TYPE.OPEX,
    expenseNature: EXPENSE_NATURE.GOODS,
    description: "Micropipetas para Laboratorio Clínico: ciclo completo, pago BBVA a cuenta BCP, conciliación y cierre.",
    net: 18000,
    igv: 3240,
    total: 21240,
    evidence: "GOODS_XML",
    voucherNumber: "F001-30011",
    competingSuppliers: [suppliers.engineering.supplier, suppliers.services.supplier],
    supplierSelectionReason: "Mejor precio y plazo de entrega frente a las otras dos cotizaciones recibidas.",
    title: "Micropipetas para Laboratorio Clínico",
    detailedDescription: "Adquisición de micropipetas de precisión para el Laboratorio Clínico de la Facultad de Ciencias de la Salud.",
    businessJustification: "Las micropipetas actuales han superado su vida útil y presentan desviaciones fuera del rango de calibración aceptado.",
    nonApprovalRisk: "Sin el reemplazo, los resultados de laboratorio podrían perder precisión y confiabilidad diagnóstica."
  });
  scenarios.bcpClosed = await submitIfDraft(scenarios.bcpClosed, users.solicitorHealth);
  scenarios.bcpClosed = await moveToBankFile(scenarios.bcpClosed, users, 30011, expenseTypes.laboratorySupplies.accountNumber, { payToday: true });
  scenarios.bcpClosed = await confirmPayment(scenarios.bcpClosed, users, "30011");
  scenarios.bcpClosed = await reconcileAndClose(scenarios.bcpClosed, users, "BBVA", "30011");

  scenarios.advancePending = await seedRequest({
    key: "UMA_12_RENDICION_PENDIENTE",
    number: "SOL-2026-30012",
    requester: users.solicitorHealth,
    supplier: suppliers.beneficiary.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.travel,
    requestType: REQUEST_TYPE.ENTREGA_RENDIR,
    expenseNature: EXPENSE_NATURE.TRAVEL,
    title: "Entrega a rendir - visita académica de Ciencias de la Salud",
    detailedDescription: "Anticipo para pasajes, hospedaje y movilidad de la visita académica a hospitales de convenio en Arequipa.",
    businessJustification: "La visita forma parte del programa de prácticas preprofesionales del ciclo.",
    nonApprovalRisk: "Se cancelaría la visita académica comprometida con los hospitales de convenio.",
    description: "Entrega a rendir para visita académica de Ciencias de la Salud; pendiente de sustento.",
    net: 4000,
    igv: 0,
    total: 4000,
    evidence: "SUPPORTING"
  });
  scenarios.advancePending = await submitIfDraft(scenarios.advancePending, users.solicitorHealth);
  scenarios.advancePending = await moveToBankFile(scenarios.advancePending, users, 30012, expenseTypes.travel.accountNumber, { payToday: true });
  scenarios.advancePending = await confirmPayment(scenarios.advancePending, users, "30012");

  scenarios.advanceClosed = await seedRequest({
    key: "UMA_13_RENDICION_CERRADA",
    number: "SOL-2026-30013",
    requester: users.solicitorHealth,
    supplier: suppliers.beneficiary.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.travel,
    requestType: REQUEST_TYPE.ENTREGA_RENDIR,
    expenseNature: EXPENSE_NATURE.TRAVEL,
    title: "Entrega a rendir - jornada de investigación",
    detailedDescription: "Anticipo para movilidad, alimentación y materiales de la jornada de investigación en campo.",
    businessJustification: "La jornada es parte del cronograma del proyecto de investigación aprobado.",
    nonApprovalRisk: "Se retrasaría la recolección de datos del proyecto de investigación.",
    description: "Entrega a rendir para jornada de investigación: sustentada, validada, conciliada y cerrada.",
    net: 4720,
    igv: 0,
    total: 4720,
    evidence: "SUPPORTING"
  });
  scenarios.advanceClosed = await submitIfDraft(scenarios.advanceClosed, users.solicitorHealth);
  scenarios.advanceClosed = await moveToBankFile(scenarios.advanceClosed, users, 30013, expenseTypes.travel.accountNumber, { payToday: true });
  scenarios.advanceClosed = await confirmPayment(scenarios.advanceClosed, users, "30013");
  if ([REQUEST_STATUS.PAID, REQUEST_STATUS.RENDITION_PENDING].includes(scenarios.advanceClosed.status) && scenarios.advanceClosed.rendition?.status === "PENDING") {
    const renditionTmp = path.join(uploadRoot, "tmp", `rendicion-${scenarios.advanceClosed._id}.pdf`);
    await fs.mkdir(path.dirname(renditionTmp), { recursive: true });
    const renditionContent = minimalPdf(`Rendición completa - ${scenarios.advanceClosed.requestNumber}`);
    await fs.writeFile(renditionTmp, renditionContent);
    await submitRendition({
      requestId: scenarios.advanceClosed._id,
      payload: {
        lines: [{
          costCenter: costCenters.health._id,
          expenseType: expenseTypes.travel._id,
          netAmount: 4720,
          igvAmount: 0,
          totalAmount: 4720
        }],
        amountReturned: 0,
        unsupportedExpenseLines: [{
          date: currentDate,
          description: "Gastos locales de la jornada de investigación sin comprobante fiscal disponible.",
          goodsServiceType: "SERVICES",
          grossAmount: 4720
        }],
        confirmedExceptionalUse: true,
        exceptionalUseComments: "Uso excepcional declarado para la demostración UMA.",
        beneficiaryAcknowledged: true,
        comments: "Rendición completa con comprobantes DEMO."
      },
      files: {
        rendition: [{
          originalname: "rendicion-completa-demo.pdf",
          filename: `rendicion-${scenarios.advanceClosed._id}.pdf`,
          path: renditionTmp,
          mimetype: "application/pdf",
          size: Buffer.byteLength(renditionContent)
        }]
      },
      user: users.solicitorHealth,
      req: fakeReq
    });
    scenarios.advanceClosed = await refresh(scenarios.advanceClosed);
  }
  if ([REQUEST_STATUS.PAID, REQUEST_STATUS.RENDITION_PENDING].includes(scenarios.advanceClosed.status) && scenarios.advanceClosed.rendition?.status === "SUBMITTED") {
    await reviewRendition({
      requestId: scenarios.advanceClosed._id,
      action: "VALIDATE",
      comments: "Rendición validada por Contabilidad; gasto reconocido y Cuenta 14 compensada.",
      user: users.accounting,
      req: fakeReq
    });
    scenarios.advanceClosed = await refresh(scenarios.advanceClosed);
  }
  scenarios.advanceClosed = await reconcileAndClose(scenarios.advanceClosed, users, "BBVA", "30013");

  scenarios.nonDeductible = await seedRequest({
    key: "UMA_14_REEMBOLSO_NO_DEDUCIBLE",
    number: "SOL-2026-30014",
    requester: users.solicitorHealth,
    supplier: suppliers.beneficiary.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.nonDeductible,
    requestType: REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO,
    expenseNature: EXPENSE_NATURE.REIMBURSEMENT_LIQUIDATION,
    title: "Reembolso sin sustento - movilidad de comisión de servicio",
    detailedDescription: "Reembolso de gastos de movilidad local durante una comisión de servicio en la que no fue posible obtener comprobantes.",
    businessJustification: "El gasto fue realizado por el colaborador en cumplimiento de una comisión autorizada.",
    nonApprovalRisk: "El colaborador asumiría personalmente un gasto institucional.",
    description: "Reembolso sin sustento fiscal tratado con la cuenta no deducible configurada.",
    net: 850,
    igv: 0,
    total: 850,
    evidence: "SUPPORTING"
  });
  scenarios.nonDeductible = await submitIfDraft(scenarios.nonDeductible, users.solicitorHealth);
  scenarios.nonDeductible = await moveToAccounting(scenarios.nonDeductible, users, 30014, expenseTypes.nonDeductible.accountNumber);

  scenarios.observed = await seedRequest({
    key: "UMA_15_OBSERVADO",
    number: "SOL-2026-30015",
    requester: users.solicitorHealth,
    supplier: suppliers.services.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.maintenance,
    requestType: REQUEST_TYPE.OPEX,
    expenseNature: EXPENSE_NATURE.MAINTENANCE,
    title: "Adecuación del almacén de insumos de Ciencias de la Salud",
    detailedDescription: "Adecuación de estanterías, iluminación y control de temperatura del almacén de insumos de laboratorio.",
    businessJustification: "El almacén actual no cumple las condiciones de temperatura recomendadas para ciertos insumos.",
    nonApprovalRisk: "Riesgo de deterioro de insumos y de observaciones en auditorías de bioseguridad.",
    description: "Adecuación de almacén observada para aclarar el alcance y cronograma.",
    net: 7000,
    igv: 1260,
    total: 8260,
    evidence: "MAINTENANCE"
  });
  scenarios.observed = await submitIfDraft(scenarios.observed, users.solicitorHealth);
  if (scenarios.observed.status === REQUEST_STATUS.PENDING_APPROVAL) {
    await decideApproval({
      id: scenarios.observed._id,
      action: "OBSERVE",
      comments: "Adjuntar cronograma de trabajo y precisar el responsable de la conformidad.",
      user: users.directorHealth,
      req: fakeReq
    });
    scenarios.observed = await refresh(scenarios.observed);
  }

  scenarios.rejected = await seedRequest({
    key: "UMA_16_RECHAZADO",
    number: "SOL-2026-30016",
    requester: users.solicitorPharmacy,
    supplier: suppliers.pharmacy.supplier,
    costCenter: costCenters.pharmacy,
    expenseType: expenseTypes.professionalServices,
    requestType: REQUEST_TYPE.OPEX,
    expenseNature: EXPENSE_NATURE.SERVICES,
    title: "Servicio de asesoría técnica para laboratorio de Farmacia",
    detailedDescription: "Servicio de asesoría técnica para la revisión de procedimientos operativos del laboratorio de Farmacia.",
    businessJustification: "Se requiere actualizar los procedimientos operativos del laboratorio.",
    nonApprovalRisk: "Los procedimientos quedarían sin actualizar hasta el siguiente ciclo.",
    description: "Servicio duplicado rechazado por la Dirección de Farmacia.",
    net: 3000,
    igv: 540,
    total: 3540,
    evidence: "SERVICE"
  });
  scenarios.rejected = await submitIfDraft(scenarios.rejected, users.solicitorPharmacy);
  if (scenarios.rejected.status === REQUEST_STATUS.PENDING_APPROVAL) {
    await decideApproval({
      id: scenarios.rejected._id,
      action: "REJECT",
      comments: "La necesidad ya está cubierta por el contrato institucional vigente.",
      user: users.directorPharmacy,
      req: fakeReq
    });
    scenarios.rejected = await refresh(scenarios.rejected);
  }

  scenarios.budgetException = await seedRequest({
    key: "UMA_17_EXCEPCION_PRESUPUESTAL",
    number: "SOL-2026-30017",
    requester: users.solicitorEngineering,
    supplier: suppliers.engineering.supplier,
    costCenter: costCenters.research,
    expenseType: expenseTypes.laboratoryAssets,
    requestType: REQUEST_TYPE.CAPEX,
    expenseNature: EXPENSE_NATURE.EQUIPMENT,
    title: "Equipo biomédico para investigación - proyecto Biomed 2026",
    detailedDescription: "Adquisición de un equipo de análisis biomédico para el proyecto de Investigación Biomédica UMA 2026.",
    businessJustification: "El equipo es indispensable para ejecutar la fase experimental comprometida con la entidad financiadora.",
    nonApprovalRisk: "Incumplimiento del cronograma del proyecto financiado y posible devolución de fondos.",
    capexDetails: { assetCategory: "MACHINERY", usefulLifeYears: 8, npv: { amount: 15000, currency: "PEN" }, payback: { value: 6, unit: "YEARS" } },
    description: "Equipo biomédico para investigación con saldo insuficiente y aprobación extraordinaria pendiente.",
    net: 50000,
    igv: 9000,
    total: 59000,
    project: "PRJ-INV-BIOMED-2026",
    priority: "ALTA",
    evidence: "CAPEX"
  });
  scenarios.budgetException = await submitIfDraft(scenarios.budgetException, users.solicitorEngineering);
  scenarios.budgetException = await approveUntilComplete(scenarios.budgetException, users);

  scenarios.closedPeriod = await seedRequest({
    key: "UMA_18_PERIODO_CERRADO",
    number: "SOL-2026-30018",
    requester: users.solicitorHealth,
    supplier: suppliers.health.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.laboratorySupplies,
    requestType: REQUEST_TYPE.OPEX,
    expenseNature: EXPENSE_NATURE.GOODS,
    title: "Registro histórico en periodo cerrado",
    detailedDescription: "Registro de prueba asociado a un periodo contable ya cerrado para demostrar el bloqueo de modificaciones.",
    businessJustification: "Permite verificar el control de periodos cerrados.",
    nonApprovalRisk: "No aplica; registro de demostración.",
    description: "Registro histórico de prueba asociado a un periodo cerrado; no debe poder modificarse.",
    net: 1000,
    igv: 180,
    total: 1180,
    evidence: "NONE",
    period: closedPeriod
  });

  // Track B: a small recurring service paid directly under the configured eligibility rule. The
  // XML is validated at submission, the request auto-provisions on approval, and it rests
  // reconciled (not yet closed) so Accounting can demo the closure.
  scenarios.directPayment = await seedRequest({
    key: "UMA_19_VIA_B_CONCILIADO",
    number: "SOL-2026-30019",
    flowType: FLOW_TYPE.B,
    requester: users.solicitorPharmacy,
    supplier: suppliers.pharmacy.supplier,
    costCenter: costCenters.pharmacy,
    expenseType: expenseTypes.professionalServices,
    requestType: REQUEST_TYPE.OPEX,
    expenseNature: EXPENSE_NATURE.SERVICES,
    title: "Análisis microbiológico mensual del agua del laboratorio",
    detailedDescription: "Servicio mensual de análisis microbiológico del agua purificada usada en el laboratorio de Farmacia y Bioquímica.",
    businessJustification: "Control mensual exigido por el plan de calidad del laboratorio; servicio recurrente de bajo monto.",
    nonApprovalRisk: "El laboratorio no podría acreditar la calidad del agua usada en los ensayos del mes.",
    expenseFrequency: "MONTHLY_RECURRING",
    description: "Pago directo (Vía B) de servicio recurrente de bajo monto, conciliado y pendiente de cierre.",
    net: 2500,
    igv: 450,
    total: 2950,
    evidence: "DIRECT_PAYMENT"
  });
  scenarios.directPayment = await submitIfDraft(scenarios.directPayment, users.solicitorPharmacy);
  scenarios.directPayment = await moveToBankFile(scenarios.directPayment, users, 30019, expenseTypes.professionalServices.accountNumber, { payToday: true });
  scenarios.directPayment = await confirmPayment(scenarios.directPayment, users, "30019");
  scenarios.directPayment = await reconcileAndClose(scenarios.directPayment, users, "BBVA", "30019", { close: false });

  // SPOT: a maintenance service above PEN 700 (category 020, 12%). The BBVA file pays the net
  // amount and Treasury records the Banco de la Nación deposit separately; only then is it paid.
  scenarios.detraction = await seedRequest({
    key: "UMA_20_DETRACCION_DEPOSITADA",
    number: "SOL-2026-30020",
    requester: users.solicitorHealth,
    supplier: suppliers.services.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.maintenance,
    requestType: REQUEST_TYPE.OPEX,
    expenseNature: EXPENSE_NATURE.MAINTENANCE,
    title: "Mantenimiento correctivo de autoclaves",
    detailedDescription: "Mantenimiento correctivo de dos autoclaves del laboratorio de Microbiología, incluye repuestos y pruebas de validación.",
    businessJustification: "Los autoclaves presentan fallas en el ciclo de esterilización y son indispensables para las prácticas.",
    nonApprovalRisk: "Sin esterilización validada no pueden dictarse las prácticas de Microbiología.",
    description: "Servicio sujeto a detracción SPOT: pago neto por BBVA y depósito de detracción en Banco de la Nación.",
    net: 6000,
    igv: 1080,
    total: 7080,
    evidence: "MAINTENANCE"
  });
  scenarios.detraction = await submitIfDraft(scenarios.detraction, users.solicitorHealth);
  scenarios.detraction = await moveToBankFile(scenarios.detraction, users, 30020, expenseTypes.maintenance.accountNumber, { payToday: true });
  scenarios.detraction = await confirmPayment(scenarios.detraction, users, "30020");

  // Track A2: a framework Purchase Order for monthly reagent deliveries, invoiced through a ZIP
  // batch (one XML + PDF per delivery) instead of a single invoice.
  scenarios.batchInvoices = await seedRequest({
    key: "UMA_21_A2_LOTE_FACTURAS",
    number: "SOL-2026-30021",
    requester: users.solicitorHealth,
    supplier: suppliers.health.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.laboratorySupplies,
    requestType: REQUEST_TYPE.OPEX,
    expenseNature: EXPENSE_NATURE.GOODS,
    title: "Orden marco de reactivos de hematología - entregas mensuales",
    detailedDescription: "Orden de compra marco por reactivos de hematología con tres entregas mensuales facturadas por separado.",
    businessJustification: "El consumo es mensual y el almacén no tiene capacidad para recibir todo el volumen a la vez.",
    nonApprovalRisk: "Riesgo de desabastecimiento de reactivos para las prácticas de Laboratorio Clínico.",
    expenseFrequency: "MONTHLY_RECURRING",
    description: "Orden marco A1 facturada por lote A2: dos entregas registradas y saldo pendiente en la orden.",
    net: 30000,
    igv: 5400,
    total: 35400,
    evidence: "QUOTATION_ONLY"
  });
  scenarios.batchInvoices = await submitIfDraft(scenarios.batchInvoices, users.solicitorHealth);
  scenarios.batchInvoices = await moveToPurchaseOrder(scenarios.batchInvoices, users);
  scenarios.batchInvoices = await uploadInvoiceBatch(scenarios.batchInvoices, users, suppliers.health.supplier, [
    { number: "F001-30211", net: 10000, igv: 1800, total: 11800 },
    { number: "F001-30212", net: 10000, igv: 1800, total: 11800 }
  ]);

  return scenarios;
}

// Minimal uncompressed (stored) ZIP writer for the A2 demo batch, with the CRC-32 the reader checks.
function storedZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const filename = Buffer.from(name);
    const data = Buffer.from(content);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const index = Buffer.alloc(46);
    index.writeUInt32LE(0x02014b50);
    index.writeUInt16LE(20, 4);
    index.writeUInt16LE(20, 6);
    index.writeUInt32LE(crc, 16);
    index.writeUInt32LE(data.length, 20);
    index.writeUInt32LE(data.length, 24);
    index.writeUInt16LE(filename.length, 28);
    index.writeUInt32LE(offset, 42);
    local.push(header, filename, data);
    central.push(index, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

async function moveToPurchaseOrder(request, users) {
  let current = await approveUntilComplete(request, users);
  if (current.status !== REQUEST_STATUS.BUDGET_COMMITTED) return current;
  if (!current.purchaseOrder) {
    await issueProcurementOrder({ requestId: current._id, user: users.procurement, req: fakeReq });
    current = await refresh(current);
  }
  return current;
}

async function uploadInvoiceBatch(request, users, supplier, invoices) {
  const current = await refresh(request);
  if (!current.purchaseOrder || await MassUploadBatch.exists({ request: current._id })) return current;
  const entries = {};
  for (const invoice of invoices) {
    entries[`${invoice.number}.xml`] = invoiceXml({ supplier, number: invoice.number, date: currentDate, currency: current.currency, net: invoice.net, igv: invoice.igv, total: invoice.total });
    entries[`${invoice.number}.pdf`] = minimalPdf(`Factura ${invoice.number}`);
  }
  const zip = storedZip(entries);
  const zipPath = path.join(uploadRoot, "tmp", `lote-a2-${current._id}.zip`);
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  await fs.writeFile(zipPath, zip);
  const batch = await createMassUploadBatch({
    purchaseOrderId: current.purchaseOrder,
    files: { batchFile: [{ originalname: "lote-facturas-demo.zip", filename: path.basename(zipPath), path: zipPath, mimetype: "application/zip", size: zip.length }] },
    user: userById(users, current.requester),
    req: fakeReq
  });
  // The seed processes the batch itself instead of waiting for the batch worker. If inline
  // processing (BATCH_INVOICE_INLINE_PROCESSING) already claimed it, wait for that run.
  await processMassUploadBatch(batch._id);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const saved = await MassUploadBatch.findById(batch._id).lean();
    if (!["QUEUED", "PROCESSING"].includes(saved.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return refresh(current);
}

async function buildSummary(users) {
  const [statusSummary, collectionSummary] = await Promise.all([
    FinancialRequest.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 }, amountPEN: { $sum: "$totalPENEquivalent" } } },
      { $sort: { _id: 1 } }
    ]),
    Promise.all([
      User.countDocuments(),
      Supplier.countDocuments(),
      CostCenter.countDocuments(),
      ExpenseType.countDocuments(),
      FinancialRequest.countDocuments()
    ])
  ]);
  const scenarios = await FinancialRequest.find({ developmentScenarioKey: { $exists: true, $ne: null } }).sort({ requestNumber: 1 }).select("developmentScenarioKey requestNumber flowType status").lean();
  return {
    success: true,
    dataset: "UMA cohesive development demo",
    accountingPeriod: currentPeriod,
    users: collectionSummary[0],
    suppliers: collectionSummary[1],
    costCenters: collectionSummary[2],
    expenseTypes: collectionSummary[3],
    requests: collectionSummary[4],
    statuses: statusSummary,
    primaryDemoAccounts: [
      users.admin.email,
      users.solicitorHealth.email,
      users.directorHealth.email,
      users.viceRector.email,
      users.budget.email,
      users.accounting.email,
      users.treasury.email,
      users.management.email
    ],
    password: demoPassword,
    passwordSource: process.env.SEED_DEMO_PASSWORD ? "SEED_DEMO_PASSWORD env var" : "generated for this run only",
    notice: "Development-only fictional data. SUNAT and bank files remain manual/demo integrations; the USD rates and the BBVA format configuration are DEMO values.",
    scenarios: scenarios.map(({ developmentScenarioKey, requestNumber, flowType, status }) => ({ key: developmentScenarioKey, requestNumber, flowType, status }))
  };
}

// Connects with MONGODB_URI (the developer database by default), seeds, and returns the summary.
// The caller owns the connection afterwards (the CLI entry point below disconnects).
// A development machine configured for SUNAT_PROVIDER_MODE=PADRON usually has no downloaded
// Padrón, and then no demo invoice could be validated. The seed (never run in production)
// switches its own process to MOCK validation in that case and says so.
async function useMockSunatWithoutPadron() {
  if (!["PADRON", "PUBLIC_PADRON", "PUBLIC-PADRON"].includes(String(process.env.SUNAT_PROVIDER_MODE || "").toUpperCase())) return;
  const status = await getSunatPadronStatus().catch(() => ({ ready: false }));
  if (status.ready) return;
  console.warn("[SEED] SUNAT_PROVIDER_MODE=PADRON but no Padrón dataset is downloaded: demo invoices are validated with the MOCK provider for this seed run only.");
  process.env.SUNAT_PROVIDER_MODE = "MOCK";
}

export async function seed() {
  if (process.env.NODE_ENV === "production") throw new Error("Development seed is disabled in production.");
  await useMockSunatWithoutPadron();
  await connectDB();
  await fs.mkdir(generatedRoot, { recursive: true });
  await fs.mkdir(uploadRoot, { recursive: true });
  const costCenters = await seedCostCenters();
  const users = await seedUsers(costCenters);
  await seedEmployeeReimbursementBanking(users);
  const expenseTypes = await seedExpenseTypes();
  const suppliers = await seedSuppliers(users.admin);
  await seedPeriodsAndRates(users.admin);
  await ensureSpotCategories();
  await seedRulesAndMappings({ costCenters, expenseTypes });
  await seedScenarios({ users, suppliers, costCenters, expenseTypes });
  await Counter.updateOne(
    { key: "financial-request", year: Number(currentPeriod.slice(0, 4)) },
    { $max: { sequence: 30100 } },
    { upsert: true }
  );
  await Counter.updateOne(
    { key: "supplier", year: 0 },
    { $max: { sequence: 5 } },
    { upsert: true }
  );
  return buildSummary(users);
}

if (isMainModule(import.meta.url)) {
  seed()
    .then((summary) => console.log(JSON.stringify(summary, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect());
}

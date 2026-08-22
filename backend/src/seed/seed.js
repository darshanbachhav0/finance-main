import bcrypt from "bcrypt";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";
import AccountingMapping from "../models/AccountingMapping.js";
import AccountingPeriod from "../models/AccountingPeriod.js";
import ApprovalRule from "../models/ApprovalRule.js";
import BankFormatConfiguration from "../models/BankFormatConfiguration.js";
import BudgetAllocation from "../models/BudgetAllocation.js";
import BudgetRule from "../models/BudgetRule.js";
import CostCenter from "../models/CostCenter.js";
import Counter from "../models/Counter.js";
import DocumentRule from "../models/DocumentRule.js";
import ExchangeRate from "../models/ExchangeRate.js";
import ExpenseType from "../models/ExpenseType.js";
import EmployeeReimbursementBankAccount from "../models/EmployeeReimbursementBankAccount.js";
import FinanceConfiguration from "../models/FinanceConfiguration.js";
import FinancialRequest from "../models/FinancialRequest.js";
import Project from "../models/Project.js";
import Supplier from "../models/Supplier.js";
import SupplierBankAccount from "../models/SupplierBankAccount.js";
import User from "../models/User.js";
import { commitApprovedRequestBudget, decideApproval } from "../services/approvalService.js";
import { processAccountsPayable } from "../services/accountingService.js";
import { recordAudit, workflowEvent } from "../services/auditService.js";
import { closeFinancialRequest, submitFinancialRequest } from "../services/requestService.js";
import { reviewRendition, submitRendition } from "../services/renditionService.js";
import { generatedRoot, uploadRoot } from "../services/storageService.js";
import {
  confirmTreasuryPayment,
  generatePaymentBatch,
  reconcilePayment,
  schedulePayments
} from "../services/treasuryService.js";
import { connectDB } from "../config/db.js";
import {
  APPROVAL_STAGES,
  EXPENSE_NATURE,
  FLOW_TYPE,
  FINANCE_CONFIGURATION_KEYS,
  REQUEST_STATUS,
  REQUEST_TYPE,
  ROLES
} from "../utils/constants.js";

dotenv.config();

const now = new Date();
const currentDate = now.toISOString().slice(0, 10);
const currentPeriod = currentDate.slice(0, 7);
const previousMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const closedPeriod = previousMonthDate.toISOString().slice(0, 7);
const demoPassword = "UMA-Demo-2026!";
const manualUsdRate = 3.75;
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
      role: ROLES.ADMIN,
      area: AREAS.IT,
      approvalAreas: ["*"]
    },
    {
      key: "solicitorHealth",
      name: "Solicitante Ciencias de la Salud (Demo)",
      email: "demo.solicitante.salud@uma.edu.pe",
      role: ROLES.SOLICITOR,
      area: AREAS.HEALTH,
      costCenter: costCenters.health,
      authorizedCostCenters: [costCenters.health]
    },
    {
      key: "directorHealth",
      name: "Dirección de Ciencias de la Salud (Demo)",
      email: "demo.director.salud@uma.edu.pe",
      role: ROLES.APPROVER,
      approvalLevel: APPROVAL_STAGES.AREA_DIRECTOR,
      area: AREAS.HEALTH,
      approvalAreas: [AREAS.HEALTH]
    },
    {
      key: "viceRector",
      name: "Vicerrectorado Académico UMA (Demo)",
      email: "demo.vicerrector@uma.edu.pe",
      role: ROLES.APPROVER,
      approvalLevel: APPROVAL_STAGES.VICE_RECTOR,
      area: AREAS.RECTORATE,
      approvalAreas: ["*"]
    },
    {
      key: "budget",
      name: "Presupuesto UMA (Demo)",
      email: "demo.presupuesto@uma.edu.pe",
      role: ROLES.BUDGET,
      area: AREAS.FINANCE,
      approvalAreas: ["*"]
    },
    {
      key: "accounting",
      name: "Contabilidad UMA (Demo)",
      email: "demo.contabilidad@uma.edu.pe",
      role: ROLES.ACCOUNTING,
      area: AREAS.FINANCE,
      approvalAreas: ["*"]
    },
    {
      key: "treasury",
      name: "Tesorería UMA (Demo)",
      email: "demo.tesoreria@uma.edu.pe",
      role: ROLES.TREASURY,
      area: AREAS.FINANCE,
      approvalAreas: ["*"]
    },
    {
      key: "management",
      name: "Gerencia / Rectorado UMA (Demo)",
      email: "demo.gerencia@uma.edu.pe",
      role: ROLES.MANAGEMENT,
      approvalLevel: APPROVAL_STAGES.RECTORATE,
      area: AREAS.RECTORATE,
      approvalAreas: ["*"]
    },
    {
      key: "solicitorPharmacy",
      name: "Solicitante Farmacia y Bioquímica (Demo)",
      email: "demo.solicitante.farmacia@uma.edu.pe",
      role: ROLES.SOLICITOR,
      area: AREAS.PHARMACY,
      costCenter: costCenters.pharmacy,
      authorizedCostCenters: [costCenters.pharmacy]
    },
    {
      key: "directorPharmacy",
      name: "Dirección de Farmacia y Bioquímica (Demo)",
      email: "demo.director.farmacia@uma.edu.pe",
      role: ROLES.APPROVER,
      approvalLevel: APPROVAL_STAGES.AREA_DIRECTOR,
      area: AREAS.PHARMACY,
      approvalAreas: [AREAS.PHARMACY]
    },
    {
      key: "solicitorEngineering",
      name: "Solicitante Ingeniería y Negocios (Demo)",
      email: "demo.solicitante.ingenieria@uma.edu.pe",
      role: ROLES.SOLICITOR,
      area: AREAS.ENGINEERING,
      costCenter: costCenters.engineering,
      authorizedCostCenters: [costCenters.engineering, costCenters.research]
    },
    {
      key: "directorEngineering",
      name: "Dirección de Ingeniería y Negocios (Demo)",
      email: "demo.director.ingenieria@uma.edu.pe",
      role: ROLES.APPROVER,
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

async function seedSupplier({ key, supplierCode, identifier, name, bank, account, cci, currency, address, supplierType, admin, previousAccount }) {
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
    reviewComments: "Proveedor ficticio homologado para demostración UMA."
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
      account: "001101234567890123",
      cci: "01100101234567890123",
      currency: "PEN",
      address: "Ate, Lima (domicilio ficticio)",
      supplierType: "Reactivos y material farmacéutico",
      previousAccount: { account: "001109876543210987", cci: "01100109876543210987" }
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
      supplierType: "Mantenimiento e infraestructura"
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
  await upsert(ExchangeRate, {
    currency: "USD",
    date: new Date(`${currentDate}T00:00:00.000Z`)
  }, {
    quoteCurrency: "PEN",
    period: currentPeriod,
    rate: manualUsdRate,
    source: "MANUAL",
    sourceLabel: "Tasa de venta manual DEMO; no validada contra SUNAT",
    providerMode: "MANUAL",
    authoritative: false,
    active: true,
    createdBy: admin._id
  });
}

async function seedRulesAndMappings({ costCenters, expenseTypes }) {
  for (const area of [AREAS.HEALTH, AREAS.PHARMACY, AREAS.ENGINEERING]) {
    await upsert(ApprovalRule, { name: `Dirección de Área - ${area}` }, {
      approvalLevel: APPROVAL_STAGES.AREA_DIRECTOR,
      role: ROLES.APPROVER,
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
    role: ROLES.APPROVER,
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
    role: ROLES.APPROVER,
    area: "*",
    amountFrom: 0,
    requestType: "*",
    flowType: FLOW_TYPE.B,
    required: true,
    sequence: 1,
    slaHours: 4,
    active: true
  });

  const documentRules = [
    ["DOC-UMA-COTIZACION", REQUEST_TYPE.PAGO_CON_COTIZACION, "*", [
      { kind: "XML", minCount: 1, labelKey: "XML de comprobante" },
      { kind: "PDF", minCount: 1, labelKey: "PDF de comprobante" }
    ]],
    ["DOC-UMA-REEMBOLSO", REQUEST_TYPE.REEMBOLSO_CON_SUSTENTO, "*", [
      { kind: "XML", minCount: 1, labelKey: "XML de comprobante" },
      { kind: "PDF", minCount: 1, labelKey: "PDF de comprobante" }
    ]],
    ["DOC-UMA-BIENES", "*", EXPENSE_NATURE.GOODS, [
      { kind: "QUOTATION", minCount: 3, labelKey: "tres cotizaciones" },
      { kind: "PDF", minCount: 1, labelKey: "factura o comprobante" }
    ]],
    ["DOC-UMA-SERVICIOS", "*", EXPENSE_NATURE.SERVICES, [
      { kind: "PDF", minCount: 1, labelKey: "comprobante electrónico" },
      { kind: "CONTRACT", minCount: 1, labelKey: "contrato firmado" },
      { kind: "CONFORMITY", minCount: 1, labelKey: "conformidad del servicio" }
    ]],
    ["DOC-UMA-MANTENIMIENTO", "*", EXPENSE_NATURE.MAINTENANCE, [
      { kind: "PDF", minCount: 1, labelKey: "comprobante" },
      { kind: "CONTRACT", minCount: 1, labelKey: "orden o contrato" },
      { kind: "CONFORMITY", minCount: 1, labelKey: "conformidad de mantenimiento" }
    ]],
    ["DOC-UMA-VIAJE", "*", EXPENSE_NATURE.TRAVEL, [
      { kind: "SUPPORTING", minCount: 1, labelKey: "sustento de viaje o movilidad" }
    ]],
    ["DOC-UMA-CAJA", "*", EXPENSE_NATURE.PETTY_CASH, [
      { kind: "SUPPORTING", minCount: 1, labelKey: "comprobantes de sustento" }
    ]],
    ["DOC-UMA-LIQUIDACION", "*", EXPENSE_NATURE.REIMBURSEMENT_LIQUIDATION, [
      { kind: "SUPPORTING", minCount: 1, labelKey: "evidencia validada" }
    ]]
  ];
  for (const [code, requestType, expenseNature, requirements] of documentRules) {
    const quotationRequirement = requirements.find((item) => item.kind === "QUOTATION");
    await upsert(DocumentRule, { code }, {
      requestType,
      expenseNature,
      requirements,
      quotationPolicy: {
        enabled: Boolean(quotationRequirement),
        minimumCount: quotationRequirement?.minCount || 3,
        allowAuthorizedException: true,
        exceptionReasonRequired: true
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
      await upsert(BankFormatConfiguration, { bank, currency }, {
        mode: "DEMO",
        specificationVersion: "UMA-DEMO-2026-1",
        certified: false,
        notes: "DEMO / NO CERTIFICADO. Requiere el layout oficial aprobado por UMA y el banco.",
        active: true
      });
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

async function addEvidenceProfile(request, profile, supplier, user, voucherNumber) {
  if (profile === "GOODS_XML") {
    for (let index = 1; index <= 3; index += 1) {
      await addAttachment(request, "QUOTATION", `cotizacion-${index}-${request.requestNumber}.pdf`, minimalPdf(`Cotización ${index} - ${request.requestNumber}`), user);
    }
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
  } else if (profile === "SERVICE" || profile === "MAINTENANCE") {
    await addAttachment(request, "PDF", `comprobante-${request.requestNumber}.pdf`, minimalPdf(`Comprobante - ${request.requestNumber}`), user);
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
    await addAttachment(request, "PDF", `ficha-tecnica-${request.requestNumber}.pdf`, minimalPdf(`Ficha técnica - ${request.requestNumber}`), user);
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
  voucherNumber = `FDEM-${number.slice(-5)}`,
  period = currentPeriod
}) {
  const existing = await FinancialRequest.findOne({ developmentScenarioKey: key });
  if (existing) return existing;
  const exchangeRate = currency === "USD" ? manualUsdRate : 1;
  const request = new FinancialRequest({
    developmentScenarioKey: key,
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
    exchangeRateSource: currency === "USD" ? "Tasa manual DEMO; no validada contra SUNAT" : "PEN",
    supplier: supplier._id,
    supplierSnapshot: {
      identifierType: supplier.identifierType,
      identifier: supplier.normalizedIdentifier,
      legalName: supplier.legalName,
      homologationStatus: supplier.homologationStatus
    },
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
  const actor = stage === APPROVAL_STAGES.AREA_DIRECTOR
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
  const routeComplete = current.status === REQUEST_STATUS.VICE_RECTOR_APPROVED
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
  }
  await processAccountsPayable({
    requestId: current._id,
    payload: accountingPayload(current, sequence, accountNumber),
    user: users.accounting,
    req: fakeReq
  });
  return refresh(current);
}

async function moveToBankFile(request, users, sequence, accountNumber, bank) {
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
    bank,
    currency: current.currency,
    paymentDate: currentDate,
    user: users.treasury,
    req: fakeReq
  });
  return refresh(current);
}

async function confirmPayment(request, users, bank, operationSuffix) {
  const current = await refresh(request);
  if ([
    REQUEST_STATUS.PAID,
    REQUEST_STATUS.RENDITION_PENDING,
    REQUEST_STATUS.RECONCILED,
    REQUEST_STATUS.CLOSED
  ].includes(current.status)) return current;
  await confirmTreasuryPayment({
    requestId: current._id,
    payload: {
      operationNumber: `UMA-${bank}-${operationSuffix}`,
      paidAt: currentDate,
      confirmedAmount: current.totalAmount,
      comments: "Pago bancario confirmado manualmente para demostración UMA."
    },
    user: users.treasury,
    req: fakeReq
  });
  return refresh(current);
}

async function reconcileAndClose(request, users, bank, referenceSuffix) {
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
  if (current.status === REQUEST_STATUS.RECONCILED) {
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
    requestType: REQUEST_TYPE.PAGO_CON_COTIZACION,
    expenseNature: EXPENSE_NATURE.GOODS,
    description: "Reactivos para control de calidad en el laboratorio de Farmacia y Bioquímica.",
    net: 20000,
    igv: 3600,
    total: 23600,
    evidence: "GOODS_XML",
    voucherNumber: "F001-30003"
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
    requestType: REQUEST_TYPE.PAGO_CON_COTIZACION,
    expenseNature: EXPENSE_NATURE.GOODS,
    description: "Material descartable para prácticas de Enfermería, provisionado y pendiente de Tesorería.",
    net: 12000,
    igv: 2160,
    total: 14160,
    evidence: "GOODS_XML",
    voucherNumber: "F001-30006"
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
    description: "Servicio de mantenimiento del software de simulación clínica programado para pago.",
    net: 8000,
    igv: 1440,
    total: 9440,
    evidence: "SERVICE"
  });
  scenarios.scheduled = await submitIfDraft(scenarios.scheduled, users.solicitorHealth);
  scenarios.scheduled = await moveToAccounting(scenarios.scheduled, users, 30007, expenseTypes.professionalServices.accountNumber);
  await schedulePayments({
    requestIds: [scenarios.scheduled._id.toString()],
    bank: "BCP",
    currency: "PEN",
    paymentDate: currentDate,
    user: users.treasury,
    req: fakeReq
  });
  scenarios.scheduled = await refresh(scenarios.scheduled);

  scenarios.scotiabankTxt = await seedRequest({
    key: "UMA_08_TXT_SCOTIABANK",
    number: "SOL-2026-30008",
    requester: users.solicitorHealth,
    supplier: suppliers.services.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.maintenance,
    requestType: REQUEST_TYPE.OPEX,
    expenseNature: EXPENSE_NATURE.MAINTENANCE,
    description: "Adecuación eléctrica de laboratorio incluida en TXT Scotiabank, pago aún no confirmado.",
    net: 10000,
    igv: 1800,
    total: 11800,
    evidence: "MAINTENANCE"
  });
  scenarios.scotiabankTxt = await submitIfDraft(scenarios.scotiabankTxt, users.solicitorHealth);
  scenarios.scotiabankTxt = await moveToBankFile(scenarios.scotiabankTxt, users, 30008, expenseTypes.maintenance.accountNumber, "SCOTIABANK");

  scenarios.interbankTxt = await seedRequest({
    key: "UMA_09_TXT_INTERBANK_USD",
    number: "SOL-2026-30009",
    requester: users.solicitorEngineering,
    supplier: suppliers.engineering.supplier,
    costCenter: costCenters.engineering,
    expenseType: expenseTypes.technologyAssets,
    requestType: REQUEST_TYPE.CAPEX,
    expenseNature: EXPENSE_NATURE.EQUIPMENT,
    description: "Servidores GPU para el laboratorio de Inteligencia Artificial incluidos en TXT Interbank USD.",
    net: 30000,
    igv: 5400,
    total: 35400,
    currency: "USD",
    project: "PRJ-CAMPUS-DIGITAL-2026",
    evidence: "CAPEX"
  });
  scenarios.interbankTxt = await submitIfDraft(scenarios.interbankTxt, users.solicitorEngineering);
  scenarios.interbankTxt = await moveToBankFile(scenarios.interbankTxt, users, 30009, expenseTypes.technologyAssets.accountNumber, "INTERBANK");

  scenarios.bbvaPaid = await seedRequest({
    key: "UMA_10_PAGADO_BBVA",
    number: "SOL-2026-30010",
    requester: users.solicitorPharmacy,
    supplier: suppliers.pharmacy.supplier,
    costCenter: costCenters.pharmacy,
    expenseType: expenseTypes.laboratorySupplies,
    requestType: REQUEST_TYPE.PAGO_CON_COTIZACION,
    expenseNature: EXPENSE_NATURE.GOODS,
    description: "Estándares de referencia farmacéutica pagados por BBVA y pendientes de conciliación.",
    net: 25000,
    igv: 4500,
    total: 29500,
    evidence: "GOODS_XML",
    voucherNumber: "F001-30010"
  });
  scenarios.bbvaPaid = await submitIfDraft(scenarios.bbvaPaid, users.solicitorPharmacy);
  scenarios.bbvaPaid = await moveToBankFile(scenarios.bbvaPaid, users, 30010, expenseTypes.laboratorySupplies.accountNumber, "BBVA");
  scenarios.bbvaPaid = await confirmPayment(scenarios.bbvaPaid, users, "BBVA", "30010");

  scenarios.bcpClosed = await seedRequest({
    key: "UMA_11_CERRADO_BCP",
    number: "SOL-2026-30011",
    requester: users.solicitorHealth,
    supplier: suppliers.health.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.laboratorySupplies,
    requestType: REQUEST_TYPE.PAGO_CON_COTIZACION,
    expenseNature: EXPENSE_NATURE.GOODS,
    description: "Micropipetas para Laboratorio Clínico: ciclo completo, pago BCP, conciliación y cierre.",
    net: 18000,
    igv: 3240,
    total: 21240,
    evidence: "GOODS_XML",
    voucherNumber: "F001-30011"
  });
  scenarios.bcpClosed = await submitIfDraft(scenarios.bcpClosed, users.solicitorHealth);
  scenarios.bcpClosed = await moveToBankFile(scenarios.bcpClosed, users, 30011, expenseTypes.laboratorySupplies.accountNumber, "BCP");
  scenarios.bcpClosed = await confirmPayment(scenarios.bcpClosed, users, "BCP", "30011");
  scenarios.bcpClosed = await reconcileAndClose(scenarios.bcpClosed, users, "BCP", "30011");

  scenarios.advancePending = await seedRequest({
    key: "UMA_12_RENDICION_PENDIENTE",
    number: "SOL-2026-30012",
    requester: users.solicitorHealth,
    supplier: suppliers.beneficiary.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.travel,
    requestType: REQUEST_TYPE.ENTREGA_RENDIR,
    expenseNature: EXPENSE_NATURE.TRAVEL,
    description: "Entrega a rendir para visita académica de Ciencias de la Salud; pendiente de sustento.",
    net: 4000,
    igv: 0,
    total: 4000,
    evidence: "SUPPORTING"
  });
  scenarios.advancePending = await submitIfDraft(scenarios.advancePending, users.solicitorHealth);
  scenarios.advancePending = await moveToBankFile(scenarios.advancePending, users, 30012, expenseTypes.travel.accountNumber, "BCP");
  scenarios.advancePending = await confirmPayment(scenarios.advancePending, users, "BCP", "30012");

  scenarios.advanceClosed = await seedRequest({
    key: "UMA_13_RENDICION_CERRADA",
    number: "SOL-2026-30013",
    requester: users.solicitorHealth,
    supplier: suppliers.beneficiary.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.travel,
    requestType: REQUEST_TYPE.ENTREGA_RENDIR,
    expenseNature: EXPENSE_NATURE.TRAVEL,
    description: "Entrega a rendir para jornada de investigación: sustentada, validada, conciliada y cerrada.",
    net: 4720,
    igv: 0,
    total: 4720,
    evidence: "SUPPORTING"
  });
  scenarios.advanceClosed = await submitIfDraft(scenarios.advanceClosed, users.solicitorHealth);
  scenarios.advanceClosed = await moveToBankFile(scenarios.advanceClosed, users, 30013, expenseTypes.travel.accountNumber, "BCP");
  scenarios.advanceClosed = await confirmPayment(scenarios.advanceClosed, users, "BCP", "30013");
  if (scenarios.advanceClosed.status === REQUEST_STATUS.RENDITION_PENDING && scenarios.advanceClosed.rendition?.status === "PENDING") {
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
  if (scenarios.advanceClosed.status === REQUEST_STATUS.RENDITION_PENDING && scenarios.advanceClosed.rendition?.status === "SUBMITTED") {
    await reviewRendition({
      requestId: scenarios.advanceClosed._id,
      action: "VALIDATE",
      comments: "Rendición validada por Contabilidad; gasto reconocido y Cuenta 14 compensada.",
      user: users.accounting,
      req: fakeReq
    });
    scenarios.advanceClosed = await refresh(scenarios.advanceClosed);
  }
  scenarios.advanceClosed = await reconcileAndClose(scenarios.advanceClosed, users, "BCP", "30013");

  scenarios.nonDeductible = await seedRequest({
    key: "UMA_14_REEMBOLSO_NO_DEDUCIBLE",
    number: "SOL-2026-30014",
    requester: users.solicitorHealth,
    supplier: suppliers.beneficiary.supplier,
    costCenter: costCenters.health,
    expenseType: expenseTypes.nonDeductible,
    requestType: REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO,
    expenseNature: EXPENSE_NATURE.REIMBURSEMENT_LIQUIDATION,
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
    expenseNature: EXPENSE_NATURE.RESEARCH,
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
    description: "Registro histórico de prueba asociado a un periodo cerrado; no debe poder modificarse.",
    net: 1000,
    igv: 180,
    total: 1180,
    evidence: "NONE",
    period: closedPeriod
  });

  return scenarios;
}

async function printSummary(users) {
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
  console.log(JSON.stringify({
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
    notice: "Development-only fictional data. SUNAT and bank files remain manual/demo integrations."
  }, null, 2));
}

async function seed() {
  if (process.env.NODE_ENV === "production") throw new Error("Development seed is disabled in production.");
  await connectDB();
  await fs.mkdir(generatedRoot, { recursive: true });
  await fs.mkdir(uploadRoot, { recursive: true });
  const costCenters = await seedCostCenters();
  const users = await seedUsers(costCenters);
  await seedEmployeeReimbursementBanking(users);
  const expenseTypes = await seedExpenseTypes();
  const suppliers = await seedSuppliers(users.admin);
  await seedPeriodsAndRates(users.admin);
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
  await printSummary(users);
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());

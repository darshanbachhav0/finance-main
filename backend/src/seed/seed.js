import bcrypt from "bcrypt";
import crypto from "crypto";
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
import FinanceConfiguration from "../models/FinanceConfiguration.js";
import FinancialRequest from "../models/FinancialRequest.js";
import Project from "../models/Project.js";
import Supplier from "../models/Supplier.js";
import SupplierBankAccount from "../models/SupplierBankAccount.js";
import User from "../models/User.js";
import { removeDemoAccounts } from "../services/demoAccountRemovalService.js";
import { ensureSpotCategories } from "../services/detractionService.js";
import { generatedRoot, uploadRoot } from "../services/storageService.js";
import { connectDB } from "../config/db.js";
import { isMainModule } from "../workers/isMainModule.js";
import {
  APPROVAL_STAGES,
  EXPENSE_NATURE,
  FLOW_TYPE,
  FINANCE_CONFIGURATION_KEYS,
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

// The staff accounts of the demo. Requesters, area directors, the Vice Rector, Management and
// Procurement are no longer seeded (demoAccountRemovalService removes the ones earlier seeds made);
// each keeps the employee code it always had.
async function seedUsers() {
  const definitions = [
    { key: "admin", code: 1, name: "Administración ERP UMA (Demo)", email: "demo.admin@uma.edu.pe", dni: "10000001", role: ROLES.ADMIN, area: AREAS.IT },
    // Budget work is Treasury's: a second Treasury user handles budget plans and exceptions.
    { key: "budget", code: 5, name: "Tesorería - Presupuesto UMA (Demo)", email: "demo.presupuesto@uma.edu.pe", dni: "10000007", role: ROLES.TREASURY, area: AREAS.FINANCE },
    { key: "accounting", code: 7, name: "Contabilidad UMA (Demo)", email: "demo.contabilidad@uma.edu.pe", dni: "10000005", role: ROLES.ACCOUNTING, area: AREAS.FINANCE },
    { key: "treasury", code: 8, name: "Tesorería UMA (Demo)", email: "demo.tesoreria@uma.edu.pe", dni: "10000006", role: ROLES.TREASURY, area: AREAS.FINANCE }
  ];

  const users = {};
  for (const definition of definitions) {
    const passwordHash = await bcrypt.hash(demoPassword, 12);
    users[definition.key] = await upsert(User, { email: definition.email }, {
      name: definition.name,
      employeeCode: `UMA-DEMO-${String(definition.code).padStart(3, "0")}`,
      email: definition.email,
      dni: definition.dni,
      passwordHash,
      role: definition.role,
      approvalAreas: ["*"],
      area: definition.area,
      active: true
    });
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

  // A database seeded by an earlier version of this seed keeps that version's demo account (another
  // number) as the active preferred one; only one may be, so it is retired before this one is set.
  await SupplierBankAccount.updateMany(
    { supplier: supplier._id, currency, accountType: "CURRENT", active: true, preferred: true, accountNumber: { $ne: account }, createdBy: admin._id },
    { $set: { active: false, preferred: false, validTo: now, changedBy: admin._id } }
  );
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

async function seedRulesAndMappings({ costCenters }) {
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

  // Budget is held per Cost Center (one pool per project where a project has its own funds).
  const budgetDimensions = [
    ["Presupuesto Salud", costCenters.health, "", 790000, "REJECT"],
    ["Presupuesto Farmacia", costCenters.pharmacy, "", 480000, "REJECT"],
    ["Presupuesto Ingeniería - Campus Digital", costCenters.engineering, "PRJ-CAMPUS-DIGITAL-2026", 850000, "REJECT"],
    ["Presupuesto Ingeniería", costCenters.engineering, "", 150000, "REJECT"],
    ["Presupuesto Investigación - Biomédica", costCenters.research, "PRJ-INV-BIOMED-2026", 1000, "EXTRAORDINARY_APPROVAL"],
    ["Presupuesto Finanzas", costCenters.finance, "", 220000, "REJECT"]
  ];
  for (const [name, costCenter, project, assignedAmount, exceptionStrategy] of budgetDimensions) {
    await upsert(BudgetRule, { name }, {
      mode: "ACTIVE",
      exceptionStrategy,
      costCenter: costCenter._id,
      project: project || "*",
      active: true
    });
    await upsert(BudgetAllocation, {
      period: currentPeriod,
      costCenter: costCenter._id,
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

async function buildSummary(users, removedDemoAccounts) {
  const collectionSummary = await Promise.all([
    User.countDocuments(),
    Supplier.countDocuments(),
    CostCenter.countDocuments(),
    ExpenseType.countDocuments(),
    FinancialRequest.countDocuments()
  ]);
  return {
    success: true,
    dataset: "UMA cohesive development demo",
    accountingPeriod: currentPeriod,
    users: collectionSummary[0],
    suppliers: collectionSummary[1],
    costCenters: collectionSummary[2],
    expenseTypes: collectionSummary[3],
    requests: collectionSummary[4],
    demoAccounts: Object.values(users).map((user) => `${user.dni} ${user.name}`),
    removedDemoAccounts,
    password: demoPassword,
    passwordSource: process.env.SEED_DEMO_PASSWORD ? "SEED_DEMO_PASSWORD env var" : "generated for this run only",
    notice: "Development-only fictional data. SUNAT and bank files remain manual/demo integrations; the USD rates and the BBVA format configuration are DEMO values."
  };
}

// Connects with MONGODB_URI (the developer database by default), seeds, and returns the summary.
// The caller owns the connection afterwards (the CLI entry point below disconnects).
export async function seed() {
  if (process.env.NODE_ENV === "production") throw new Error("Development seed is disabled in production.");
  await connectDB();
  await fs.mkdir(generatedRoot, { recursive: true });
  await fs.mkdir(uploadRoot, { recursive: true });
  // A database seeded before keeps the retired demo accounts and their requests: they go first.
  const removed = await removeDemoAccounts(mongoose.connection.db, { apply: true });
  const costCenters = await seedCostCenters();
  const users = await seedUsers();
  await seedExpenseTypes();
  await seedSuppliers(users.admin);
  await seedPeriodsAndRates(users.admin);
  await ensureSpotCategories();
  await seedRulesAndMappings({ costCenters });
  await Counter.updateOne(
    { key: "supplier", year: 0 },
    { $max: { sequence: 5 } },
    { upsert: true }
  );
  return buildSummary(users, removed.accounts);
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

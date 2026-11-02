import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AuditLog from "../src/models/AuditLog.js";
import Counter from "../src/models/Counter.js";
import Notification from "../src/models/Notification.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import { isEligibleSupplierPaymentAccount } from "../src/services/paymentDestinationService.js";
import {
  addSupplierBankAccount,
  createSupplierProposal,
  decideSupplierApproval,
  getSupplierHomologationReadiness,
  supplierRegistrationEmail,
  verifySupplierBankAccount
} from "../src/services/supplierService.js";
import { ERROR_CODES, ROLES } from "../src/utils/constants.js";
import { abaError, foreignSupplierKey, ibanError, isValidRuc, rucError, swiftError } from "../../shared/supplierRegistration.mjs";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
const invalid = (field) => (error) => error.statusCode === 422 && error.details?.field === field;

test("the pilot's registration rules: RUC check digit, SWIFT, IBAN and ABA", () => {
  assert.equal(isValidRuc("20550807123"), true);
  assert.equal(isValidRuc("20550807124"), false, "the SUNAT check digit is enforced");
  assert.equal(rucError("2055080712"), "The RUC has 11 digits.");
  assert.equal(swiftError("DEUTDEFF"), "");
  assert.equal(swiftError("DEUTDEFF500"), "");
  assert.match(swiftError("DEUT1"), /8 or 11/);
  assert.equal(ibanError("DE89 3704 0044 0532 0130 00"), "");
  assert.match(ibanError("DE89370400440532013001"), /not valid/);
  assert.match(abaError("", "Estados Unidos"), /ABA/, "banks in the United States need the ABA");
  assert.equal(abaError("", "España"), "");
  assert.equal(foreignSupplierKey("España", "B-12345678"), "EXT-ESPANA-B12345678");
});

test("supplier registration end to end: national and foreign suppliers, detraccion, Treasury validation", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_supplier_registration_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Promise.all([Counter.init(), Supplier.init(), SupplierBankAccount.init(), Notification.init(), AuditLog.init()]);
    const user = (name, role, area) => User.create({ name, email: `${name.toLowerCase().replace(/\W+/g, ".")}@test.local`, passwordHash: "unused", role, area });
    const requester = await user("Solicitante Logistica", ROLES.SOLICITOR, "Logística");
    const treasury = await user("Tesoreria Uno", ROLES.TREASURY, "Tesorería");
    const treasuryB = await user("Tesoreria Dos", ROLES.TREASURY, "Tesorería");
    const base = { legalName: "Servicios Andinos SAC", email: "ventas@andinos.pe", phone: "987654321", personType: "LEGAL_ENTITY", fiscalAddress: "Av. Arequipa 123, Lima", proposalJustification: "Mantenimiento de laboratorios" };
    const propose = (payload, who = requester) => createSupplierProposal({ payload: { ...base, ...payload }, files: {}, user: who, req });

    await t.test("a national supplier needs a valid RUC and a contact email", async () => {
      await assert.rejects(() => propose({ rucDni: "20550807124" }), invalid("rucDni"));
      await assert.rejects(() => propose({ rucDni: "20550807123", email: "" }), invalid("email"));
      await assert.rejects(() => propose({ rucDni: "20550807123", email: "ventas@" }), invalid("email"));
      await assert.rejects(() => propose({ rucDni: "20550807123", proposalJustification: " " }), invalid("proposalJustification"));
      await assert.rejects(() => propose({ rucDni: "20550807123", supplyType: "OTHER" }), invalid("supplyType"));
      assert.equal(await Supplier.countDocuments(), 0, "nothing refused is stored");
    });

    let national;
    await t.test("goods or services and the detraccion: a supplier subject to it gives its Banco de la Nacion account", async () => {
      await assert.rejects(() => propose({ rucDni: "20550807123", supplyType: "SERVICES", detractionSubject: "true" }), invalid("detractionAccountNumber"));
      await assert.rejects(() => propose({ rucDni: "20550807123", detractionSubject: true, detractionAccountNumber: "123" }), invalid("detractionAccountNumber"));
      ({ supplier: national } = await propose({
        rucDni: "20550807123", supplyType: "services", detractionSubject: "true", detractionAccountNumber: "00-012-345678",
        bankName: "BCP", accountType: "CURRENT", bankAccount: "1912345678901", cci: "00219100123456789012", accountCurrency: "PEN"
      }));
      assert.equal(national.origin, "NATIONAL");
      assert.equal(national.identifierType, "RUC");
      assert.equal(national.supplyType, "SERVICES");
      assert.equal(national.detractionSubject, true);
      assert.equal(national.detractionAccount.accountNumber, "00012345678");
      assert.equal(national.homologationStatus, "PENDING_VALIDATION");
      assert.equal(national.active, false, "not usable until Treasury validates it");
      assert.ok(await Notification.exists({ user: treasury._id, type: "SUPPLIER_REVIEW_PENDING" }), "Treasury is told to review it");
      assert.ok(await AuditLog.exists({ entityId: national._id, action: "CREATED_PENDING_VALIDATION" }));
    });

    await t.test("the same RUC cannot be registered twice", async () => {
      await assert.rejects(() => propose({ rucDni: "20550807123", legalName: "Otro nombre" }), (error) => error.statusCode === 409 && error.code === ERROR_CODES.DUPLICATE_SUPPLIER);
    });

    let foreign;
    await t.test("a supplier abroad: country and tax identification, never subject to detraccion", async () => {
      await assert.rejects(() => propose({ origin: "FOREIGN", foreignTaxId: "B12345678" }), invalid("country"));
      await assert.rejects(() => propose({ origin: "FOREIGN", country: "España" }), invalid("foreignTaxId"));
      ({ supplier: foreign } = await propose({
        origin: "FOREIGN", country: "España", foreignTaxId: "B-12345678", legalName: "Laboratorios Ibéricos SL", fiscalAddress: "Calle Mayor 1, Madrid",
        supplyType: "GOODS", detractionSubject: true,
        bankAccounts: JSON.stringify([{ scope: "FOREIGN", bankOtherName: "Deutsche Bank", bankCountry: "Alemania", bankCity: "Fráncfort", swift: "deutdeff", iban: "DE89 3704 0044 0532 0130 00" }])
      }));
      assert.equal(foreign.origin, "FOREIGN");
      assert.equal(foreign.rucDni, "EXT-ESPANA-B12345678");
      assert.equal(foreign.normalizedIdentifier, "EXT-ESPANA-B12345678", "the key keeps its letters");
      assert.equal(foreign.identifierType, "FOREIGN_TAX_ID");
      assert.equal(foreign.detractionSubject, false, "detraccion is a Peruvian tax: never for a supplier abroad");
      const [account] = await SupplierBankAccount.find({ supplier: foreign._id }).lean();
      assert.equal(account.scope, "FOREIGN");
      assert.equal(account.bank, "FOREIGN");
      assert.equal(account.bankOtherName, "Deutsche Bank");
      assert.equal(account.currency, "USD");
      assert.equal(account.cci, "");
      assert.equal(account.accountNumber, "DE89370400440532013000", "the IBAN is the account abroad");
      assert.equal(account.foreign.swift, "DEUTDEFF");
      assert.equal(account.verificationStatus, "PENDING");
    });

    await t.test("the same country and tax identification cannot be registered twice", async () => {
      await assert.rejects(
        () => propose({ origin: "FOREIGN", country: "espana", foreignTaxId: "b12345678", legalName: "Duplicado" }),
        (error) => error.statusCode === 409 && /country and tax identification/.test(error.message)
      );
    });

    await t.test("an account abroad is checked: IBAN digits, ABA for the United States, dollars only", async () => {
      const add = (payload) => addSupplierBankAccount({ supplierId: foreign._id, payload: { scope: "FOREIGN", bankOtherName: "Bank", bankCountry: "Alemania", swift: "DEUTDEFF", ...payload }, user: requester, req });
      await assert.rejects(() => add({ iban: "DE89370400440532013001" }), /IBAN is not valid/);
      await assert.rejects(() => add({ bankCountry: "Estados Unidos", accountNumber: "123456789" }), /ABA/);
      await assert.rejects(() => add({ bankCountry: "Estados Unidos", accountNumber: "123456789", aba: "12345" }), /9 digits/);
      await assert.rejects(() => add({ accountNumber: "123456789", currency: "EUR" }), /dollars/);
      await assert.rejects(() => add({ swift: "", accountNumber: "123456789" }), /SWIFT/);
      const added = await add({ bankOtherName: "Chase", bankCountry: "Estados Unidos", accountNumber: "000123456789", aba: "021000021" });
      assert.equal((added.account || added).foreign.aba, "021000021");
    });

    await t.test("Treasury validates the supplier abroad without SUNAT or a legal representative, then its account", async () => {
      const readiness = await getSupplierHomologationReadiness(foreign._id);
      assert.deepEqual(readiness.issues.map((issue) => issue.code), [], JSON.stringify(readiness.issues));
      const { supplier } = await decideSupplierApproval({ supplierId: foreign._id, payload: { decision: "APPROVE" }, user: treasury, req });
      assert.equal(supplier.homologationStatus, "HOMOLOGATED");
      assert.equal(supplier.active, true);
      assert.match(supplier.supplierCode, /^PRV-\d{4,}$/);
      const account = await SupplierBankAccount.findOne({ supplier: foreign._id, "foreign.swift": "DEUTDEFF" });
      assert.equal(isEligibleSupplierPaymentAccount(account.toObject(), { currency: "USD" }), false, "not paid before Treasury verifies the account");
      await assert.rejects(() => verifySupplierBankAccount({ supplierId: foreign._id, accountId: account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MATCH" }, user: requester, req }), (error) => error.statusCode === 403);
      const verified = await verifySupplierBankAccount({ supplierId: foreign._id, accountId: account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MATCH" }, user: treasuryB, req });
      assert.equal(isEligibleSupplierPaymentAccount(verified.toObject(), { currency: "USD" }), true);
      assert.equal(isEligibleSupplierPaymentAccount(verified.toObject(), { currency: "PEN" }), false);
    });

    await t.test("the registration email to the area that follows registrations (pilot: Control de Gestion)", () => {
      const email = supplierRegistrationEmail(national, requester);
      assert.equal(email.subject, "Nueva alta de proveedor: Servicios Andinos SAC (RUC 20550807123)");
      assert.match(email.text, /Tipo: Servicios · Sujeto a detraccion: Si/);
      assert.match(email.text, /Motivo: Mantenimiento de laboratorios/);
      assert.match(supplierRegistrationEmail(foreign, requester).subject, /\(España - B-12345678\)/);
    });
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
});

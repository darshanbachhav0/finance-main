import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import mongoose from "mongoose";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AuditLog from "../src/models/AuditLog.js";
import CostCenter from "../src/models/CostCenter.js";
import Counter from "../src/models/Counter.js";
import ExchangeRate from "../src/models/ExchangeRate.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import GeneratedFile from "../src/models/GeneratedFile.js";
import Notification from "../src/models/Notification.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import { createFinancialRequest, listRequestsPage, parseInvoiceDetails } from "../src/services/requestService.js";
import { nextRequestNumber, nextSupplierCode } from "../src/services/sequenceService.js";
import { createSupplierProposal, getSupplierDetailPayload, listSuppliersPage, lookupSupplierByIdentifier, requestSupplierAccess, updateSupplierDepartments } from "../src/services/supplierService.js";
import { isEligibleSupplierPaymentAccount, listEligibleSupplierPaymentAccounts, requestedAccountCheck } from "../src/services/paymentDestinationService.js";
import { canSeeSupplier, userDepartment } from "../src/services/supplierVisibilityService.js";
import { previewInvoiceForRequest } from "../src/services/invoicePreviewService.js";
import { migratePlatformImprovements } from "../scripts/migratePlatformImprovements.js";
import { ERROR_CODES, ROLES } from "../src/utils/constants.js";
import { limaToday } from "../../shared/businessCalendar.mjs";
import { tempUploadDir } from "../src/services/storageService.js";
import { invoiceXml } from "./fiscalFixtures.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };

test("numbers are unique and in order when many people save at the same moment", { timeout: 120000 }, async () => {
  const databaseName = `erp_numbering_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Counter.init();
    // Fifty requesters saving at once on a counter that does not exist yet (the first of the year).
    const numbers = await Promise.all(Array.from({ length: 50 }, () => nextRequestNumber(new Date("2031-03-10T15:00:00Z"))));
    assert.equal(new Set(numbers).size, 50, "no duplicate request numbers");
    assert.deepEqual([...numbers].sort(), Array.from({ length: 50 }, (_, index) => `SOL-2031-${String(index + 1).padStart(5, "0")}`), "a gapless series");
    const codes = await Promise.all(Array.from({ length: 30 }, () => nextSupplierCode()));
    assert.equal(new Set(codes).size, 30, "no duplicate PRV codes");
    // Generated files take their own DOC series.
    const user = new mongoose.Types.ObjectId();
    const files = await Promise.all(Array.from({ length: 5 }, (_, index) => GeneratedFile.create({ kind: "MANAGEMENT_CSV", fileName: `r${index}.csv`, url: `/r${index}.csv`, generatedBy: user })));
    const year = limaToday().slice(0, 4);
    assert.deepEqual(files.map((file) => file.documentNumber).sort(), [1, 2, 3, 4, 5].map((n) => `DOC-${year}-${String(n).padStart(5, "0")}`));
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test("requests: priority, frequency, the supplier's account and the receipt; suppliers by area", { timeout: 180000 }, async (t) => {
  const databaseName = `erp_platform_improvements_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Promise.all([Counter.init(), Supplier.init(), SupplierBankAccount.init(), FinancialRequest.init(), Notification.init(), AuditLog.init()]);
    const today = limaToday();
    const period = today.slice(0, 7);
    await AccountingPeriod.create({ period, status: "OPEN" });
    await ExchangeRate.create({ currency: "USD", date: new Date(`${today}T00:00:00Z`), period, rate: 3.75, source: "SUNAT", providerMode: "SUNAT", authoritative: true });
    const center = await CostCenter.create({ code: "PI-CC", name: "Tecnología", area: "Tecnología de la Información", budgetMode: "TRANSITIONAL", annualBudget: 0, active: true });
    const opex = await ExpenseType.create({ code: "PI-OPEX", name: "Services", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", active: true });
    const jefe = await User.create({ name: "PI Jefe", email: "pi.jefe@test.local", passwordHash: "unused", role: ROLES.AREA_DIRECTOR, area: "Tecnología de la Información" });
    const it = await User.create({ name: "PI Requester", email: "pi.it@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Tecnología de la Información", costCenter: center._id, authorizedCostCenters: [center._id], jefe: jefe._id });
    const admin = await User.create({ name: "PI Admin Area", email: "pi.adminarea@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Administración", jefe: jefe._id });
    const noArea = await User.create({ name: "PI No Area", email: "pi.noarea@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, jefe: jefe._id });
    const accounting = await User.create({ name: "PI Accounting", email: "pi.accounting@test.local", passwordHash: "unused", role: ROLES.ACCOUNTING, area: "Finanzas" });

    const itSupplier = await Supplier.create({ rucDni: "20777000001", legalName: "Soporte TI SAC", name: "Soporte TI SAC", supplierCode: "PRV-0041", departments: ["Tecnología de la Información"], homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true });
    const adminSupplier = await Supplier.create({ rucDni: "20777000002", legalName: "Limpieza Total SAC", name: "Limpieza Total SAC", supplierCode: "PRV-0042", departments: ["Administración"], homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true });
    const shared = await Supplier.create({ rucDni: "20777000003", legalName: "Courier Nacional SAC", name: "Courier Nacional SAC", supplierCode: "PRV-0043", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true });
    const [savingsUsd, currentPen] = await SupplierBankAccount.create([
      { supplier: itSupplier._id, bank: "BCP", currency: "USD", accountType: "SAVINGS", accountHolderName: "Soporte TI SAC", accountNumber: "19300000004321", cci: "00219300000000432100", active: true, verificationStatus: "VERIFIED", ownershipResult: "MATCH" },
      { supplier: itSupplier._id, bank: "BBVA", currency: "PEN", accountType: "CURRENT", accountHolderName: "Soporte TI SAC", accountNumber: "00110175010000001234", cci: "01117500010000001234", active: true, preferred: true, verificationStatus: "VERIFIED", ownershipResult: "MATCH" }
    ]);

    const base = (overrides = {}) => ({
      flowType: "A1", requestType: "OPEX", expenseNature: "SERVICES", issueDate: today, accountingPeriod: period, currency: "USD",
      requesterCostCenter: String(center._id), supplier: String(itSupplier._id), title: "Soporte de red", description: "Soporte de red",
      detailedDescription: "Soporte de red del laboratorio", businessJustification: "Clases",
      lines: JSON.stringify([{ costCenter: String(center._id), expenseType: String(opex._id), itemDescription: "Soporte", quantity: "1", unitOfMeasure: "SERVICE", unitPrice: "590", priceIncludesIGV: true }]),
      submit: "false",
      ...overrides
    });

    await t.test("a requester's area: their suppliers, the shared ones and their own proposals", async () => {
      assert.equal(userDepartment(it), "Tecnología de la Información");
      assert.equal(userDepartment(noArea), "", "\"General\" (the default) is no area");
      const names = (page) => page.data.map((row) => row.legalName).sort();
      assert.deepEqual(names(await listSuppliersPage({ pageSize: 50 }, it)), ["Courier Nacional SAC", "Soporte TI SAC"]);
      assert.deepEqual(names(await listSuppliersPage({ pageSize: 50 }, admin)), ["Courier Nacional SAC", "Limpieza Total SAC"]);
      assert.deepEqual(names(await listSuppliersPage({ pageSize: 50 }, noArea)), ["Courier Nacional SAC"]);
      assert.equal((await listSuppliersPage({ pageSize: 50 }, noArea)).scope.department, "");
      assert.equal((await listSuppliersPage({ pageSize: 50 }, accounting)).data.length, 3, "Accounting sees every supplier");
      // Searching the API directly cannot reach another area's supplier.
      assert.equal((await listSuppliersPage({ search: "Limpieza", pageSize: 50 }, it)).data.length, 0);
      await assert.rejects(() => getSupplierDetailPayload(adminSupplier._id, it), (error) => error.code === ERROR_CODES.SUPPLIER_OTHER_DEPARTMENT && error.statusCode === 403);
      const lookup = await lookupSupplierByIdentifier("20777000002", it);
      assert.equal(lookup.restricted, true, "the RUC lookup says it exists without opening it");
      assert.equal(lookup.data.permissions, undefined);
      assert.ok(canSeeSupplier(shared, it));
    });

    await t.test("a request cannot name another area's supplier, even through the API", async () => {
      await assert.rejects(() => createFinancialRequest({ payload: base({ supplier: String(adminSupplier._id) }), files: {}, user: it, req }), (error) => error.code === ERROR_CODES.SUPPLIER_OTHER_DEPARTMENT);
      await assert.rejects(() => createFinancialRequest({ payload: base({ quotations: JSON.stringify([{ supplier: String(adminSupplier._id), amount: 500, currency: "USD" }]) }), files: {}, user: it, req }), (error) => error.code === ERROR_CODES.SUPPLIER_OTHER_DEPARTMENT);
    });

    let request;
    await t.test("priority, frequency, observations, the chosen account and a pending receipt are saved", async () => {
      const before = (await Counter.findOne({ key: "financial-request" }))?.sequence || 0;
      await assert.rejects(() => createFinancialRequest({ payload: base({ priority: "URGENTE" }), files: {}, user: it, req }), /priority/);
      await assert.rejects(() => createFinancialRequest({ payload: base({ paymentAccount: String(new mongoose.Types.ObjectId()) }), files: {}, user: it, req }), (error) => error.code === ERROR_CODES.BANK_ACCOUNT_NOT_ELIGIBLE);
      assert.equal((await Counter.findOne({ key: "financial-request" }))?.sequence || 0, before, "a refused request takes no number");
      request = await createFinancialRequest({ payload: base({ priority: "ALTA", frequency: "MONTHLY_RECURRING", observations: "Coordinar con laboratorio", paymentAccount: String(savingsUsd._id), invoiceDetails: JSON.stringify({ status: "PENDING" }) }), files: {}, user: it, req });
      assert.equal(request.priority, "ALTA");
      assert.equal(request.priorityRank, 3);
      assert.equal(request.frequency, "MONTHLY_RECURRING");
      assert.equal(request.opexDetails.expenseFrequency, "MONTHLY_RECURRING", "OPEX keeps both in step");
      assert.equal(request.observations, "Coordinar con laboratorio");
      assert.deepEqual([request.paymentAccount.bank, request.paymentAccount.currency, request.paymentAccount.accountType, request.paymentAccount.accountLast4], ["BCP", "USD", "SAVINGS", "4321"]);
      assert.equal(request.invoiceDetails.status, "PENDING");
      assert.match(request.requestNumber, /^SOL-\d{4}-\d{5}$/);
      assert.equal(requestedAccountCheck(request).currencyMatches, true);
      // Another currency on the request is flagged, never converted.
      assert.equal(requestedAccountCheck({ ...request.toObject(), currency: "PEN" }).currencyMatches, false);
    });

    await t.test("lists filter and sort by priority (Alta first)", async () => {
      await createFinancialRequest({ payload: base({ priority: "BAJA", title: "Baja" }), files: {}, user: it, req });
      await createFinancialRequest({ payload: base({ priority: "MEDIA", title: "Media" }), files: {}, user: it, req });
      const sorted = await listRequestsPage({ ownScope: "true", sortBy: "priority", sortDirection: "desc", pageSize: 10 }, it);
      assert.deepEqual(sorted.data.map((row) => row.priority), ["ALTA", "MEDIA", "BAJA"]);
      const high = await listRequestsPage({ ownScope: "true", priority: "ALTA", pageSize: 10 }, it);
      assert.deepEqual(high.data.map((row) => row.priority), ["ALTA"]);
    });

    await t.test("the receipt read or typed is checked: no future date, an 11-digit RUC", () => {
      assert.throws(() => parseInvoiceDetails(JSON.stringify({ status: "ATTACHED", issueDate: "2999-01-01" })), /later than today/);
      assert.throws(() => parseInvoiceDetails(JSON.stringify({ status: "ATTACHED", ruc: "123" })), /11 digits/);
      const parsed = parseInvoiceDetails(JSON.stringify({ status: "ATTACHED", source: "PDF", number: "F001-123", issueDate: today, ruc: "20777000001", currency: "USD", totalAmount: "590", igvAmount: "90" }));
      assert.deepEqual([parsed.number, parsed.source, parsed.totalAmount, parsed.igvAmount], ["F001-123", "PDF", 590, 90]);
      assert.equal(parsed.issueDate.toISOString().slice(0, 10), today, "the date the receipt shows, as a calendar day");
    });

    await t.test("savings accounts are paid like current ones; the requester's account goes first", async () => {
      assert.ok(isEligibleSupplierPaymentAccount(savingsUsd));
      assert.ok(!isEligibleSupplierPaymentAccount({ ...savingsUsd.toObject(), accountType: "DETRACTION" }));
      const usd = await listEligibleSupplierPaymentAccounts({ supplierId: itSupplier._id, currency: "USD", requestedAccountId: savingsUsd._id });
      assert.deepEqual(usd.map((account) => String(account._id)), [String(savingsUsd._id)]);
      const all = await listEligibleSupplierPaymentAccounts({ supplierId: itSupplier._id, requestedAccountId: savingsUsd._id });
      assert.equal(String(all[0]._id), String(savingsUsd._id), "chosen before the preferred one");
      assert.ok(all.some((account) => String(account._id) === String(currentPen._id)));
    });

    let proposed;
    await t.test("a requester's proposal: PRV at once, their area, several accounts, CCI checked against the bank", async () => {
      const proposal = (ruc, accounts) => createSupplierProposal({ payload: { rucDni: ruc, legalName: `Proveedor ${ruc} SAC`, proposalJustification: "Servicio de red", bankAccounts: JSON.stringify(accounts) }, files: {}, user: it, req });
      const usdAccount = { bank: "BBVA", accountType: "CURRENT", accountCurrency: "USD", accountNumber: "00110175010000009999", cci: "01117500010000009999", accountHolderName: "Proveedor SAC" };
      await assert.rejects(() => proposal("20777000010", [{ bank: "BCP", accountType: "SAVINGS", accountCurrency: "PEN", accountNumber: "19300000001", cci: "01119300000000000100", accountHolderName: "Proveedor SAC" }]), /another bank/);
      await assert.rejects(() => proposal("20777000011", [{ bank: "OTHER", accountType: "SAVINGS", accountCurrency: "PEN", accountNumber: "1234567", cci: "09912300000001234567", accountHolderName: "Proveedor SAC" }]), /name of the bank/);
      assert.equal(await Supplier.countDocuments({ rucDni: { $in: ["20777000010", "20777000011"] } }), 0, "a refused proposal leaves nothing behind");
      const created = await proposal("20777000012", [{ bank: "BCP", accountType: "SAVINGS", accountCurrency: "PEN", accountNumber: "19300000001", cci: "00219300000000000100", accountHolderName: "Proveedor SAC" }, usdAccount]);
      proposed = created.supplier;
      assert.match(proposed.supplierCode, /^PRV-\d{4,}$/);
      assert.deepEqual(proposed.departments, ["Tecnología de la Información"]);
      const accounts = await SupplierBankAccount.find({ supplier: proposed._id }).sort({ currency: 1 });
      assert.deepEqual(accounts.map((account) => [account.currency, account.accountType, account.bank]), [["PEN", "SAVINGS", "BCP"], ["USD", "CURRENT", "BBVA"]]);
      assert.ok(await AuditLog.exists({ entityId: proposed._id, action: "PRV_ASSIGNED" }));
      // Another area's requester is told it exists and cannot register it again.
      await assert.rejects(() => createSupplierProposal({ payload: { rucDni: "20777000012", legalName: "Otra", proposalJustification: "x" }, files: {}, user: admin, req }), (error) => error.code === "DUPLICATE_SUPPLIER" && error.details.otherDepartment === true);
    });

    await t.test("another area asks for a supplier; Accounting shares it", async () => {
      const asked = await requestSupplierAccess({ supplierId: proposed._id, user: admin, req });
      assert.equal(asked.requested, true);
      const task = await Notification.findOne({ user: accounting._id, type: "SUPPLIER_ACCESS_REQUEST" });
      assert.ok(task, "Accounting is asked to share it");
      await assert.rejects(() => updateSupplierDepartments({ supplierId: proposed._id, departments: ["Administración"], user: admin, req }), (error) => error.statusCode === 403);
      await updateSupplierDepartments({ supplierId: proposed._id, departments: ["Tecnología de la Información", "Administración", "General"], user: accounting, req });
      const updated = await Supplier.findById(proposed._id);
      assert.deepEqual(updated.departments, ["Tecnología de la Información", "Administración"], "\"General\" is not an area");
      assert.ok(canSeeSupplier(updated, admin));
      assert.ok((await Notification.findById(task._id)).resolvedAt, "the request to share it is answered");
    });

    await t.test("the invoice reader does not offer another area's supplier", async () => {
      await fs.mkdir(tempUploadDir, { recursive: true });
      const filePath = path.join(tempUploadDir, `area-preview-${process.pid}-${Date.now()}.xml`);
      await fs.writeFile(filePath, invoiceXml({ ruc: "20777000001", series: "F001", number: "00000077", issueDate: today, currency: "USD", netAmount: 500, igvAmount: 90, totalAmount: 590 }));
      try {
        const env = { SIRE_TAXPAYER_RUC: "20100000001" };
        const own = await previewInvoiceForRequest(filePath, { env, user: it });
        assert.equal(own.supplier.legalName, "Soporte TI SAC");
        assert.equal(own.supplier.departments, undefined, "the areas are not sent to the form");
        const other = await previewInvoiceForRequest(filePath, { env, user: admin });
        assert.equal(other.supplier, null);
        assert.equal(other.supplierElsewhere.supplierCode, "PRV-0041");
        assert.equal(other.invoice.issueDate.slice(0, 10), today);
      } finally {
        await fs.rm(filePath, { force: true });
      }
    });

    await t.test("the migration numbers what has no number and ranks priorities, once", async () => {
      await Supplier.collection.insertMany([
        { rucDni: "20777000020", normalizedIdentifier: "20777000020", legalName: "Antiguo Uno", name: "Antiguo Uno", homologationStatus: "PENDING_VALIDATION", createdAt: new Date("2025-01-01") },
        { rucDni: "20777000021", normalizedIdentifier: "20777000021", legalName: "Antiguo Dos", name: "Antiguo Dos", homologationStatus: "REJECTED", createdAt: new Date("2025-02-01") }
      ]);
      await FinancialRequest.collection.updateMany({}, { $unset: { priorityRank: "", frequency: "" } });
      await GeneratedFile.collection.insertOne({ kind: "BANK_TXT", fileName: "old.txt", url: "/old.txt", generatedBy: accounting._id, createdAt: new Date("2025-06-01T15:00:00Z") });
      const dry = await migratePlatformImprovements(mongoose.connection.db, { apply: false });
      assert.equal(dry.suppliersNumbered.length, 2);
      assert.equal(await Supplier.countDocuments({ supplierCode: { $exists: false } }), 2, "a dry run changes nothing");
      const highest = Math.max(...(await Supplier.find({ supplierCode: /^PRV-/ }).lean()).map((item) => Number(item.supplierCode.slice(4))));
      const applied = await migratePlatformImprovements(mongoose.connection.db, { apply: true });
      assert.deepEqual(applied.suppliersNumbered.map((item) => item.supplierCode), [`PRV-${String(highest + 1).padStart(4, "0")}`, `PRV-${String(highest + 2).padStart(4, "0")}`], "oldest first, after the highest code");
      assert.deepEqual((await FinancialRequest.find({}).lean()).map((row) => row.priorityRank).every((rank) => rank >= 1 && rank <= 3), true);
      assert.equal((await GeneratedFile.findOne({ fileName: "old.txt" })).documentNumber, "DOC-2025-00001");
      const again = await migratePlatformImprovements(mongoose.connection.db, { apply: true });
      assert.equal(again.suppliersNumbered.length, 0, "running it again changes nothing");
      assert.equal(again.documentsNumbered, 0);
      // The next registration continues after the codes the migration gave.
      assert.equal(await nextSupplierCode(), `PRV-${String(highest + 3).padStart(4, "0")}`);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

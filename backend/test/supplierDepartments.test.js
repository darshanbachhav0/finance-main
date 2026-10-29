import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AuditLog from "../src/models/AuditLog.js";
import Counter from "../src/models/Counter.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Notification from "../src/models/Notification.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import { assertStoredAssetAccess, resolveStoredAsset } from "../src/services/fileAccessService.js";
import { globalSearch } from "../src/services/globalSearchService.js";
import {
  addSupplierBankAccount,
  createSupplierProposal,
  getSupplierDetailPayload,
  getSupplierHomologationReadiness,
  listSuppliersPage,
  lookupSupplierByIdentifier,
  requestSupplierAccess,
  updateSupplierDepartments,
  updateSupplierProposal,
  validateSupplierTaxpayer,
  verifySupplierBankAccount
} from "../src/services/supplierService.js";
import { canSeeSupplier, userDepartment } from "../src/services/supplierVisibilityService.js";
import { ERROR_CODES, REQUEST_STATUS, ROLES } from "../src/utils/constants.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
const otherDepartment = (error) => error.statusCode === 403 && error.code === ERROR_CODES.SUPPLIER_OTHER_DEPARTMENT;
const names = (page) => page.data.map((row) => row.legalName).sort();

test("one shared supplier list per department: Contabilidad, the other areas and Tesorería's oversight", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_supplier_departments_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Promise.all([Counter.init(), Supplier.init(), SupplierBankAccount.init(), Notification.init(), AuditLog.init()]);
    const user = (name, role, area) => User.create({ name, email: `${name.toLowerCase().replace(/\W+/g, ".")}@test.local`, passwordHash: "unused", role, ...(area === undefined ? {} : { area }) });
    // Contabilidad is department-scoped like any requester; Tesorería validates suppliers and sees
    // every department; the Admin no longer has a supplier workspace.
    const contabilidadA = await user("Contabilidad Uno", ROLES.ACCOUNTING, "Contabilidad");
    const contabilidadB = await user("Contabilidad Dos", ROLES.ACCOUNTING, "contabilidad ");
    const tesoreria = await user("Tesoreria Uno", ROLES.TREASURY, "Tesorería");
    const tesoreriaB = await user("Tesoreria Dos", ROLES.TREASURY, "Tesorería");
    const admin = await user("Admin Uno", ROLES.ADMIN, "Tecnología de la Información");
    const logistica = await user("Solicitante Logistica", ROLES.SOLICITOR, "Logística");
    const requester = await user("Solicitante Salud", ROLES.SOLICITOR, "Ciencias de la Salud");
    const unassigned = await user("Sin Area", ROLES.SOLICITOR);
    const legacy = await Supplier.create({ rucDni: "20888000001", legalName: "Courier Compartido SAC", name: "Courier Compartido SAC", supplierCode: "PRV-0901", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true });
    const propose = (who, ruc, legalName, extra = {}) => createSupplierProposal({ payload: { rucDni: ruc, legalName, proposalJustification: "Servicio requerido por el área", ...extra }, files: {}, user: who, req }).then((result) => result.supplier);

    let supplierA;
    await t.test("a Contabilidad employee's supplier is in Contabilidad, without choosing it", async () => {
      supplierA = await propose(contabilidadA, "20888000010", "Proveedor A Contabilidad SAC", { departments: JSON.stringify(["Logística"]) });
      assert.deepEqual(supplierA.departments, ["Contabilidad"], "the department comes from the account; a chosen one is ignored");
      assert.ok(await AuditLog.exists({ entityId: supplierA._id, action: "CREATED_PENDING_VALIDATION", "newValues.departments": ["Contabilidad"] }));
    });

    await t.test("every Contabilidad employee sees it at once; another area does not", async () => {
      assert.equal(userDepartment(contabilidadB), "contabilidad", "areas match whatever their case or spacing");
      assert.deepEqual(names(await listSuppliersPage({ pageSize: 50 }, contabilidadB)), ["Courier Compartido SAC", "Proveedor A Contabilidad SAC"]);
      assert.equal((await getSupplierDetailPayload(supplierA._id, contabilidadB)).legalName, "Proveedor A Contabilidad SAC");
      const logisticaList = await listSuppliersPage({ pageSize: 50 }, logistica);
      assert.deepEqual(names(logisticaList), ["Courier Compartido SAC"]);
      assert.deepEqual(logisticaList.scope, { scoped: true, department: "Logística" });
      assert.equal((await listSuppliersPage({ search: "Proveedor A", pageSize: 50 }, logistica)).data.length, 0);
      assert.equal((await lookupSupplierByIdentifier("20888000010", logistica)).restricted, true);
      const search = await globalSearch("Proveedor A", logistica);
      assert.deepEqual(search.groups.find((group) => group.type === "suppliers").items, []);
      const own = await globalSearch("Proveedor A", contabilidadB);
      assert.deepEqual(own.groups.find((group) => group.type === "suppliers").items.map((item) => item.title), ["Proveedor A Contabilidad SAC"]);
    });

    await t.test("the RUC stays unique: another department is told it exists instead of duplicating it", async () => {
      await assert.rejects(() => propose(logistica, "20888000010", "Duplicado SAC"), (error) => error.code === ERROR_CODES.DUPLICATE_SUPPLIER && error.details.otherDepartment === true);
      await assert.rejects(() => propose(contabilidadB, "20888000010", "Duplicado SAC"), (error) => error.code === ERROR_CODES.DUPLICATE_SUPPLIER && error.details.otherDepartment === false);
      assert.equal(await Supplier.countDocuments({ normalizedIdentifier: "20888000010" }), 1);
    });

    let supplierB;
    await t.test("Logística's supplier is hidden from Contabilidad, also through the API", async () => {
      supplierB = await propose(logistica, "20888000020", "Proveedor B Logística SAC");
      assert.deepEqual(supplierB.departments, ["Logística"]);
      assert.deepEqual(names(await listSuppliersPage({ pageSize: 50 }, logistica)), ["Courier Compartido SAC", "Proveedor B Logística SAC"]);
      for (const accountant of [contabilidadA, contabilidadB]) {
        assert.ok(!names(await listSuppliersPage({ pageSize: 50 }, accountant)).includes("Proveedor B Logística SAC"));
        await assert.rejects(() => getSupplierDetailPayload(supplierB._id, accountant), otherDepartment);
      }
      await assert.rejects(() => getSupplierHomologationReadiness(supplierB._id, contabilidadA), otherDepartment);
      await assert.rejects(() => updateSupplierProposal({ supplierId: supplierB._id, payload: { commercialName: "Cambio" }, files: {}, user: contabilidadA, req }), otherDepartment);
      await assert.rejects(() => addSupplierBankAccount({ supplierId: supplierB._id, payload: { bank: "BCP", accountType: "SAVINGS", accountCurrency: "PEN", accountNumber: "19300000001", cci: "00219300000000000100", accountHolderName: "B" }, user: contabilidadA, req }), (error) => error.statusCode === 403);
      await assert.rejects(() => assertStoredAssetAccess(resolveStoredAsset(`/uploads/suppliers/${supplierB._id}/ruc.pdf`), contabilidadA), (error) => error.statusCode === 403);
      // Tesorería sees every department; the Admin has no supplier workspace any more.
      await assertStoredAssetAccess(resolveStoredAsset(`/uploads/suppliers/${supplierB._id}/ruc.pdf`), tesoreria);
      await assert.rejects(() => assertStoredAssetAccess(resolveStoredAsset(`/uploads/suppliers/${supplierB._id}/ruc.pdf`), admin), (error) => error.statusCode === 403);
    });

    await t.test("Treasury reviews every department's proposals; Accounting no longer does", async () => {
      const queue = await listSuppliersPage({ awaitingMyApproval: "true", pageSize: 50 }, tesoreria);
      assert.ok(["Proveedor A Contabilidad SAC", "Proveedor B Logística SAC"].every((name) => names(queue).includes(name)), "the review rule reaches every department");
      assert.equal(queue.scope.scoped, false);
      assert.equal((await getSupplierDetailPayload(supplierB._id, tesoreria)).permissions.canApprove, true);
      await assertStoredAssetAccess(resolveStoredAsset(`/uploads/suppliers/${supplierB._id}/ruc.pdf`), tesoreria);
      assert.deepEqual(names(await listSuppliersPage({ awaitingMyApproval: "true", pageSize: 50 }, contabilidadA)), [], "Accounting has no supplier review queue");
      assert.equal((await getSupplierDetailPayload(supplierA._id, contabilidadA)).permissions.canApprove, false, "not even for its own area's proposal");
      await assert.rejects(() => validateSupplierTaxpayer({ supplierId: supplierA._id, payload: { valid: true }, user: contabilidadA, req }), (error) => error.statusCode === 403 && /Only Treasury/.test(error.message));
      // Once reviewed it stays in Logística's list and Tesorería's oversight; Contabilidad still cannot open it.
      await Supplier.updateOne({ _id: supplierB._id }, { $set: { homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true, "jefeApproval.decision": "APPROVED" } });
      assert.equal((await getSupplierDetailPayload(supplierB._id, tesoreria)).permissions.canApprove, false);
      await assert.rejects(() => getSupplierDetailPayload(supplierB._id, contabilidadA), otherDepartment);
      await assert.rejects(() => assertStoredAssetAccess(resolveStoredAsset(`/uploads/suppliers/${supplierB._id}/ruc.pdf`), contabilidadA), (error) => error.statusCode === 403);
    });

    await t.test("Treasury verifies another department's bank account from its bank-review queue", async () => {
      const account = await SupplierBankAccount.create({ supplier: supplierB._id, bank: "BCP", currency: "PEN", accountType: "SAVINGS", accountHolderName: "Proveedor B", accountNumber: "19300000001", cci: "00219300000000000100", active: true, verificationStatus: "PENDING" });
      assert.ok(names(await listSuppliersPage({ bankReview: "pending", pageSize: 50 }, tesoreria)).includes("Proveedor B Logística SAC"));
      assert.ok(!names(await listSuppliersPage({ bankReview: "pending", pageSize: 50 }, contabilidadA)).includes("Proveedor B Logística SAC"), "only Treasury gets the cross-department bank queue");
      await assert.rejects(() => getSupplierDetailPayload(supplierB._id, contabilidadA), otherDepartment, "a pending bank account opens it to Treasury, not to Accounting");
      await assert.rejects(() => verifySupplierBankAccount({ supplierId: supplierB._id, accountId: account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MATCH", verificationSource: "Certificado bancario" }, user: contabilidadA, req }), (error) => error.statusCode === 403);
      await verifySupplierBankAccount({ supplierId: supplierB._id, accountId: account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MATCH", verificationSource: "Certificado bancario" }, user: tesoreria, req });
      assert.equal((await SupplierBankAccount.findById(account._id)).verificationStatus, "VERIFIED");
      assert.ok(!names(await listSuppliersPage({ pageSize: 50 }, contabilidadA)).includes("Proveedor B Logística SAC"), "it never joins Contabilidad's own list");
    });

    await t.test("Accounting opens the supplier of a submitted request from another department, never of a draft", async () => {
      const saludSupplier = await propose(requester, "20888000030", "Laboratorio Salud SAC");
      assert.deepEqual(saludSupplier.departments, ["Ciencias de la Salud"]);
      await FinancialRequest.collection.insertOne({ requester: requester._id, solicitor: requester._id, supplier: saludSupplier._id, requestNumber: "SOL-2099-00001", flowType: "A1", requestType: "OPEX", currency: "PEN", status: REQUEST_STATUS.DRAFT });
      await assert.rejects(() => getSupplierDetailPayload(saludSupplier._id, contabilidadA), otherDepartment, "a draft is not Accounting's work yet");
      await FinancialRequest.collection.updateOne({ supplier: saludSupplier._id }, { $set: { status: REQUEST_STATUS.PENDING_APPROVAL } });
      assert.equal((await getSupplierDetailPayload(saludSupplier._id, contabilidadA)).legalName, "Laboratorio Salud SAC");
      assert.ok(!names(await listSuppliersPage({ pageSize: 50 }, contabilidadA)).includes("Laboratorio Salud SAC"), "work access never adds it to the list");
    });

    await t.test("someone nobody gave an area is in General, apart from every other department", async () => {
      assert.equal(userDepartment(unassigned), "General");
      const general = await propose(unassigned, "20888000040", "Proveedor General SAC");
      assert.deepEqual(general.departments, ["General"]);
      assert.ok(!canSeeSupplier(general, contabilidadA));
      assert.ok(canSeeSupplier(general, tesoreria), "Tesorería sees every department");
      assert.ok(!names(await listSuppliersPage({ pageSize: 50 }, requester)).includes("Proveedor General SAC"));
    });

    await t.test("Treasury sees every department, filters one, and is the one asked to share", async () => {
      const all = names(await listSuppliersPage({ pageSize: 50 }, tesoreria));
      assert.ok(["Courier Compartido SAC", "Proveedor A Contabilidad SAC", "Proveedor B Logística SAC", "Laboratorio Salud SAC", "Proveedor General SAC"].every((name) => all.includes(name)));
      assert.deepEqual(names(await listSuppliersPage({ department: "Contabilidad", pageSize: 50 }, tesoreria)), ["Proveedor A Contabilidad SAC"]);
      assert.deepEqual(names(await listSuppliersPage({ department: "__shared", pageSize: 50 }, tesoreria)), ["Courier Compartido SAC"]);
      assert.equal((await listSuppliersPage({ pageSize: 50 }, tesoreria)).scope.scoped, false);
      assert.equal((await requestSupplierAccess({ supplierId: supplierB._id, user: contabilidadA, req })).requested, true);
      assert.ok(await Notification.exists({ user: tesoreria._id, type: "SUPPLIER_ACCESS_REQUEST" }));
      assert.ok(await Notification.exists({ user: tesoreriaB._id, type: "SUPPLIER_ACCESS_REQUEST" }));
      assert.ok(!(await Notification.exists({ user: admin._id, type: "SUPPLIER_ACCESS_REQUEST" })), "the Admin is not asked any more");
      assert.ok(!(await Notification.exists({ user: contabilidadB._id, type: "SUPPLIER_ACCESS_REQUEST" })), "Accounting cannot see other departments, so it is not asked");
      // Only Treasury chooses which areas see a supplier: not Accounting (even for its own list), not the Admin.
      await assert.rejects(() => updateSupplierDepartments({ supplierId: supplierA._id, departments: ["Contabilidad", "Logística"], user: contabilidadA, req }), (error) => error.statusCode === 403 && /Only Treasury/.test(error.message));
      await assert.rejects(() => updateSupplierDepartments({ supplierId: supplierB._id, departments: ["Logística", "Contabilidad"], user: admin, req }), (error) => error.statusCode === 403);
      await updateSupplierDepartments({ supplierId: supplierB._id, departments: ["Logística", "Contabilidad"], user: tesoreria, req });
      assert.ok(names(await listSuppliersPage({ pageSize: 50 }, contabilidadB)).includes("Proveedor B Logística SAC"));
      assert.deepEqual((await Supplier.findById(supplierB._id)).departments, ["Logística", "Contabilidad"]);
      assert.ok(canSeeSupplier(await Supplier.findById(legacy._id), contabilidadA), "older suppliers without a department stay shared");
    });

    await t.test("Treasury's own supplier is in Treasury's department unless Treasury names others", async () => {
      assert.deepEqual((await propose(tesoreria, "20888000050", "Proveedor Tesorería SAC")).departments, ["Tesorería"]);
      assert.deepEqual((await propose(tesoreria, "20888000051", "Proveedor Todas SAC", { departments: JSON.stringify([]) })).departments, []);
      assert.deepEqual((await propose(tesoreria, "20888000052", "Proveedor Dos Areas SAC", { departments: JSON.stringify(["Logística", "Contabilidad"]) })).departments, ["Logística", "Contabilidad"]);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

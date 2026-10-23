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

test("one shared supplier list per department: Tesorería, Contabilidad and the Admin", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_supplier_departments_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Promise.all([Counter.init(), Supplier.init(), SupplierBankAccount.init(), Notification.init(), AuditLog.init()]);
    const user = (name, role, area) => User.create({ name, email: `${name.toLowerCase().replace(/\W+/g, ".")}@test.local`, passwordHash: "unused", role, ...(area === undefined ? {} : { area }) });
    const tesoreriaA = await user("Tesoreria Uno", ROLES.TREASURY, "Tesorería");
    const tesoreriaB = await user("Tesoreria Dos", ROLES.TREASURY, "tesorería ");
    const contabilidad = await user("Contabilidad Uno", ROLES.ACCOUNTING, "Contabilidad");
    const admin = await user("Admin Uno", ROLES.ADMIN, "Tecnología de la Información");
    const requester = await user("Solicitante Salud", ROLES.SOLICITOR, "Ciencias de la Salud");
    const unassigned = await user("Sin Area", ROLES.SOLICITOR);
    const legacy = await Supplier.create({ rucDni: "20888000001", legalName: "Courier Compartido SAC", name: "Courier Compartido SAC", supplierCode: "PRV-0901", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true });
    const propose = (who, ruc, legalName, extra = {}) => createSupplierProposal({ payload: { rucDni: ruc, legalName, proposalJustification: "Servicio requerido por el área", ...extra }, files: {}, user: who, req }).then((result) => result.supplier);

    let supplierA;
    await t.test("a Tesorería employee's supplier is in Tesorería, without choosing it", async () => {
      supplierA = await propose(tesoreriaA, "20888000010", "Proveedor A Tesorería SAC", { departments: JSON.stringify(["Contabilidad"]) });
      assert.deepEqual(supplierA.departments, ["Tesorería"], "the department comes from the account; a chosen one is ignored");
      assert.ok(await AuditLog.exists({ entityId: supplierA._id, action: "CREATED_PENDING_VALIDATION", "newValues.departments": ["Tesorería"] }));
    });

    await t.test("every Tesorería employee sees it at once; Contabilidad does not", async () => {
      assert.equal(userDepartment(tesoreriaB), "tesorería", "areas match whatever their case or spacing");
      assert.deepEqual(names(await listSuppliersPage({ pageSize: 50 }, tesoreriaB)), ["Courier Compartido SAC", "Proveedor A Tesorería SAC"]);
      assert.equal((await getSupplierDetailPayload(supplierA._id, tesoreriaB)).legalName, "Proveedor A Tesorería SAC");
      const contabilidadList = await listSuppliersPage({ pageSize: 50 }, contabilidad);
      assert.deepEqual(names(contabilidadList), ["Courier Compartido SAC"]);
      assert.deepEqual(contabilidadList.scope, { scoped: true, department: "Contabilidad" });
      assert.equal((await listSuppliersPage({ search: "Proveedor A", pageSize: 50 }, contabilidad)).data.length, 0);
      assert.equal((await lookupSupplierByIdentifier("20888000010", contabilidad)).restricted, true);
      const search = await globalSearch("Proveedor A", contabilidad);
      assert.deepEqual(search.groups.find((group) => group.type === "suppliers").items, []);
      const own = await globalSearch("Proveedor A", tesoreriaB);
      assert.deepEqual(own.groups.find((group) => group.type === "suppliers").items.map((item) => item.title), ["Proveedor A Tesorería SAC"]);
    });

    await t.test("the RUC stays unique: another department is told it exists instead of duplicating it", async () => {
      await assert.rejects(() => propose(contabilidad, "20888000010", "Duplicado SAC"), (error) => error.code === ERROR_CODES.DUPLICATE_SUPPLIER && error.details.otherDepartment === true);
      await assert.rejects(() => propose(tesoreriaB, "20888000010", "Duplicado SAC"), (error) => error.code === ERROR_CODES.DUPLICATE_SUPPLIER && error.details.otherDepartment === false);
      assert.equal(await Supplier.countDocuments({ normalizedIdentifier: "20888000010" }), 1);
    });

    let supplierB;
    await t.test("Contabilidad's supplier is hidden from Tesorería, also through the API", async () => {
      supplierB = await propose(contabilidad, "20888000020", "Proveedor B Contabilidad SAC");
      assert.deepEqual(supplierB.departments, ["Contabilidad"]);
      assert.deepEqual(names(await listSuppliersPage({ pageSize: 50 }, contabilidad)), ["Courier Compartido SAC", "Proveedor B Contabilidad SAC"]);
      for (const treasurer of [tesoreriaA, tesoreriaB]) {
        assert.ok(!names(await listSuppliersPage({ pageSize: 50 }, treasurer)).includes("Proveedor B Contabilidad SAC"));
        await assert.rejects(() => getSupplierDetailPayload(supplierB._id, treasurer), otherDepartment);
      }
      await assert.rejects(() => getSupplierHomologationReadiness(supplierB._id, tesoreriaA), otherDepartment);
      await assert.rejects(() => updateSupplierProposal({ supplierId: supplierB._id, payload: { commercialName: "Cambio" }, files: {}, user: tesoreriaA, req }), otherDepartment);
      await assert.rejects(() => addSupplierBankAccount({ supplierId: supplierB._id, payload: { bank: "BCP", accountType: "SAVINGS", accountCurrency: "PEN", accountNumber: "19300000001", cci: "00219300000000000100", accountHolderName: "B" }, user: tesoreriaA, req }), (error) => error.statusCode === 403);
      await assert.rejects(() => assertStoredAssetAccess(resolveStoredAsset(`/uploads/suppliers/${supplierB._id}/ruc.pdf`), tesoreriaA), (error) => error.statusCode === 403);
      await assertStoredAssetAccess(resolveStoredAsset(`/uploads/suppliers/${supplierB._id}/ruc.pdf`), admin);
    });

    await t.test("Accounting still reviews every department's proposals, without them joining its list", async () => {
      const queue = await listSuppliersPage({ awaitingMyApproval: "true", pageSize: 50 }, contabilidad);
      assert.ok(names(queue).includes("Proveedor A Tesorería SAC"), "the review rule reaches every department");
      assert.equal(queue.scope.scoped, false);
      assert.equal((await getSupplierDetailPayload(supplierA._id, contabilidad)).permissions.canApprove, true);
      await assertStoredAssetAccess(resolveStoredAsset(`/uploads/suppliers/${supplierA._id}/ruc.pdf`), contabilidad);
      // Once reviewed (and with no bank account to verify), it is Tesorería's alone again.
      await Supplier.updateOne({ _id: supplierA._id }, { $set: { homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true, "jefeApproval.decision": "APPROVED" } });
      await assert.rejects(() => getSupplierDetailPayload(supplierA._id, contabilidad), otherDepartment);
      await assert.rejects(() => validateSupplierTaxpayer({ supplierId: supplierA._id, payload: { valid: true }, user: contabilidad, req }), otherDepartment);
      await assert.rejects(() => assertStoredAssetAccess(resolveStoredAsset(`/uploads/suppliers/${supplierA._id}/ruc.pdf`), contabilidad), (error) => error.statusCode === 403);
    });

    await t.test("Accounting verifies another department's bank account from its bank-review queue", async () => {
      const account = await SupplierBankAccount.create({ supplier: supplierA._id, bank: "BCP", currency: "PEN", accountType: "SAVINGS", accountHolderName: "Proveedor A", accountNumber: "19300000001", cci: "00219300000000000100", active: true, verificationStatus: "PENDING" });
      assert.ok(names(await listSuppliersPage({ bankReview: "pending", pageSize: 50 }, contabilidad)).includes("Proveedor A Tesorería SAC"));
      assert.ok(!names(await listSuppliersPage({ bankReview: "pending", pageSize: 50 }, tesoreriaA)).includes("Proveedor B Contabilidad SAC"), "only Accounting and the Admin get the cross-department queue");
      assert.ok(!names(await listSuppliersPage({ pageSize: 50 }, contabilidad)).includes("Proveedor A Tesorería SAC"), "it never joins Contabilidad's own list");
      await verifySupplierBankAccount({ supplierId: supplierA._id, accountId: account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MATCH", verificationSource: "Certificado bancario" }, user: contabilidad, req });
      assert.equal((await SupplierBankAccount.findById(account._id)).verificationStatus, "VERIFIED");
      await assert.rejects(() => getSupplierDetailPayload(supplierA._id, contabilidad), otherDepartment, "nothing left to verify: closed again");
    });

    await t.test("Treasury opens the supplier of a submitted request from another department, never of a draft", async () => {
      const saludSupplier = await propose(requester, "20888000030", "Laboratorio Salud SAC");
      assert.deepEqual(saludSupplier.departments, ["Ciencias de la Salud"]);
      await FinancialRequest.collection.insertOne({ requester: requester._id, solicitor: requester._id, supplier: saludSupplier._id, requestNumber: "SOL-2099-00001", flowType: "A1", requestType: "OPEX", currency: "PEN", status: REQUEST_STATUS.DRAFT });
      await assert.rejects(() => getSupplierDetailPayload(saludSupplier._id, tesoreriaA), otherDepartment, "a draft is not Treasury's work yet");
      await FinancialRequest.collection.updateOne({ supplier: saludSupplier._id }, { $set: { status: REQUEST_STATUS.PENDING_APPROVAL } });
      assert.equal((await getSupplierDetailPayload(saludSupplier._id, tesoreriaA)).legalName, "Laboratorio Salud SAC");
      assert.ok(!names(await listSuppliersPage({ pageSize: 50 }, tesoreriaA)).includes("Laboratorio Salud SAC"), "work access never adds it to the list");
    });

    await t.test("someone nobody gave an area is in General, apart from every other department", async () => {
      assert.equal(userDepartment(unassigned), "General");
      const general = await propose(unassigned, "20888000040", "Proveedor General SAC");
      assert.deepEqual(general.departments, ["General"]);
      assert.ok(!canSeeSupplier(general, tesoreriaA));
      assert.ok(!names(await listSuppliersPage({ pageSize: 50 }, requester)).includes("Proveedor General SAC"));
    });

    await t.test("the Admin sees every department, filters one, and is the one asked to share", async () => {
      const all = names(await listSuppliersPage({ pageSize: 50 }, admin));
      assert.ok(["Courier Compartido SAC", "Proveedor A Tesorería SAC", "Proveedor B Contabilidad SAC", "Laboratorio Salud SAC", "Proveedor General SAC"].every((name) => all.includes(name)));
      assert.deepEqual(names(await listSuppliersPage({ department: "Tesorería", pageSize: 50 }, admin)), ["Proveedor A Tesorería SAC"]);
      assert.deepEqual(names(await listSuppliersPage({ department: "__shared", pageSize: 50 }, admin)), ["Courier Compartido SAC"]);
      assert.equal((await listSuppliersPage({ pageSize: 50 }, admin)).scope.scoped, false);
      assert.equal((await requestSupplierAccess({ supplierId: supplierB._id, user: tesoreriaA, req })).requested, true);
      assert.ok(await Notification.exists({ user: admin._id, type: "SUPPLIER_ACCESS_REQUEST" }));
      assert.ok(!(await Notification.exists({ user: contabilidad._id, type: "SUPPLIER_ACCESS_REQUEST" })), "Accounting cannot see other departments, so it is not asked");
      await assert.rejects(() => updateSupplierDepartments({ supplierId: supplierA._id, departments: ["Contabilidad"], user: contabilidad, req }), otherDepartment);
      await updateSupplierDepartments({ supplierId: supplierB._id, departments: ["Contabilidad", "Tesorería"], user: admin, req });
      assert.ok(names(await listSuppliersPage({ pageSize: 50 }, tesoreriaB)).includes("Proveedor B Contabilidad SAC"));
      // Accounting may still share the suppliers of its own list.
      await updateSupplierDepartments({ supplierId: supplierB._id, departments: ["Contabilidad", "Tesorería", "General"], user: contabilidad, req });
      assert.deepEqual((await Supplier.findById(supplierB._id)).departments, ["Contabilidad", "Tesorería", "General"]);
      assert.ok(canSeeSupplier(await Supplier.findById(legacy._id), contabilidad), "older suppliers without a department stay shared");
    });

    await t.test("the Admin's own supplier is in the Admin's department unless the Admin names others", async () => {
      assert.deepEqual((await propose(admin, "20888000050", "Proveedor Admin SAC")).departments, ["Tecnología de la Información"]);
      assert.deepEqual((await propose(admin, "20888000051", "Proveedor Todas SAC", { departments: JSON.stringify([]) })).departments, []);
      assert.deepEqual((await propose(admin, "20888000052", "Proveedor Dos Areas SAC", { departments: JSON.stringify(["Tesorería", "Contabilidad"]) })).departments, ["Tesorería", "Contabilidad"]);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

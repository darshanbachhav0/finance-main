import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import CostCenter from "../src/models/CostCenter.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import SunatVoucher from "../src/models/SunatVoucher.js";
import Supplier from "../src/models/Supplier.js";
import User from "../src/models/User.js";
import { SEARCH_GROUP_LIMIT, globalSearch, normalizeSearchTerm, searchGroupsFor } from "../src/services/globalSearchService.js";
import { EXPENSE_NATURE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";

const group = (result, type) => result.groups.find((entry) => entry.type === type);
const ids = (result, type) => (group(result, type)?.items || []).map((item) => item.id);

test("global search: grouped records, strictly scoped to what the caller may open", { timeout: 60000 }, async (t) => {
  const databaseName = `erp_global_search_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`, { serverSelectionTimeoutMS: 5000 });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  try {
    const person = (name, dni, role) => User.create({ name, dni, email: `${dni}@search.test`, passwordHash: "unused", role, area: "Operations" });
    const admin = await person("Search Admin", "71000001", ROLES.ADMIN);
    const alice = await person("Alice Requester", "71000002", ROLES.SOLICITOR);
    const bruno = await person("Bruno Requester", "71000003", ROLES.SOLICITOR);
    const director = await person("Dora Director", "71000004", ROLES.AREA_DIRECTOR);
    const accounting = await person("Carla Accounting", "71000005", ROLES.ACCOUNTING);
    const treasury = await person("Tomas Treasury", "71000006", ROLES.TREASURY);
    const viewer = await person("Vera Viewer", "71000007", ROLES.MANAGEMENT_VIEWER);
    const center = await CostCenter.create({ code: "CC-SRCH", name: "Search", area: "Operations", active: true });
    const supplier = await Supplier.create({ identifierType: "RUC", rucDni: "20999999981", normalizedIdentifier: "20999999981", legalName: "Globex Search SAC", name: "Globex Search SAC", commercialName: "Globex", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true, supplierCode: "PRV-9981", paymentTerms: { option: "CREDIT_30", days: 30 } });

    const makeRequest = (owner, requestNumber, status, title) => FinancialRequest.create({
      requestNumber, title, requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.SERVICES,
      issueDate: "2026-09-10", accountingPeriod: "2026-09", currency: "PEN",
      solicitor: owner._id, requester: owner._id, status, supplier: supplier._id, description: "Global search scoping",
      lines: [{ costCenter: center._id, expenseType: new mongoose.Types.ObjectId(), netAmount: 100, igvAmount: 18, totalAmount: 118 }]
    });
    const aliceRequest = await makeRequest(alice, "REQ-2026-97001", REQUEST_STATUS.PENDING_APPROVAL, "Lab laptops");
    const brunoRequest = await makeRequest(bruno, "REQ-2026-97002", REQUEST_STATUS.PENDING_APPROVAL, "Cost (A+B) review");
    const brunoDraft = await makeRequest(bruno, "REQ-2026-97003", REQUEST_STATUS.DRAFT, "Draft stationery");
    const voucher = await SunatVoucher.create({ request: brunoRequest._id, flowType: "A1", supplier: supplier._id, rucIssuer: supplier.rucDni, voucherType: "FACTURA", series: "F001", number: "00000777", xmlAmount: 118, currency: "PEN" });
    const payable = await AccountsPayable.create({ request: brunoRequest._id, sunatVoucher: voucher._id, supplier: supplier._id, supplierIdentifierSnapshot: supplier.rucDni, voucher: { voucherType: "FACTURA", series: "F001", number: "00000777" }, accountingPeriod: "2026-09", originalAmount: 118, invoiceAmount: 118, invoicePenEquivalent: 118, currency: "PEN", exchangeRate: 1, penEquivalent: 118, outstandingAmount: 118 });

    await t.test("groups follow the list endpoints' role gates", () => {
      assert.deepEqual(searchGroupsFor(admin), ["requests", "suppliers", "vouchers", "payables", "users"]);
      assert.deepEqual(searchGroupsFor(alice), ["requests", "suppliers", "vouchers"]);
      assert.deepEqual(searchGroupsFor(director), ["requests", "vouchers"]);
      assert.deepEqual(searchGroupsFor(accounting), ["requests", "suppliers", "vouchers", "payables"]);
      assert.deepEqual(searchGroupsFor(treasury), ["requests", "suppliers", "vouchers"]);
      assert.deepEqual(searchGroupsFor(viewer), []);
      assert.deepEqual(searchGroupsFor({ ...admin.toObject(), active: false }), []);
    });

    await t.test("a Solicitor finds only their own requests and vouchers", async () => {
      const own = await globalSearch("REQ-2026-970", alice);
      assert.deepEqual(ids(own, "requests"), [String(aliceRequest._id)]);
      assert.equal(group(own, "requests").items[0].path, `/requests/${aliceRequest._id}`);
      assert.equal(group(own, "users"), undefined);
      assert.equal(group(own, "payables"), undefined);
      assert.deepEqual(ids(await globalSearch("Cost (A+B)", alice), "requests"), [], "another person's request stays hidden");
      assert.deepEqual(ids(await globalSearch("F001-777", alice), "vouchers"), [], "another person's voucher stays hidden");

      const brunoResult = await globalSearch("F001-00000777", bruno);
      assert.deepEqual(ids(brunoResult, "vouchers"), [String(voucher._id)], "series-number matches with or without leading zeros");
      assert.equal(group(brunoResult, "vouchers").items[0].path, `/requests/${brunoRequest._id}`);
      assert.deepEqual(ids(await globalSearch("REQ-2026-970", bruno), "requests").sort(), [String(brunoRequest._id), String(brunoDraft._id)].sort(), "own drafts are visible");
    });

    await t.test("a Director sees other people's requests but never their drafts", async () => {
      const result = await globalSearch("REQ-2026-970", director);
      assert.deepEqual(ids(result, "requests").sort(), [String(aliceRequest._id), String(brunoRequest._id)].sort());
      assert.deepEqual(ids(await globalSearch("20999999981", director), "vouchers"), [String(voucher._id)]);
    });

    await t.test("suppliers match legal/commercial name, RUC and PRV code and open the supplier record", async () => {
      for (const term of ["globex", "20999999981", "PRV-9981"]) {
        const result = await globalSearch(term, treasury);
        assert.deepEqual(ids(result, "suppliers"), [String(supplier._id)], term);
        assert.equal(group(result, "suppliers").items[0].path, `/suppliers?record=${supplier._id}`);
      }
      assert.ok(ids(await globalSearch("globex", alice), "requests").includes(String(aliceRequest._id)), "requests match their supplier");
    });

    await t.test("Accounting finds the CXP by voucher or request and opens it", async () => {
      for (const term of ["F001-777", "REQ-2026-97002"]) {
        const result = await globalSearch(term, accounting);
        assert.deepEqual(ids(result, "payables"), [String(payable._id)], term);
        assert.equal(group(result, "payables").items[0].path, `/accounting/payables?record=${payable._id}`);
      }
      assert.equal(group(await globalSearch("F001-777", treasury), "payables"), undefined);
    });

    await t.test("only Admin finds people, by name, DNI or email", async () => {
      for (const term of ["Alice Req", "71000002", "71000002@search"]) {
        const result = await globalSearch(term, admin);
        assert.deepEqual(ids(result, "users"), [String(alice._id)], term);
      }
      assert.equal(group(await globalSearch("71000002", accounting), "users"), undefined);
    });

    await t.test("the term is escaped: regex syntax is matched literally", async () => {
      assert.deepEqual(ids(await globalSearch("(A+B)", admin), "requests"), [String(brunoRequest._id)]);
      for (const term of [".*", "^R", "REQ.2026", "[a-z]+", "((", "\\\\"]) {
        const result = await globalSearch(term, admin);
        for (const entry of result.groups) assert.deepEqual(entry.items, [], `${term} in ${entry.type}`);
      }
    });

    await t.test("short, blank and oversized terms are handled", async () => {
      assert.deepEqual((await globalSearch("R", admin)).groups, []);
      assert.deepEqual((await globalSearch("   ", admin)).groups, []);
      assert.equal(normalizeSearchTerm("x".repeat(500)).length, 80);
      for (const entry of (await globalSearch("re", admin)).groups) assert.ok(entry.items.length <= SEARCH_GROUP_LIMIT);
    });

    await t.test("over HTTP: scoped results, and ManagementViewer is refused", async () => {
      const token = (user) => jwt.sign({ id: user._id }, process.env.JWT_SECRET || "dev_secret_change_me");
      const get = (term, user) => fetch(`http://127.0.0.1:${server.address().port}/api/search?q=${encodeURIComponent(term)}`, { headers: { Authorization: `Bearer ${token(user)}` } });
      const viewerResponse = await get("REQ-2026", viewer);
      assert.equal(viewerResponse.status, 403);
      const aliceResponse = await get("REQ-2026-970", alice);
      assert.equal(aliceResponse.status, 200);
      const body = await aliceResponse.json();
      assert.deepEqual(ids(body, "requests"), [String(aliceRequest._id)]);
      const adminBody = await (await get("Bruno", admin)).json();
      assert.deepEqual(ids(adminBody, "users"), [String(bruno._id)]);
      assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/search?q=REQ`)).status, 401);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

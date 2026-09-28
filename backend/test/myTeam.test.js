import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import CostCenter from "../src/models/CostCenter.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Supplier from "../src/models/Supplier.js";
import User from "../src/models/User.js";
import { listMyTeam } from "../src/controllers/userController.js";
import { sessionUser } from "../src/controllers/authController.js";
import { listRequestsPage, teamMemberIds } from "../src/services/requestService.js";
import { EXPENSE_NATURE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";

function mockRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

test("My Team: hierarchy traversal, scoped request listing and the roster endpoint", { timeout: 60000 }, async (t) => {
  const databaseName = `erp_my_team_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    const center = await CostCenter.create({ code: "CC-TEAM", name: "Team", area: "Operations", active: true });
    const director = await User.create({ name: "Director", email: "team.director@test.local", passwordHash: "unused", role: ROLES.AREA_DIRECTOR, area: "Operations" });
    const supervisorA = await User.create({ name: "Supervisor A", email: "team.supA@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", jefe: director._id });
    const supervisorB = await User.create({ name: "Supervisor B", email: "team.supB@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", jefe: director._id });
    const reportA1 = await User.create({ name: "Report A1", email: "team.a1@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", costCenter: center._id, jefe: supervisorA._id });
    const outsider = await User.create({ name: "Outsider", email: "team.outsider@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations" });
    const supplier = await Supplier.create({ identifierType: "RUC", rucDni: "20999999994", normalizedIdentifier: "20999999994", legalName: "Team Test Supplier SAC", name: "Team Test Supplier SAC", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true, supplierCode: "PRV-9794", paymentTerms: { option: "CREDIT_30", days: 30 } });

    await t.test("teamMemberIds walks the jefe graph across every level", async () => {
      const ids = (await teamMemberIds(director._id)).map(String).sort();
      assert.deepEqual(ids, [String(supervisorA._id), String(supervisorB._id), String(reportA1._id)].sort());
      assert.deepEqual(await teamMemberIds(supervisorA._id), [String(reportA1._id)]);
      assert.deepEqual(await teamMemberIds(outsider._id), []);
    });

    async function makeRequest(requester, number) {
      return FinancialRequest.create({
        requestNumber: number, requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.SERVICES,
        issueDate: "2026-09-10", accountingPeriod: "2026-09", currency: "PEN",
        solicitor: requester._id, requester: requester._id, status: REQUEST_STATUS.PENDING_APPROVAL,
        supplier: supplier._id, description: "My Team scoping test",
        lines: [{ costCenter: center._id, expenseType: new mongoose.Types.ObjectId(), netAmount: 100, igvAmount: 18, totalAmount: 118 }]
      });
    }
    const teamRequest = await makeRequest(reportA1, "REQ-2026-96001");
    const outsiderRequest = await makeRequest(outsider, "REQ-2026-96002");

    await t.test("listRequestsPage with teamScope only returns requests from the manager's hierarchy", async () => {
      const page = await listRequestsPage({ teamScope: true }, director);
      const ids = page.data.map((row) => String(row._id));
      assert.ok(ids.includes(String(teamRequest._id)));
      assert.ok(!ids.includes(String(outsiderRequest._id)));
    });

    await t.test("ownScope keeps a report's request out of the jefe's My Requests, even when the jefe approves it", async () => {
      await FinancialRequest.updateOne({ _id: teamRequest._id }, { $set: { approvalRouteSnapshot: [{ approverUser: supervisorA._id }] } });
      const ownRequest = await makeRequest(supervisorA, "REQ-2026-96003");
      const jefeOwn = (await listRequestsPage({ ownScope: "true" }, supervisorA)).data.map((row) => String(row._id));
      assert.deepEqual(jefeOwn, [String(ownRequest._id)]);
      const reportOwn = (await listRequestsPage({ ownScope: "true" }, reportA1)).data.map((row) => String(row._id));
      assert.deepEqual(reportOwn, [String(teamRequest._id)]);
      const jefeTeam = (await listRequestsPage({ teamScope: "true" }, supervisorA)).data.map((row) => String(row._id));
      assert.deepEqual(jefeTeam, [String(teamRequest._id)]);
      await FinancialRequest.deleteOne({ _id: ownRequest._id });
    });

    await t.test("teamScope for a manager with no reports returns nothing, not everything", async () => {
      const page = await listRequestsPage({ teamScope: true }, outsider);
      assert.equal(page.data.length, 0);
    });

    await t.test("GET /users/my-team returns the roster with CeCo and request counts, scoped to the caller", async () => {
      const res = mockRes();
      await listMyTeam({ user: director }, res);
      const names = res.body.data.map((row) => row.name).sort();
      assert.deepEqual(names, ["Supervisor A", "Supervisor B"], "only direct reports, not the whole downstream tree");

      const resA = mockRes();
      await listMyTeam({ user: supervisorA }, resA);
      assert.equal(resA.body.data.length, 1);
      assert.equal(resA.body.data[0].name, "Report A1");
      assert.equal(resA.body.data[0].costCenter.code, "CC-TEAM");
      assert.equal(resA.body.data[0].requestCounts.total, 1);
      assert.equal(resA.body.data[0].requestCounts.active, 1);

      const resOutsider = mockRes();
      let denied;
      await listMyTeam({ user: outsider }, resOutsider, error => { denied = error; });
      assert.equal(denied.statusCode, 403);
      assert.equal(resOutsider.body, undefined);
    });
    await t.test("session capability follows active reports, regardless of role, without exposing passwords", async () => {
      assert.equal((await sessionUser(supervisorA)).hasTeam, true);
      assert.equal((await sessionUser(director)).hasTeam, true);
      assert.equal((await sessionUser(outsider)).hasTeam, false);
      assert.equal((await sessionUser(director)).passwordHash, undefined);
      await User.updateOne({_id:reportA1._id},{$set:{active:false}});
      assert.equal((await sessionUser(supervisorA)).hasTeam, false);
      await User.updateOne({_id:reportA1._id},{$set:{active:true,jefe:outsider._id}});
      assert.equal((await sessionUser(supervisorA)).hasTeam, false);
      assert.equal((await sessionUser(outsider)).hasTeam, true);
      await User.updateOne({_id:supervisorA._id},{$set:{role:ROLES.ADMIN}});
      assert.equal((await sessionUser(await User.findById(supervisorA._id))).hasTeam, false);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

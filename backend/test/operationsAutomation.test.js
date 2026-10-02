import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import fs from 'node:fs/promises';
import path from 'node:path';
import app from '../src/app.js';
import User from '../src/models/User.js';
import FinancialRequest from '../src/models/FinancialRequest.js';
import AccountsPayable from '../src/models/AccountsPayable.js';
import WorkDraft from '../src/models/WorkDraft.js';
import Notification from '../src/models/Notification.js';
import AccountingPeriod from '../src/models/AccountingPeriod.js';
import DirectPaymentEligibilityRule from '../src/models/DirectPaymentEligibilityRule.js';
import { uploadRoot } from '../src/services/storageService.js';
import { archiveAsset, readAsset, assetKey } from '../src/services/durableAssetService.js';
import { recurringDraftValue, createRecurringTemplate, generateDueDrafts, RecurringTemplate } from '../src/services/recurringDraftService.js';
import { submissionReadiness } from '../src/services/operationsReadinessService.js';
import { monthEndReadiness } from '../src/services/operationsWorkspaceService.js';
import { parseStatementCsv, matchingPayables, statementRowKey, importStatement, confirmStatementMatch } from '../src/services/reconciliationSuggestionService.js';
import { previewPaymentBatch } from '../src/services/treasuryService.js';
import { notifyUser } from '../src/services/notificationService.js';

const id = () => new mongoose.Types.ObjectId();
test('automation preparation: CSV validation, exact matches and clean draft evidence', () => {
  const [row] = parseStatementCsv('date,reference,currency,amount\n2026-10-01,OP-1,PEN,118.00');
  assert.equal(row.amount, 118);
  assert.throws(() => parseStatementCsv('date,reference,currency,amount\n2026-02-30,OP-1,PEN,118'), /Correct statement row/);
  assert.throws(() => parseStatementCsv('date,reference,currency,amount\n2026-10-01,OP-1,PEN,118\n2026-10-01,OP-1,PEN,118.00'), /Duplicate/);
  assert.throws(() => parseStatementCsv('date,reference,currency,amount\n2026-10-01,OP-1,PEN,99999999999999999999999999'), /Correct statement row/);
  const ap = { _id: 'ap', currency: 'PEN', request: { _id: 'req', payment: { confirmations: [{ accountsPayable: 'ap', amount: 118, operationNumber: 'OP-1', paidAt: '2026-10-01' }] } } };
  assert.equal(matchingPayables(row, [ap]).length, 1);
  assert.equal(matchingPayables({ ...row, amount: 119 }, [ap]).length, 0);
  assert.equal(matchingPayables({ ...row, currency: 'USD' }, [ap]).length, 0);
  assert.equal(matchingPayables(row, [ap, { ...ap }]).length, 2);
  const draft = recurringDraftValue({ flowType: 'A1', requestType: 'OPEX', status: 'PAGADO', payment: { confirmations: ['evidence'] }, attachments: ['xml'], approvalRouteSnapshot: ['approved'], lines: [{ quantity: 1, unitPrice: 118, totalAmount: 118, priceIncludesIGV: true, costCenter: 'cc' }] }, '2026-11');
  assert.equal(draft.form.accountingPeriod, '2026-11');
  assert.equal(draft.opexFrequency, 'MONTHLY_RECURRING');
  assert.equal(draft.form.status, undefined);
  assert.equal(draft.payment, undefined);
  assert.deepEqual(draft.files, {});
  assert.deepEqual(draft.quotations, []);
  assert.equal(draft.lines[0].costCenter, 'cc');
});

test('operations API, durable evidence, recurring idempotency and statement claims', { timeout: 60000 }, async t => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/erp_automations_${process.pid}_${Date.now()}`);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.on('listening', resolve));
  const previousDurable = process.env.DURABLE_ASSETS;
  const file = path.join(uploadRoot, 'requests', String(id()), 'automation-test.xml');
  try {
    const [owner, other, treasury, admin] = await User.create(['Solicitor', 'Solicitor', 'Treasury', 'Admin'].map((role, i) => ({ name: `Automation ${i}`, dni: `7900000${i}`, passwordHash: 'unused', role, area: 'IT', active: true })));
    const call = async (url, user = owner, method = 'GET', body) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/operations${url}`, { method, headers: { Authorization: `Bearer ${jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'dev_secret_change_me')}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    await t.test('private role endpoints and malformed statement evidence', async () => {
      assert.equal((await call('/health')).status, 403);
      assert.equal((await call('/month-end?period=2026-10')).status, 403);
      assert.equal((await call('/payments', owner, 'POST', { payableIds: [id()], currency: 'PEN' })).status, 403);
      assert.equal((await call('/statements', owner, 'POST', { csv: 'bad' })).status, 403);
      assert.equal((await call('/statements', treasury, 'POST', { csv: 'bad' })).status, 422);
      assert.equal((await call('/health', admin)).status, 200);
    });
    await t.test('cloud archive survives local deletion, idempotent copies, checksum verification', async () => {
      process.env.DURABLE_ASSETS = 'true';
      await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, '<Invoice>original</Invoice>');
      await archiveAsset(file); await archiveAsset(file);
      assert.equal(await mongoose.connection.db.collection('protectedAssets.files').countDocuments({ filename: assetKey(file) }), 1);
      await fs.unlink(file);
      assert.equal(await readAsset(file, 'utf8'), '<Invoice>original</Invoice>');
      await mongoose.connection.db.collection('protectedAssets.files').updateOne({ filename: assetKey(file) }, { $set: { 'metadata.checksum': 'corrupted' } });
      await assert.rejects(readAsset(file), /checksum mismatch/);
      assert.throws(() => assetKey('C:/elsewhere/private.txt'), /outside protected/);
      process.env.DURABLE_ASSETS = 'false';
    });
    await t.test('submission collects multiple issues and Track B preview honors area and amount', async () => {
      const base = { flowType: 'B', requestType: 'OPEX', expenseNature: 'SERVICES', issueDate: '2026-10-01', accountingPeriod: '2026-10', currency: 'PEN', lines: [{ quantity: 1, unitPrice: 600, priceIncludesIGV: true }] };
      const before = await submissionReadiness(base, owner);
      assert.ok(before.issues.length >= 3);
      assert.ok(before.issues.some(i => i.message.includes('Track B')));
      await DirectPaymentEligibilityRule.create({ name: 'IT only', area: 'IT', expenseNature: 'SERVICES', maxAmount: 700 });
      assert.equal((await submissionReadiness(base, owner)).issues.some(i => i.message.includes('Track B')), false);
      assert.equal((await submissionReadiness({ ...base, requesterArea: 'IT' }, { ...owner.toObject(), area: 'Other' })).issues.some(i => i.message.includes('Track B')), true);
      assert.equal((await submissionReadiness({ ...base, lines: [{ quantity: 2, unitPrice: 600, priceIncludesIGV: true }] }, owner)).issues.some(i => i.message.includes('Track B')), true);
      assert.equal(await FinancialRequest.countDocuments(), 0);
    });
    const source = id();
    await FinancialRequest.collection.insertOne({ _id: source, requester: owner._id, title: 'Monthly service', requestNumber: 'AUTOMATION-1', requestType: 'OPEX', flowType: 'B', status: 'CERRADO', lines: [] });
    await t.test('readiness enforces request visibility and terminal actions', async () => {
      assert.equal((await call(`/requests/${source}`, other)).status, 403);
      const own = await call(`/requests/${source}`, owner); assert.equal(own.status, 200); assert.deepEqual(own.body.data.issues, []);
    });
    await t.test('recurring drafts enforce owner, remain private and generate once', async () => {
      await assert.rejects(createRecurringTemplate({ source, nextMonth: '2026-10' }, other), /own requests/);
      const template = await createRecurringTemplate({ source, nextMonth: '2000-01' }, owner);
      await generateDueDrafts(); await generateDueDrafts();
      assert.equal(await WorkDraft.countDocuments({ owner: owner._id }), 1);
      assert.equal(await FinancialRequest.countDocuments(), 1);
      assert.equal(await Notification.countDocuments({ eventKey: { $regex: '^recurring:' } }), 1);
      assert.ok((await RecurringTemplate.findById(template._id)).nextMonth > '2000-01');
      assert.equal((await call(`/templates/${template._id}/pause`, other, 'POST')).status, 404);
      assert.equal((await call(`/templates/${template._id}/pause`, owner, 'POST')).status, 200);
    });
    await t.test('worker alerts preserve read state', async () => {
      const args = { once: true, userId: owner._id, eventKey: 'automation-alert', type: 'REVIEW', title: 'Review', message: 'Review evidence.' };
      const notification = await notifyUser(args);
      await Notification.updateOne({ _id: notification._id }, { $set: { readAt: new Date() } });
      await notifyUser(args); assert.ok((await Notification.findById(notification._id)).readAt);
    });
    await t.test('payment preflight lists every invalid payable without scheduling', async () => {
      const result = await previewPaymentBatch({ payableIds: [String(id()), String(id())], currency: 'PEN' });
      assert.equal(result.ready, false); assert.ok(result.issues.length >= 3);
      assert.equal(await AccountsPayable.countDocuments(), 0);
    });
    await t.test('month-end requires open period and accounts for unposted obligations', async () => {
      await AccountingPeriod.create({ period: '2026-10', status: 'OPEN' });
      assert.equal((await monthEndReadiness('2026-10')).ready, true);
      await AccountsPayable.collection.insertOne({ request: source, status: 'OPEN', accountingPeriod: '2026-10' });
      const check = await monthEndReadiness('2026-10'); assert.equal(check.ready, false); assert.equal(check.counts.incompletePayables, 1);
    });
    await t.test('statement evidence cannot be reused after a claim, even on another import', async () => {
      const csv = 'date,reference,currency,amount\n2026-10-01,OP-1,PEN,118';
      const statement = await importStatement(csv, treasury);
      const row = parseStatementCsv(csv)[0];
      await mongoose.connection.db.collection('statementclaims').insertOne({ _id: statementRowKey(row), outcome: 'RECONCILED' });
      const repeated = await importStatement(csv, treasury);
      assert.equal(repeated.rows[0].claimed, true); assert.deepEqual(repeated.rows[0].candidates, []);
      await assert.rejects(confirmStatementMatch({ id: statement.id, rowIndex: 0, payableId: String(id()), user: treasury }), /already claimed/);
      await assert.rejects(confirmStatementMatch({ id: statement.id, rowIndex: 0, payableId: String(id()), user: other }), /not found/);
    });
  } finally {
    if (previousDurable === undefined) delete process.env.DURABLE_ASSETS; else process.env.DURABLE_ASSETS = previousDurable;
    await fs.rm(file, { force: true });
    await new Promise(resolve => server.close(resolve)); await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  }
});

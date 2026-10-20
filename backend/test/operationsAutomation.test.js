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
import Notification from '../src/models/Notification.js';
import { uploadRoot } from '../src/services/storageService.js';
import { archiveAsset, readAsset, assetKey } from '../src/services/durableAssetService.js';
import { submissionReadiness } from '../src/services/operationsReadinessService.js';
import { previewPaymentBatch } from '../src/services/treasuryService.js';
import { notifyUser } from '../src/services/notificationService.js';

const id = () => new mongoose.Types.ObjectId();
test('operations API and durable evidence', { timeout: 60000 }, async t => {
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
    await t.test('private role endpoints; the old Work review endpoints are gone', async () => {
      assert.equal((await call('/payments', owner, 'POST', { payableIds: [id()], currency: 'PEN' })).status, 403);
      assert.equal((await call('/payments', treasury, 'POST', { payableIds: [id()], currency: 'PEN' })).status, 200);
      for (const [url, user, method] of [['/queue', owner], ['/suppliers', owner], ['/health', admin], ['/month-end?period=2026-10', admin], ['/templates', owner], ['/statements', treasury, 'POST']]) {
        assert.equal((await call(url, user, method || 'GET', method ? { csv: '' } : undefined)).status, 404, url);
      }
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
    await t.test('submission collects multiple issues and never refuses Track B for its area or amount', async () => {
      const base = { flowType: 'B', requestType: 'OPEX', expenseNature: 'SERVICES', issueDate: '2026-10-01', accountingPeriod: '2026-10', currency: 'PEN', lines: [{ quantity: 1, unitPrice: 600, priceIncludesIGV: true }] };
      const before = await submissionReadiness(base, owner);
      assert.ok(before.issues.length >= 2);
      assert.equal(before.issues.some(i => i.message.includes('Track B')), false);
      assert.equal((await submissionReadiness({ ...base, requesterArea: 'IT' }, { ...owner.toObject(), area: 'Other' })).issues.some(i => i.message.includes('Track B')), false);
      assert.equal((await submissionReadiness({ ...base, lines: [{ quantity: 200, unitPrice: 600, priceIncludesIGV: true }] }, owner)).issues.some(i => i.message.includes('Track B')), false);
      assert.equal(await FinancialRequest.countDocuments(), 0);
    });
    const source = id();
    await FinancialRequest.collection.insertOne({ _id: source, requester: owner._id, title: 'Monthly service', requestNumber: 'AUTOMATION-1', requestType: 'OPEX', flowType: 'B', status: 'CERRADO', lines: [] });
    await t.test('readiness enforces request visibility and terminal actions', async () => {
      assert.equal((await call(`/requests/${source}`, other)).status, 403);
      const own = await call(`/requests/${source}`, owner); assert.equal(own.status, 200); assert.deepEqual(own.body.data.issues, []);
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
  } finally {
    if (previousDurable === undefined) delete process.env.DURABLE_ASSETS; else process.env.DURABLE_ASSETS = previousDurable;
    await fs.rm(file, { force: true });
    await new Promise(resolve => server.close(resolve)); await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  }
});

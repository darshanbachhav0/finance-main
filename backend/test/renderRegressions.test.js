import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { publicRequestPayload } from '../src/services/requestService.js';
import { encryptDraft, decryptDraft } from '../src/services/workDraftService.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

test('lean request and Treasury payloads retain string IDs and leave source evidence intact', () => {
  const id = new mongoose.Types.ObjectId();
  const source = { _id: id, requestId: id, status: 'PAGADO_CERRADO',
    supplier: { _id: id }, attachments: [{ _id: id, path: '/private/evidence.pdf', url: '/uploads/evidence.pdf' }],
    createdAt: new Date('2026-09-21T00:00:00Z') };
  const result = JSON.parse(JSON.stringify(publicRequestPayload(source)));
  assert.equal(result._id, String(id));
  assert.equal(result.requestId, String(id));
  assert.equal(result.supplier._id, String(id));
  assert.equal(result.attachments[0]._id, String(id));
  assert.equal(result.attachments[0].path, undefined);
  assert.equal(result.status, 'CERRADO');
  assert.equal(result.createdAt, source.createdAt.toISOString());
  assert.equal(source.status, 'PAGADO_CERRADO');
  assert.equal(source.attachments[0].path, '/private/evidence.pdf');
});

test('malformed request links return validation errors instead of HTTP 500', () => {
  const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  errorHandler(new mongoose.Error.CastError('ObjectId', '[object Object]', '_id'), {}, response, () => {});
  assert.equal(response.code, 422);
  assert.equal(response.body.code, 'VALIDATION_ERROR');
  assert.equal(response.body.stack, undefined);
});

test('migrated drafts and attachments support original keys without losing new-key encryption', () => {
  const original = process.env.DRAFT_ENCRYPTION_KEY, legacy = process.env.DRAFT_LEGACY_ENCRYPTION_KEY;
  try {
    process.env.DRAFT_ENCRYPTION_KEY = 'test-original-local-key';
    delete process.env.DRAFT_LEGACY_ENCRYPTION_KEY;
    const saved = encryptDraft(Buffer.from('private saved work'));
    const originalBytes = Buffer.from(saved);
    process.env.DRAFT_ENCRYPTION_KEY = 'test-new-render-key';
    assert.throws(() => decryptDraft(saved), error => error.statusCode === 409 && error.code === 'DRAFT_KEY_UNAVAILABLE');
    process.env.DRAFT_LEGACY_ENCRYPTION_KEY = 'test-original-local-key';
    assert.equal(decryptDraft(saved).toString(), 'private saved work');
    assert.deepEqual(saved, originalBytes);
    const fresh = encryptDraft(Buffer.from('new work'));
    delete process.env.DRAFT_LEGACY_ENCRYPTION_KEY;
    assert.equal(decryptDraft(fresh).toString(), 'new work');
    assert.throws(() => decryptDraft(Buffer.alloc(3)), /saved draft cannot be decrypted/);
  } finally {
    for (const [name, value] of [['DRAFT_ENCRYPTION_KEY', original], ['DRAFT_LEGACY_ENCRYPTION_KEY', legacy]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

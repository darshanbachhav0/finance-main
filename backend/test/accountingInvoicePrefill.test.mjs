import assert from 'node:assert/strict';
import test from 'node:test';
import { initialAccountingFiscalForm, requestInvoiceEvidence, splitFiscalInvoiceNumber, verifiedInvoiceConflicts } from '../../shared/accountingInvoicePrefill.mjs';

test('Accounting prepopulates submitted B invoice identity instead of request date', () => {
  const request = { issueDate: '2026-10-29', invoiceDetails: { status: 'ATTACHED', number: 'FF01-3041', documentType: '01', issueDate: '2026-10-01' }, lines: [{ expenseType: { _id: '630001' } }] };
  const fields = initialAccountingFiscalForm(request, '2026-10-29');
  assert.equal(fields.series, 'FF01');
  assert.equal(fields.number, '3041');
  assert.equal(fields.documentDate, '2026-10-01');
  assert.equal(fields.fiscalPeriod, '2026-10');
  assert.equal(fields.accountingAccount, '630001');
  assert.equal(fields.dueDate, '');
});

test('Validated XML takes precedence over manually transcribed invoice', () => {
  const request = { invoiceDetails: { status: 'ATTACHED', number: '3434-5245', issueDate: '2026-10-02' }, xmlValidation: { validated: true, data: { invoiceNumber: 'FF01-00003041', issueDate: '2026-10-01', documentTypeCode: '01' } } };
  assert.deepEqual({ series: requestInvoiceEvidence(request).series, number: requestInvoiceEvidence(request).number }, { series: 'FF01', number: '00003041' });
  assert.equal(verifiedInvoiceConflicts(request.xmlValidation, { series: '3434', number: '3434-5245', documentDate: '2026-10-01', documentType: 'FACTURA' }).length, 1);
});

test('Zero-padded invoice correlative is equivalent for matching', () => {
  const metadata = { validated: true, data: { invoiceNumber: 'F001-00001234', issueDate: '2026-10-01', voucherType: 'FACTURA' } };
  assert.deepEqual(verifiedInvoiceConflicts(metadata, { series: 'F001', number: '1234', documentDate: '2026-10-01', documentType: 'FACTURA' }), []);
});

test('Document date and type conflicts are rejected for validated sources', () => {
  const evidence = { validated: true, data: { invoiceNumber: 'F001-99', issueDate: '2026-10-01', documentTypeCode: '01' } };
  assert.equal(verifiedInvoiceConflicts(evidence, { series: 'F001', number: '99', documentDate: '2026-10-02', documentType: 'BOLETA' }).length, 2);
});

test('No verified metadata does not invent a document identity', () => {
  assert.deepEqual(splitFiscalInvoiceNumber(''), { series: '', number: '' });
  const fields = initialAccountingFiscalForm({ issueDate: '2026-10-29' }, '2026-10-29');
  assert.equal(fields.documentDate, '');
  assert.equal(fields.series, '');
  assert.equal(fields.number, '');
  assert.deepEqual(verifiedInvoiceConflicts({}, fields), []);
});

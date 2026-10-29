// Use the invoice already supplied with the request. Accounting confirms these values;
// the stored XML/PDF and SUNAT checks remain authoritative before posting.
const voucherTypes = {
  '01': 'FACTURA', '1': 'FACTURA', FACTURA: 'FACTURA',
  '03': 'BOLETA', '3': 'BOLETA', BOLETA: 'BOLETA',
  '02': 'RXH', '2': 'RXH', RXH: 'RXH'
};

export function fiscalDateKey(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : '';
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

export function splitFiscalInvoiceNumber(value) {
  const cleaned = String(value || '').trim().toUpperCase().replace(/\s/g, '');
  const match = cleaned.match(/^([^-]+)-([^-]+)$/);
  return match ? { series: match[1], number: match[2] } : { series: '', number: cleaned };
}

export function fiscalVoucherType(value) {
  const token = String(value || '').trim().toUpperCase();
  return voucherTypes[token] || 'FACTURA';
}

export function requestInvoiceEvidence(request = {}) {
  const verified = request.xmlValidation?.validated === true ? request.xmlValidation?.data : null;
  const attached = request.invoiceDetails?.status === 'ATTACHED' ? request.invoiceDetails : null;
  // Verified XML/PDF fields take precedence over requester's transcription.
  const number = verified?.invoiceNumber || attached?.number || '';
  return {
    ...splitFiscalInvoiceNumber(number),
    documentType: fiscalVoucherType(verified?.voucherType || verified?.documentTypeCode || attached?.documentType),
    documentDate: fiscalDateKey(verified?.issueDate || attached?.issueDate),
    source: verified?.invoiceNumber ? 'verified' : attached ? 'request' : 'missing',
    supplierRuc: verified?.ruc || attached?.ruc || '',
    totalAmount: verified?.totalAmount ?? attached?.totalAmount
  };
}

export function initialAccountingFiscalForm(request, today) {
  const invoice = requestInvoiceEvidence(request);
  const documentDate = invoice.documentDate;
  const expenseType = request?.lines?.[0]?.expenseType;
  return {
    documentType: invoice.documentType,
    series: invoice.series,
    number: invoice.number,
    documentDate,
    accountingDate: today,
    fiscalPeriod: documentDate.slice(0, 7) || today.slice(0, 7),
    // A due-date override is intentionally blank: supplier/OC contractual terms
    // take precedence over a suggested payment date entered on the request.
    dueDate: '',
    accountingAccount: String(expenseType?._id || expenseType || ''),
    igvDeductible: invoice.documentType !== 'BOLETA',
    spotCategoryCode: '',
    subaccountNumber: '',
    comments: ''
  };
}

export function verifiedInvoiceConflicts(xmlValidation, fiscal) {
  if (xmlValidation?.validated !== true || !xmlValidation?.data) return [];
  const data = xmlValidation.data;
  const errors = [];
  if (data.invoiceNumber) {
    const expected = splitFiscalInvoiceNumber(data.invoiceNumber);
    const actualSeries = String(fiscal.series || '').trim().toUpperCase();
    const actualNumber = String(fiscal.number || '').trim().replace(/^0+(?=\d)/, '');
    const expectedNumber = expected.number.replace(/^0+(?=\d)/, '');
    if (expected.series && expected.series !== actualSeries || expectedNumber !== actualNumber) {
      errors.push('Invoice series/number differs from the validated XML/PDF. Reopen the request invoice evidence before posting.');
    }
  }
  if (data.issueDate && fiscalDateKey(data.issueDate) !== fiscalDateKey(fiscal.documentDate)) {
    errors.push('Invoice issue date differs from the validated XML/PDF.');
  }
  if ((data.voucherType || data.documentTypeCode) && fiscalVoucherType(data.voucherType || data.documentTypeCode) !== fiscalVoucherType(fiscal.voucherType || fiscal.documentType)) {
    errors.push('Invoice document type differs from the validated XML/PDF.');
  }
  return errors;
}

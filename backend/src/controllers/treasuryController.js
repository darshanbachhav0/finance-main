import { asyncHandler } from "../middleware/asyncHandler.js";
import { publicRequestPayload } from "../services/requestService.js";
import {
  confirmTreasuryPayment,
  confirmTreasuryPayable,
  generatePaymentBatch,
  getEligiblePaymentDestinations,
  getEligiblePayablePaymentDestinations,
  listPaymentBatches,
  listPaymentConfirmationQueue,
  listBouncedPayments,
  listReconciliationQueue,
  listTreasuryQueue,
  markPaymentBounced,
  reprogramBouncedPayment,
  reconcilePayment,
  schedulePayments
} from "../services/treasuryService.js";

export const paymentQueue = asyncHandler(async (req, res) => res.json(await listTreasuryQueue(req.query)));
export const listBankFiles = asyncHandler(async (req, res) => res.json(await listPaymentBatches(req.query)));
export const paymentConfirmationQueue = asyncHandler(async (req, res) => res.json(await listPaymentConfirmationQueue(req.query)));
export const bouncedPaymentQueue = asyncHandler(async (req, res) => res.json(await listBouncedPayments(req.query)));
export const reconciliationQueue = asyncHandler(async (req, res) => res.json(await listReconciliationQueue(req.query)));
export const eligiblePaymentDestinations = asyncHandler(async (req, res) => {
  res.json({ data: await getEligiblePaymentDestinations({ requestId: req.params.id, bank: req.query.bank, currency: req.query.currency }) });
});

export const eligiblePayablePaymentDestinations = asyncHandler(async (req, res) => {
  res.json({ data: await getEligiblePayablePaymentDestinations({ accountsPayableId: req.params.id, bank: req.query.bank, currency: req.query.currency }) });
});

export const schedulePaymentRequests = asyncHandler(async (req, res) => {
  const requests = await schedulePayments({ ...req.body, user: req.user, req });
  res.json({ data: requests.map(publicRequestPayload) });
});

export const generateBankFile = asyncHandler(async (req, res) => {
  const result = await generatePaymentBatch({ ...req.body, user: req.user, req });
  res.status(201).json({
    data: result.batch,
    fileName: result.batch.fileName,
    url: result.batch.url,
    processed: result.batch.items.map((item) => item.requestNumber),
    totals: [{ currency: result.batch.currency, total: result.batch.totalAmount, count: result.batch.items.length }],
    statusChangesApplied: true,
    paymentEntriesCreated: false,
    paymentConfirmed: false,
    adapterMode: result.batch.adapterMode,
    notice: "BBVA fixed-width instruction generated. Confirm payment only after bank execution."
  });
});

export const confirmPayment = asyncHandler(async (req, res) => {
  const result = await confirmTreasuryPayment({ requestId: req.params.id, payload: req.body, user: req.user, req });
  res.json({ data: publicRequestPayload(result.request), accountsPayable: result.accountsPayable, paymentJournal: result.paymentJournal });
});

export const confirmPayablePayment = asyncHandler(async (req, res) => {
  const result = await confirmTreasuryPayable({ accountsPayableId: req.params.id, payload: req.body, user: req.user, req });
  res.json({ data: publicRequestPayload(result.request), accountsPayable: result.accountsPayable, paymentJournal: result.paymentJournal });
});

export const bouncePayablePayment = asyncHandler(async (req, res) => {
  const result = await markPaymentBounced({ accountsPayableId: req.params.id, payload: req.body, user: req.user, req });
  res.json({ data: publicRequestPayload(result.request), accountsPayable: result.accountsPayable });
});

export const reprogramPayablePayment = asyncHandler(async (req, res) => {
  const result = await reprogramBouncedPayment({ accountsPayableId: req.params.id, payload: req.body, files: req.files, user: req.user, req });
  res.json({ data: publicRequestPayload(result.request), accountsPayable: result.accountsPayable });
});

export const reconcileRequestPayment = asyncHandler(async (req, res) => {
  const result = await reconcilePayment({ requestId: req.params.id, payload: req.body, user: req.user, req });
  res.json({ data: publicRequestPayload(result.request), reconciliation: result.reconciliation });
});

export const reconcilePayablePayment = asyncHandler(async (req, res) => {
  const result = await reconcilePayment({ accountsPayableId: req.params.id, payload: req.body, user: req.user, req });
  res.json({ data: publicRequestPayload(result.request), reconciliation: result.reconciliation });
});

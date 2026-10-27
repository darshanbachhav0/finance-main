import FinancialRequest from "../models/FinancialRequest.js";
import SunatVoucher from "../models/SunatVoucher.js";
import SupplierBankAccount from "../models/SupplierBankAccount.js";
import { COST_CENTER_TYPE } from "../../../shared/costCenterAllocation.mjs";
import { priorityNeedsJustification } from "../../../shared/requestPriority.mjs";
import { AppError } from "../utils/AppError.js";
import { canonicalSeries, voucherNumberPattern } from "../utils/voucherIdentity.js";
import { getEffectiveFinanceConfiguration } from "./financeConfigurationService.js";
import { isEligibleSupplierPaymentAccount } from "./paymentDestinationService.js";
import {
  DEFAULT_A1_MINIMUM_QUOTATIONS,
  DEFAULT_ENCARGO_JOB_CATEGORIES,
  ERROR_CODES,
  FINANCE_CONFIGURATION_KEYS,
  FLOW_TYPE,
  REQUEST_STATUS,
  REQUEST_TYPE,
  ROLES
} from "../utils/constants.js";

// The online validations of a new request (Manual del usuario, "Validación en línea"; Manual técnico,
// "Validaciones en línea") that the platform did not check before. Each check is
// { code, ok, warning, title, detail, field }: ok false and warning false is critical and stops the
// sending; a warning is shown but does not stop it. The same list feeds the request form's live panel.

const BUSINESS_CASE_CODE = /^CN-\d{4}-\d{3}$/;
const idOf = (value) => String(value?._id || value || "");

export async function encargoJobCategories() {
  const configuration = await getEffectiveFinanceConfiguration(FINANCE_CONFIGURATION_KEYS.ENCARGO_JOB_CATEGORIES).catch(() => null);
  const configured = String(configuration?.textValue || "").split(/[,;\s]+/).map(Number).filter((value) => Number.isInteger(value) && value > 0);
  return configured.length ? configured : [...DEFAULT_ENCARGO_JOB_CATEGORIES];
}

const fill = (template, params = {}) => String(template).replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ""));

// title and detail are [template, params]: the English text is filled in here, and the template with
// its params lets the form show it in Spanish.
export async function a1MinimumQuotations() {
  const configuration = await getEffectiveFinanceConfiguration(FINANCE_CONFIGURATION_KEYS.A1_MINIMUM_QUOTATIONS).catch(() => null);
  const value = Number(configuration?.numericValue);
  return configuration && Number.isInteger(value) && value >= 1 ? value : DEFAULT_A1_MINIMUM_QUOTATIONS;
}

function check(code, ok, [title, titleParams], [detail, detailParams], { warning = false, field } = {}) {
  return {
    code, ok: Boolean(ok), warning: !ok && Boolean(warning),
    title: fill(title, titleParams), detail: fill(detail, detailParams),
    template: { title, titleParams: titleParams || {}, detail, detailParams: detailParams || {} },
    ...(field ? { field } : {})
  };
}

function urgencyCheck(request) {
  if (!priorityNeedsJustification(request.priority)) return null;
  const given = String(request.urgencyJustification || "").trim();
  return check("URGENCY_JUSTIFICATION", given, ["Written justification of the urgency"],
    [given ? "Provided" : "P1 and P2 requests must explain why they cannot wait for the fortnightly payment."], { field: "urgencyJustification" });
}

async function encargoCheck(request, user, categories) {
  if (request.costCenterType !== COST_CENTER_TYPE.ON_BEHALF) return null;
  if (user?.role === ROLES.ADMIN) return null;
  const category = Number(user?.jobCategory) || null;
  const allowed = category !== null && categories.includes(category);
  const title = ["Charge to other cost centers (job categories {list} only)", { list: categories.join(", ") }];
  const detail = allowed ? ["Registered by a category {category} position (Portal de Personas)", { category }]
    : category ? ["Your position is category {category}: you may charge only your own cost center.", { category }]
      : ["Your position has no job category: you may charge only your own cost center."];
  return check("ENCARGO_JOB_CATEGORY", allowed, title, detail, { field: "costCenterType" });
}

function businessCaseCheck(request) {
  if (request.requestType !== REQUEST_TYPE.CAPEX || request.flowType === FLOW_TYPE.C) return null;
  const code = String(request.capexDetails?.businessCaseCode || "").trim().toUpperCase();
  const ok = BUSINESS_CASE_CODE.test(code);
  return check("CAPEX_BUSINESS_CASE", ok, ["Approved business case (Viable or Ejecutar)"],
    ok ? ["{code}", { code }] : ["Enter the business case code, for example CN-2026-014."], { field: "capexDetails.businessCaseCode" });
}

function quotationCheck(request, required) {
  if (request.flowType !== FLOW_TYPE.A1) return null;
  // Quotations with their file, from different suppliers.
  const count = new Set((request.quotations || []).map((quotation, index) => (quotation.attachment ? idOf(quotation.supplier) || `quotation-${index}` : null)).filter(Boolean)).size;
  return check("A1_QUOTATIONS", count >= required, required === 3 ? ["Three quotations attached"] : ["{required} quotations attached", { required }],
    ["{count} of {required}", { count, required }], { field: "quotations" });
}

// RUC + series + number may be registered only once (Manual técnico, "Antiduplicidad").
async function duplicateInvoiceCheck(request) {
  const ruc = String(request.invoiceDetails?.ruc || "").replace(/\D/g, "");
  const full = String(request.invoiceDetails?.number || "").trim().toUpperCase();
  if (!ruc || !full || request.invoiceDetails?.status === "PENDING") return null;
  const dash = full.lastIndexOf("-");
  const series = dash > 0 ? canonicalSeries(full.slice(0, dash)) : "";
  const number = dash > 0 ? full.slice(dash + 1) : full;
  const closed = [REQUEST_STATUS.REJECTED, REQUEST_STATUS.VOIDED, REQUEST_STATUS.DRAFT];
  const [otherRequest, voucher] = await Promise.all([
    FinancialRequest.findOne({ _id: { $ne: request._id }, status: { $nin: closed }, "invoiceDetails.ruc": ruc, "invoiceDetails.number": full }).select("requestNumber").lean(),
    series ? SunatVoucher.findOne({ request: { $ne: request._id }, rucIssuer: ruc, series, number: voucherNumberPattern(number) }).select("request").lean() : null
  ]);
  const holder = otherRequest?.requestNumber || (voucher ? (await FinancialRequest.findById(voucher.request).select("requestNumber status").lean()) : null);
  const taken = typeof holder === "string" ? holder : holder && !closed.includes(holder.status) ? holder.requestNumber : null;
  return check("DUPLICATE_INVOICE", !taken, ["Unique invoice (RUC + series + number)"],
    taken ? ["{invoice} of RUC {ruc} is already registered on {request}.", { invoice: full, ruc, request: taken }] : ["Unique invoice"], { field: "invoiceDetails" });
}

// A supplier is paid only into an account verified in the request's currency. A supplier still
// waiting for its review is a warning: approval goes on and the payment waits.
async function paymentAccountCheck(request, supplier) {
  if (![FLOW_TYPE.A1, FLOW_TYPE.B].includes(request.flowType) || !supplier) return null;
  const currency = request.currency;
  const pending = supplier.homologationStatus === "PENDING_VALIDATION";
  const chosenId = idOf(request.paymentAccount?.account || request.$locals?.paymentAccountId);
  const accounts = await SupplierBankAccount.find({ supplier: supplier._id, active: true }).lean();
  const eligible = accounts.filter((account) => isEligibleSupplierPaymentAccount(account, { currency }));
  const chosen = chosenId ? accounts.find((account) => idOf(account._id) === chosenId) : null;
  if (chosen && chosen.currency !== currency) {
    return check("PAYMENT_ACCOUNT", false, ["Payment account in {currency}", { currency }],
      ["The chosen account is in {accountCurrency}; choose one in {currency}.", { accountCurrency: chosen.currency, currency }], { field: "paymentAccount" });
  }
  const ok = chosen ? eligible.some((account) => idOf(account._id) === chosenId) : eligible.length > 0;
  return check("PAYMENT_ACCOUNT", ok, ["Verified payment account in {currency}", { currency }],
    ok ? ["Verified"] : pending ? ["New supplier: approval goes on and the payment waits until its account in {currency} is verified.", { currency }]
      : ["The supplier has no verified account in {currency}: Accounting must verify one before payment.", { currency }],
    { warning: pending, field: "paymentAccount" });
}

export async function requestSubmissionChecks(request, { user, supplier } = {}) {
  const [categories, minimumQuotations] = await Promise.all([encargoJobCategories(), a1MinimumQuotations()]);
  const results = [
    urgencyCheck(request),
    await encargoCheck(request, user, categories),
    businessCaseCheck(request),
    quotationCheck(request, minimumQuotations),
    await duplicateInvoiceCheck(request),
    await paymentAccountCheck(request, supplier)
  ];
  return results.filter(Boolean);
}

// The first critical check that fails stops the sending, with its own explanation.
export async function assertRequestSubmissionChecks(request, context) {
  const checks = await requestSubmissionChecks(request, context);
  const failed = checks.find((item) => !item.ok && !item.warning);
  if (failed) throw new AppError(422, `${failed.title}: ${failed.detail}`, { field: failed.field, check: failed.code, checks }, ERROR_CODES.VALIDATION_ERROR);
  // The category is kept on the request as it was when it was sent (catSol).
  if (context?.user) request.requesterJobCategory = Number(context.user.jobCategory) || undefined;
  return checks;
}

// Proposed UMA user manual, pp. 3-4: acta issued by receiver, signed by responsible
// CECO head, additionally Vice-Rector for purchases above five UIT.
import crypto from "node:crypto";
import FinancialRequest from "../models/FinancialRequest.js";
import User from "../models/User.js";
import { clientIp, electronicSignature, recordAudit } from "./auditService.js";
import { notifyUser, notificationText } from "./notificationService.js";
import { hasPermission } from "../utils/permissions.js";
import { AppError } from "../utils/AppError.js";
import { DEFAULT_UIT_VALUE, ERROR_CODES, FLOW_TYPE, REQUEST_STATUS, ROLES, PERMISSIONS } from "../utils/constants.js";

const id = (value) => String(value?._id || value || "");
const allowedFlows = [FLOW_TYPE.A1, FLOW_TYPE.A2, FLOW_TYPE.B, FLOW_TYPE.C];
const eligibleStatuses = new Set([
  REQUEST_STATUS.APPROVED, REQUEST_STATUS.BUDGET_COMMITTED, REQUEST_STATUS.ACCOUNTED,
  REQUEST_STATUS.SCHEDULED, REQUEST_STATUS.BANK_FILE_GENERATED, REQUEST_STATUS.PAID,
  REQUEST_STATUS.RECONCILED, REQUEST_STATUS.RENDITION_PENDING, REQUEST_STATUS.CLOSED,
  REQUEST_STATUS.PAYMENT_BOUNCED
]);
const error = (status, message) => new AppError(status, message, undefined, status === 403 ? ERROR_CODES.FORBIDDEN : ERROR_CODES.VALIDATION_ERROR);

export const requiresViceRectorActaSignature = (penAmount, uitValue = DEFAULT_UIT_VALUE) => Number(penAmount || 0) > Number(uitValue) * 5;
export const digitalActaPostingEnabled = () => process.env.UMA_REQUIRE_DIGITAL_ACTA === "true";

function dataHash(request, details) {
  return crypto.createHash("sha256").update(JSON.stringify({
    requestId: id(request._id), requestNumber: request.requestNumber,
    totalAmount: Number(request.totalAmount), currency: request.currency,
    requestPenAmount: Number(request.totalPENEquivalent ?? request.penEquivalent),
    ...details
  })).digest("hex");
}
function sign(user, as, documentHash, timestamp) {
  return { signer: user._id, as, signedAt: timestamp, documentHash, signature: electronicSignature(user, timestamp) };
}
function readyToComplete(acta) {
  const roles = new Set((acta.signatures || []).map((item) => item.as));
  return roles.has("RECEIVER") && roles.has("RESPONSIBLE") && (!acta.viceRector || roles.has("VICE_RECTOR"));
}

export async function issueDigitalActa({ requestId, user, payload = {}, req }) {
  const request = await FinancialRequest.findById(requestId);
  if (!request) throw error(404, "Request not found.");
  if (!allowedFlows.includes(request.flowType) || !eligibleStatuses.has(request.status)) throw error(409, "The acta can be issued only after a purchase, service or advance request has been approved.");
  if (request.digitalActa?.status) throw error(409, "This request already has a digital acta; it cannot be overwritten. Contact Accounting to resolve a correction.");
  if (id(user._id) !== id(request.requester || request.solicitor)) throw error(403, "Only the registered receiver/requester may issue and sign the acta.");
  const conformity = String(payload.conformity || "TOTAL");
  if (!["TOTAL", "PARTIAL", "NON_CONFORMING"].includes(conformity)) throw error(422, "Choose total, partial, or non-conforming receipt.");
  const description = String(payload.description || "").trim();
  if (description.length < 5 || description.length > 2000) throw error(422, "Describe the received goods/service in 5-2000 characters.");
  const milestone = String(payload.milestone || "").trim();
  if (milestone.length > 250) throw error(422, "Milestone must be at most 250 characters.");
  const receiver = await User.findById(user._id).select("jefe active name role");
  const approvedSteps = [...(request.approvalRouteSnapshot || [])]
    .filter((step) => step.status === "APPROVED").sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
  // Existing organization hierarchy has no dedicated cost-center owner. Prefer the named
  // direct supervisor; otherwise use the first approved manager who is not the receiver.
  let responsibleId = receiver?.jefe;
  if (!responsibleId || id(responsibleId) === id(receiver?._id)) responsibleId = approvedSteps.find((step) => id(step.completedBy || step.approverUser) !== id(user._id))?.completedBy;
  const responsible = responsibleId ? await User.findById(responsibleId).select("active role name") : null;
  if (!responsible || responsible.active === false) throw error(422, "Assign an active responsible manager in the employee hierarchy before issuing the acta.");
  const isHighValue = requiresViceRectorActaSignature(request.totalPENEquivalent ?? request.penEquivalent);
  let viceRector = null;
  if (isHighValue) {
    const approvedVice = approvedSteps.find((step) => step.role === ROLES.VICE_RECTOR)?.completedBy;
    viceRector = approvedVice ? await User.findOne({ _id: approvedVice, role: ROLES.VICE_RECTOR, active: true }) : null;
    if (!viceRector) viceRector = await User.findOne({
      role: ROLES.VICE_RECTOR, active: true,
      $or: [{ area: request.requesterArea }, { approvalAreas: request.requesterArea }, { approvalAreas: "*" }]
    });
    if (!viceRector || [id(receiver?._id), id(responsible?._id)].includes(id(viceRector._id))) throw error(422, "Assign a distinct active Vice-Rector for the requester area before issuing an acta over 5 UIT.");
  }
  const issuedAt = new Date();
  const documentHash = dataHash(request, { conformity, description, milestone, receiver: id(user._id), responsible: id(responsible._id), viceRector: id(viceRector?._id) });
  const acta = {
    status: conformity === "NON_CONFORMING" ? "OBSERVED" : "PENDING",
    conformity, description, milestone, receiver: user._id, responsible: responsible._id,
    ...(viceRector && { viceRector: viceRector._id }),
    issuedAt, documentHash, signatures: [sign(user, "RECEIVER", documentHash, issuedAt)]
  };
  // Atomically create only when no acta exists; two receivers cannot create duplicates.
  const result = await FinancialRequest.updateOne({ _id: request._id, "digitalActa.status": { $exists: false } }, { $set: { digitalActa: acta } });
  if (!result.modifiedCount) throw error(409, "An acta was issued simultaneously. Refresh the request.");
  await recordAudit({ entityType: "FinancialRequest", entity: request, user, req, module: "ACTAS", action: "DIGITAL_ACTA_ISSUED", newValues: { conformity, documentHash, responsible: id(responsible._id), viceRector: id(viceRector?._id), signature: "AUTHENTICATED_ELECTRONIC_SIGN_OFF", ip: clientIp(req) } });
  return (await FinancialRequest.findById(requestId)).digitalActa;
}

export async function signDigitalActa({ requestId, user, req }) {
  const request = await FinancialRequest.findById(requestId);
  if (!request?.digitalActa) throw error(404, "No digital acta has been issued for this request.");
  const acta = request.digitalActa;
  if (acta.status === "OBSERVED") throw error(409, "A non-conforming acta must be reviewed before it can be signed as accepted.");
  if (acta.status === "COMPLETE") throw error(409, "This acta is already complete.");
  const role = id(acta.responsible) === id(user._id) ? "RESPONSIBLE" : id(acta.viceRector) === id(user._id) ? "VICE_RECTOR" : "";
  if (!role) throw error(403, "You are not an assigned signer of this acta.");
  if ((acta.signatures || []).some((item) => id(item.signer) === id(user._id) || item.as === role)) throw error(409, "This signer has already signed.");
  const timestamp = new Date();
  const signature = sign(user, role, acta.documentHash, timestamp);
  const result = await FinancialRequest.updateOne({
    _id: request._id, "digitalActa.status": "PENDING",
    "digitalActa.signatures": { $not: { $elemMatch: { as: role } } }
  }, { $push: { "digitalActa.signatures": signature } });
  if (!result.modifiedCount) throw error(409, "The acta changed while signing. Refresh.");
  const latest = await FinancialRequest.findById(requestId);
  if (readyToComplete(latest.digitalActa)) {
    await FinancialRequest.updateOne({ _id: requestId, "digitalActa.status": "PENDING" }, { $set: { "digitalActa.status": "COMPLETE", "digitalActa.completedAt": timestamp } });
  }
  await recordAudit({ entityType: "FinancialRequest", entity: request, user, req, module: "ACTAS", action: "DIGITAL_ACTA_SIGNED", newValues: { role, documentHash: acta.documentHash, signer: id(user._id), signature: signature.signature, ip: clientIp(req) } });
  return (await FinancialRequest.findById(requestId)).digitalActa;
}

// Opt-in rollout: activate after assigning cost-center manager and job-category master data.
// Only credit or post-delivery invoices must be signed before posting; advances remain payable
// before receipt, with the follow-up acta tracked separately.
export function assertDigitalActaForAccounting(request) {
  // Track B credit invoices ALWAYS require a signed acta (manual pp. 3-5).
  // The rollout flag continues to control A1/A2 so unrelated routes are not changed.
  if (request.flowType !== FLOW_TYPE.B && !digitalActaPostingEnabled()) return;
  if (![FLOW_TYPE.A1, FLOW_TYPE.A2, FLOW_TYPE.B].includes(request.flowType)) return;
  const condition = request.supplierPaymentTerms?.paymentCondition;
  if (condition === "100%_ADVANCE") return;
  if (request.digitalActa?.status !== "COMPLETE" || request.digitalActa?.conformity !== "TOTAL") {
    throw new AppError(422, "A fully signed, conforming digital acta is required before provisioning a credit/post-delivery invoice. Partial or non-conforming receipt needs Accounting review.", { actaStatus: request.digitalActa?.status || "MISSING" }, ERROR_CODES.MISSING_REQUIRED_DOCUMENT);
  }
}

// Accounting cannot silently accept a partial or nonconforming receipt at full value.
// Instead it returns the acta to the receiver, preserving the original signed record
// and hash in an append-only history. Only a new fully conforming acta can release B.
export async function requestDigitalActaCorrection({ requestId, reason, user, req }) {
  if (!hasPermission(user, PERMISSIONS.ACCOUNTING_PROVISION)) throw error(403, "Only Accounting may request correction of an acta.");
  const text = String(reason || "").trim();
  if (text.length < 10 || text.length > 2000) throw error(422, "Provide a specific correction reason (10-2000 characters).");
  const request = await FinancialRequest.findById(requestId);
  if (!request) throw error(404, "Request not found.");
  if (request.flowType !== FLOW_TYPE.B || !request.digitalActa?.status || request.digitalActa.conformity === "TOTAL") {
    throw error(409, "Only a partial or non-conforming Process B acta may be returned for corrected receipt.");
  }
  if ([REQUEST_STATUS.ACCOUNTED, REQUEST_STATUS.SCHEDULED, REQUEST_STATUS.BANK_FILE_GENERATED, REQUEST_STATUS.PAID, REQUEST_STATUS.RECONCILED, REQUEST_STATUS.CLOSED].includes(request.status)) {
    throw error(409, "Accounting cannot replace an acta after a payable has been posted.");
  }
  // Atomic optimistic lock prevents two Accounting users from simultaneously returning
  // an acta. The exact hash must still be the one the reviewer saw.
  const oldActa = request.digitalActa.toObject();
  const result = await FinancialRequest.updateOne({ _id: requestId, "digitalActa.documentHash": oldActa.documentHash }, {
    $push: { digitalActaHistory: oldActa },
    $unset: { digitalActa: "" }
  });
  if (!result.modifiedCount) throw error(409, "The acta changed. Refresh before requesting a correction.");
  await recordAudit({ entityType: "FinancialRequest", entity: request, user, req, module: "ACTAS", action: "DIGITAL_ACTA_RETURNED", comments: text,
    oldValues: { status: oldActa.status, conformity: oldActa.conformity, documentHash: oldActa.documentHash },
    newValues: { correctionRequested: true, reason: text } });
  await notifyUser({ userId: request.requester || request.solicitor, eventKey: `request:${requestId}:acta-correction:${Date.now()}`,
    type: "REQUEST_OBSERVED", title: notificationText("Correct the digital acta"),
    message: notificationText("{requestNumber}: Accounting requested a new conforming acta. Reason: {detail}", { requestNumber: request.requestNumber, detail: text }),
    path: `/requests/${requestId}`, entityType: "FinancialRequest", entityId: requestId });
  return { status: "CORRECTION_REQUIRED", previousHash: oldActa.documentHash };
}

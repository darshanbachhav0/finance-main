import FinancialRequest from "../models/FinancialRequest.js";
import Supplier from "../models/Supplier.js";
import User from "../models/User.js";
import { recordAudit, workflowEvent } from "./auditService.js";
import {
  activeApprovalStep,
  advanceApprovalRoute,
  activateNextChainStep,
  finalizeChainApproval,
  initializeApprovalRoute,
  slaStatus,
  stopApprovalRoute
} from "./approvalRuleService.js";
import { validateAccountingDimensions } from "./accountingDimensionService.js";
import { reserveBudget } from "./budgetService.js";
import { preflightDirectPayment, provisionDirectPayment, provisionTrackCAdvance } from "./directPaymentService.js";
import { assertConfiguredDocuments } from "./documentRuleService.js";
import { applyExchangeRate } from "./exchangeRateService.js";
import { guardAccountingPeriod } from "./periodService.js";
import { notifyRoles, notifyUser, resolveNotification } from "./notificationService.js";
import { generatePurchaseOrder } from "./purchaseOrderService.js";
import { evaluateProcurementReadiness } from "./procurementReadinessService.js";
import { assertSupplierUsable } from "./supplierService.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "./queryService.js";
import { requestListPopulate, requestListSelect, requestPopulate } from "./requestService.js";
import { runFinancialOperation } from "./transactionService.js";
import { transitionRequest } from "./workflowService.js";
import { validateXmlAgainstRequest } from "./xmlValidationService.js";
import { AppError } from "../utils/AppError.js";
import {
  APPROVAL_ROUTING_MODE,
  APPROVAL_STAGES,
  DOCUMENT_PHASE,
  ERROR_CODES,
  FLOW_TYPE,
  PERMISSIONS,
  REQUEST_STATUS,
  ROLES
} from "../utils/constants.js";
import { canApproveStage, hasPermission } from "../utils/permissions.js";
import { allowedRequestActions } from "./requestActionPolicy.js";

const activeApprovalStatuses = [
  REQUEST_STATUS.PENDING_APPROVAL,
  REQUEST_STATUS.DIRECTOR_APPROVED,
  REQUEST_STATUS.VICE_RECTOR_APPROVED
];

function requesterId(request) {
  return String(request.requester?._id || request.requester || request.solicitor?._id || request.solicitor || "");
}

function assertApprovalActor(request, user, step, adminOverrideReason) {
  if (String(adminOverrideReason || "").trim()) throw new AppError(403, "Emergency approval overrides are disabled. Use the assigned approval route.");
  if (!step) throw new AppError(409, "This request has no pending approval step.", undefined, ERROR_CODES.INVALID_STATUS_TRANSITION);

  if (step.source === APPROVAL_ROUTING_MODE.MANAGER_CHAIN) {
    // Chain steps are assigned to a specific person (the requester's jefe, or
    // that jefe's own jefe once forwarded) — identity, not role/area pool.
    if (user.role !== ROLES.ADMIN && String(step.approverUser) !== String(user._id)) {
      throw new AppError(403, "This approval step is assigned to a different manager.", undefined, ERROR_CODES.FORBIDDEN);
    }
  } else {
    if (!hasPermission(user, PERMISSIONS.REQUEST_APPROVE)) {
      throw new AppError(403, "You do not have approval permission.", undefined, ERROR_CODES.FORBIDDEN);
    }
    if (user.role !== ROLES.ADMIN) {
      if (!canApproveStage(request, user)) {
        throw new AppError(403, "This request is assigned to a different approval level.", { approvalLevel: step.approvalLevel }, ERROR_CODES.FORBIDDEN);
      }
      if (step.role && step.role !== user.role) {
        throw new AppError(403, "This approval step is assigned to another role.", { requiredRole: step.role }, ERROR_CODES.FORBIDDEN);
      }
      if (step.approvalLevel === APPROVAL_STAGES.AREA_DIRECTOR) {
        const allowedAreas = new Set([user.area, ...(user.approvalAreas || [])].filter(Boolean));
        const requestArea = request.requesterArea || request.requestingArea;
        if (requestArea && !allowedAreas.has(requestArea) && !allowedAreas.has("*")) {
          throw new AppError(403, "This request belongs to another approval area.", { requestArea }, ERROR_CODES.FORBIDDEN);
        }
      }
    }
  }
  if (requesterId(request) === String(user._id)) {
    throw new AppError(403, "A requester cannot approve their own request.", { segregationOfDuties: true }, ERROR_CODES.FORBIDDEN);
  }
}

async function validateApprovalControls(request, user) {
  await guardAccountingPeriod({
    period: request.accountingPeriod,
    action: "APPROVE",
    user,
    module: "APPROVALS",
    entityType: "FinancialRequest",
    entityId: request._id,
    requestId: request._id
  });
  await validateAccountingDimensions({ requestType: request.requestType, expenseNature: request.expenseNature, lines: request.lines, user });
  const supplier = request.flowType === FLOW_TYPE.C ? null : (request.supplier?._id ? request.supplier : await Supplier.findById(request.supplier));
  await applyExchangeRate(request);
  await request.validate();
  await assertConfiguredDocuments(request, DOCUMENT_PHASE.SUBMISSION);
  const xmlAttachment = [...(request.attachments || [])].reverse().find((item) => item.kind === "XML");
  if (xmlAttachment) {
    request.xmlValidation = await validateXmlAgainstRequest(xmlAttachment.path, {
      supplier,
      fiscalData: request.fiscalData,
      totalNet: request.totalNet,
      totalIGV: request.totalIGV,
      totalAmount: request.totalAmount,
      issueDate: request.issueDate
    }, { request, requestNumber: request.requestNumber, supplier, user, fileName: xmlAttachment.originalName });
    request.xmlValidationHistory.push(request.xmlValidation);
  }
  if (request.flowType === FLOW_TYPE.B && !request.xmlValidation?.validated) {
    throw new AppError(422, "A valid XML fiscal document is required.", { requestType: request.requestType }, ERROR_CODES.XML_VALIDATION_FAILED);
  }
}

export async function listApprovalInbox(queryParams, user) {
  const query = { status: { $in: activeApprovalStatuses } };
  if (user.role !== ROLES.ADMIN) {
    // A manager-chain approver (any role, typically Solicitor) sees requests
    // where they are the pending step's specific approver, regardless of
    // role/area. A legacy Approver/Management user additionally keeps the
    // original role+area-scoped pool visibility for rule-based requests.
    const chainMatch = { "approvalRouteSnapshot": { $elemMatch: { approverUser: user._id, status: "PENDING", source: APPROVAL_ROUTING_MODE.MANAGER_CHAIN } } };
    if ([ROLES.APPROVER, ROLES.MANAGEMENT].includes(user.role)) {
      const legacyMatch = { approvalStage: user.approvalLevel || APPROVAL_STAGES.AREA_DIRECTOR };
      if (legacyMatch.approvalStage === APPROVAL_STAGES.AREA_DIRECTOR) {
        const areas = [user.area, ...(user.approvalAreas || [])].filter(Boolean);
        if (!areas.includes("*")) legacyMatch.$or = [{ requesterArea: { $in: areas } }, { requestingArea: { $in: areas } }];
      }
      query.$or = [legacyMatch, chainMatch];
    } else {
      Object.assign(query, chainMatch);
    }
  }
  if (queryParams.stage) query.approvalStage = queryParams.stage;
  if (queryParams.requestType) query.requestType = queryParams.requestType;
  if (queryParams.priority) query.priority = queryParams.priority;
  if (queryParams.search) {
    const search = new RegExp(escapedRegex(queryParams.search), "i");
    const [supplierIds, userIds] = await Promise.all([
      Supplier.distinct("_id", { $or: [{ legalName: search }, { name: search }, { normalizedIdentifier: search }, { rucDni: search }] }),
      User.distinct("_id", { $or: [{ name: search }, { email: search }, { area: search }] })
    ]);
    query.$and = [{ $or: [
      { requestNumber: search },
      { description: search },
      { "supplierSnapshot.legalName": search },
      { supplier: { $in: supplierIds } },
      { requester: { $in: userIds } },
      { solicitor: { $in: userIds } }
    ] }];
  }
  const { page, pageSize, skip } = parsePagination(queryParams);
  const sort = parseSort(queryParams, ["requestNumber", "requestType", "priority", "approvalStage", "status", "totalPENEquivalent", "approvalDueAt", "createdAt"], { approvalDueAt: 1, createdAt: 1 });
  const [requests, total, summaryRows] = await Promise.all([
    FinancialRequest.find(query).select(requestListSelect).populate(requestListPopulate).sort(sort).skip(skip).limit(pageSize),
    FinancialRequest.countDocuments(query),
    FinancialRequest.aggregate([
      { $match: query },
      { $group: { _id: null, amount: { $sum: "$totalPENEquivalent" }, oldestCreatedAt: { $min: "$createdAt" } } }
    ])
  ]);
  const data = requests.map((request) => {
    const object = request.toObject();
    object.sla = slaStatus(request);
    object.allowedActions = allowedRequestActions(request, user);
    for (const attachment of object.attachments || []) delete attachment.path;
    return object;
  });
  return {
    ...paginatedPayload(data, total, page, pageSize),
    summary: { total, amount: summaryRows[0]?.amount || 0, oldestCreatedAt: summaryRows[0]?.oldestCreatedAt || null }
  };
}

async function appendApprovalWithoutStatusTransition({ request, step, routeResult, user, req, comments, adminOverrideReason, session }) {
  request.approvalHistory.push(workflowEvent({
    action: `${step.approvalLevel}_APPROVED`,
    from: request.status,
    to: request.status,
    user,
    req,
    comments: adminOverrideReason ? `${comments || ""} Admin override: ${adminOverrideReason}`.trim() : comments,
    stage: step.approvalLevel,
    dueAt: step.dueAt,
    request
  }));
  await request.save({ session });
  await recordAudit({
    entityType: "FinancialRequest",
    entity: request,
    action: `${step.approvalLevel}_APPROVED`,
    user,
    req,
    comments,
    module: "APPROVALS",
    oldValues: { approvalStage: step.approvalLevel },
    newValues: { approvalStage: routeResult.next?.approvalLevel || APPROVAL_STAGES.COMPLETE },
    session
  });
}

export async function commitApprovedRequestBudget({ request, user, req }) {
  if (![REQUEST_STATUS.DIRECTOR_APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED, REQUEST_STATUS.APPROVED, REQUEST_STATUS.OBSERVED_BUDGET].includes(request.status) || activeApprovalStep(request)) {
    throw new AppError(409, "Financial handoff can only run after every required approval is complete or after a budget observation is resolved.", { status: request.status, approvalStage: request.approvalStage }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }

  if (request.flowType === FLOW_TYPE.C) {
    const result = await runFinancialOperation(async (session) => {
      await provisionTrackCAdvance({ request, user, req, session });
      return request;
    });
    await notifyRoles({ roles: [ROLES.TREASURY], eventKey: `request:${request._id}:treasury`, type: "TREASURY_PAYMENT", title: "Track C advance ready", message: `${request.requestNumber} is ready for priority advance payment.`, path: "/treasury", entityType: "FinancialRequest", entityId: request._id });
    return result;
  }

  const supplier = request.supplier?._id ? request.supplier : await Supplier.findById(request.supplier);
  assertSupplierUsable(supplier);
  let directPaymentPreflight;
  if (request.flowType === FLOW_TYPE.B) {
    directPaymentPreflight = await preflightDirectPayment({ request, user, req, observe: true });
    if (!directPaymentPreflight.valid) {
      await notifyUser({
        userId: request.requester?._id || request.requester || request.solicitor,
        eventKey: `request:${request._id}:direct-payment-observed:${Date.now()}`,
        type: "REQUEST_OBSERVED",
        title: "Direct-payment invoice observed",
        message: `${request.requestNumber}: ${directPaymentPreflight.detail}`,
        path: `/requests/${request._id}/edit`,
        entityType: "FinancialRequest",
        entityId: request._id
      });
      return request;
    }
  }
  const result = await runFinancialOperation(async (session) => {
    const commitment = await reserveBudget(request, user._id, { session });
    request.budgetCommitment = commitment._id;
    if (request.flowType === FLOW_TYPE.A1) {
      const procurement = await evaluateProcurementReadiness(request, { session, commitment });
      if (procurement.applicable) {
        const purchaseOrder = await generatePurchaseOrder(request, user, req, { session, commitment });
        request.purchaseOrder = purchaseOrder._id;
      }
    }
    await transitionRequest({ request, targetStatus: REQUEST_STATUS.BUDGET_COMMITTED, user, req, action: "BUDGET_COMMITTED", comments: "All approvals completed and budget commitment recorded.", approvalStage: APPROVAL_STAGES.COMPLETE, nextApprovalStage: APPROVAL_STAGES.COMPLETE, dueAt: null, session });
    if (request.flowType === FLOW_TYPE.B) await provisionDirectPayment({ request, user, req, session, preflight: directPaymentPreflight });
    return request;
  });
  await resolveNotification(`request:${request._id}:budget-exception`);
  await notifyRoles({
    roles: request.flowType === FLOW_TYPE.B ? [ROLES.TREASURY] : [ROLES.ACCOUNTING],
    eventKey: `request:${request._id}:${request.flowType === FLOW_TYPE.B ? "treasury" : "accounting"}`,
    type: request.flowType === FLOW_TYPE.B ? "TREASURY_PAYMENT" : "ACCOUNTING_PROCESSING",
    title: request.flowType === FLOW_TYPE.B ? "Priority payment ready" : "Accounting processing required",
    message: request.flowType === FLOW_TYPE.B ? `${request.requestNumber} was auto-provisioned and is ready for priority Treasury payment.` : `${request.requestNumber} is budget committed and its PO is ready for invoice matching.`,
    path: request.flowType === FLOW_TYPE.B ? "/treasury" : "/accounting",
    entityType: "FinancialRequest",
    entityId: request._id
  });
  return result;
}

export async function decideApproval({ id, action, comments, adminOverrideReason, forward, user, req }) {
  const decision = String(action || "").toUpperCase();
  if (!["APPROVE", "OBSERVE", "RETURN", "REJECT"].includes(decision)) {
    throw new AppError(422, "Unsupported approval action.", { action }, ERROR_CODES.VALIDATION_ERROR);
  }
  if (decision !== "APPROVE" && !String(comments || "").trim()) {
    throw new AppError(422, `${decision} comments are required.`, { field: "comments" }, ERROR_CODES.VALIDATION_ERROR);
  }
  const request = await FinancialRequest.findById(id).select("+attachments.path").populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  if (!activeApprovalStatuses.includes(request.status)) {
    throw new AppError(409, "Only requests in an active approval stage can receive a decision.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  if (!request.approvalRouteSnapshot?.length) await initializeApprovalRoute(request);
  const step = activeApprovalStep(request);
  assertApprovalActor(request, user, step, adminOverrideReason);
  const isChainStep = step.source === APPROVAL_ROUTING_MODE.MANAGER_CHAIN;
  if (isChainStep && decision === "APPROVE" && typeof forward !== "boolean") {
    throw new AppError(422, "You must specify whether to forward this approval to the next manager or finalize it here.", { field: "forward" }, ERROR_CODES.VALIDATION_ERROR);
  }
  await validateApprovalControls(request, user);

  if (decision !== "APPROVE") {
    const targetByDecision = {
      OBSERVE: REQUEST_STATUS.OBSERVED,
      RETURN: REQUEST_STATUS.RETURNED,
      REJECT: REQUEST_STATUS.REJECTED
    };
    const stoppedStatus = {
      OBSERVE: "OBSERVED",
      RETURN: "RETURNED",
      REJECT: "REJECTED"
    }[decision];
    stopApprovalRoute(request, stoppedStatus);
    request.rejectionReason = comments;
    await transitionRequest({
      request,
      targetStatus: targetByDecision[decision],
      user,
      req,
      action: decision,
      comments,
      approvalStage: step.approvalLevel,
      eventDueAt: step.dueAt,
      adminOverrideReason,
      skipRoleCheck: isChainStep
    });
    await resolveNotification(`request:${request._id}:approval:${step.approvalLevel}`);
    await notifyUser({
      userId: request.requester?._id || request.requester || request.solicitor,
      eventKey: `request:${request._id}:${decision}:${Date.now()}`,
      type: `REQUEST_${decision}`,
      title: `Request ${decision.toLowerCase()}`,
      message: `${request.requestNumber} requires your attention: ${comments}`,
      path: `/requests/${request._id}`,
      entityType: "FinancialRequest",
      entityId: request._id
    });
    await request.populate(requestPopulate);
    return { request };
  }

  const routeResult = await runFinancialOperation(async (session) => {
    if (isChainStep) {
      const route = forward
        ? activateNextChainStep(request, step, user)
        : finalizeChainApproval(request, step, user);
      if (!forward) {
        await transitionRequest({
          request,
          targetStatus: REQUEST_STATUS.APPROVED,
          user,
          req,
          action: "CHAIN_APPROVED_FINAL",
          comments: comments || "Approved by the manager chain.",
          approvalStage: step.approvalLevel,
          nextApprovalStage: APPROVAL_STAGES.COMPLETE,
          dueAt: null,
          eventDueAt: step.dueAt,
          adminOverrideReason,
          skipRoleCheck: true,
          session
        });
      } else {
        await appendApprovalWithoutStatusTransition({ request, step, routeResult: route, user, req, comments, adminOverrideReason, session });
      }
      return route;
    }

    const route = advanceApprovalRoute(request, user._id);

    // Intermediate approval levels never change the parent status — the frozen
    // route/approval history is the record of who approved what, at which
    // level. The parent only ever moves once, straight from PENDIENTE_APROBACION
    // to the canonical APROBADO, when every required step is done — regardless
    // of which specific approval level happened to be last. This also fixes a
    // real defect the old level-specific branching had: a configured route
    // whose final step was any level other than Area Director/Vice Rector
    // (e.g. Rectorate, General Management) could never reach a valid approved
    // state at all.
    if (route.complete) {
      await transitionRequest({
        request,
        targetStatus: REQUEST_STATUS.APPROVED,
        user,
        req,
        action: `${step.approvalLevel}_APPROVED`,
        comments: comments || `Approved at ${step.approvalLevel}.`,
        approvalStage: step.approvalLevel,
        nextApprovalStage: APPROVAL_STAGES.COMPLETE,
        dueAt: null,
        eventDueAt: step.dueAt,
        adminOverrideReason,
        skipRoleCheck: true,
        session
      });
    } else {
      await appendApprovalWithoutStatusTransition({ request, step, routeResult: route, user, req, comments, adminOverrideReason, session });
    }

    if (route.complete && request.status !== REQUEST_STATUS.APPROVED) {
      throw new AppError(
        409,
        "The configured approval route did not finish in an approved lifecycle state.",
        { status: request.status, approvalLevel: step.approvalLevel },
        ERROR_CODES.INVALID_STATUS_TRANSITION
      );
    }
    return route;
  });

  let budgetWarning;
  let fiscalObservation = false;
  const requiresBudgetHandoff = routeResult.complete && user.role === ROLES.MANAGEMENT;
  if (routeResult.complete && !requiresBudgetHandoff) {
    try {
      await commitApprovedRequestBudget({ request, user, req });
      fiscalObservation = request.status === REQUEST_STATUS.OBSERVED_SUNAT;
    } catch (error) {
      if (![ERROR_CODES.INSUFFICIENT_BUDGET, ERROR_CODES.SUPPLIER_NOT_HOMOLOGATED, ERROR_CODES.SUPPLIER_REJECTED, ERROR_CODES.SUPPLIER_INACTIVE].includes(error.code)) throw error;
      budgetWarning = { code: error.code, message: error.message, details: error.details };
      if (error.code === ERROR_CODES.INSUFFICIENT_BUDGET && request.status !== REQUEST_STATUS.OBSERVED_BUDGET) {
        request.observation = { code: ERROR_CODES.INSUFFICIENT_BUDGET, detail: error.message, observedAt: new Date(), observedBy: user._id };
        await transitionRequest({ request, targetStatus: REQUEST_STATUS.OBSERVED_BUDGET, user, req, action: "BUDGET_OBSERVED", comments: error.message, skipControls: true });
      }
      await recordAudit({
        entityType: "FinancialRequest",
        entity: request,
        action: "BUDGET_COMMITMENT_PENDING",
        user,
        req,
        module: "BUDGET",
        message: error.message,
        newValues: error.details
      });
    }
  }
  await resolveNotification(`request:${request._id}:approval:${step.approvalLevel}`);
  if (activeApprovalStep(request)) {
    await notifyRoles({
      roles: [activeApprovalStep(request).role],
      approvalLevel: activeApprovalStep(request).approvalLevel,
      eventKey: `request:${request._id}:approval:${activeApprovalStep(request).approvalLevel}`,
      type: "APPROVAL_PENDING",
      title: "Approval pending",
      message: `${request.requestNumber} is waiting for ${activeApprovalStep(request).approvalLevel} approval.`,
      path: `/approvals?request=${request._id}`,
      entityType: "FinancialRequest",
      entityId: request._id
    });
  } else if (budgetWarning) {
    await notifyRoles({
      roles: [ROLES.BUDGET, ROLES.ADMIN],
      eventKey: `request:${request._id}:budget-exception`,
      type: "BUDGET_EXCEPTION",
      title: "Budget exception pending",
      message: `${request.requestNumber} cannot be committed until its budget exception is resolved.`,
      path: "/budget",
      entityType: "FinancialRequest",
      entityId: request._id
    });
  } else if (request.status === REQUEST_STATUS.OBSERVED_SUNAT) {
    // preflightDirectPayment already notified the requester; no Accounting/Treasury
    // handoff is emitted until a corrected XML passes SUNAT and duplicate controls.
  } else if (fiscalObservation) {
    // The direct-payment preflight already notified the requester. Do not
    // create a misleading Accounting/Treasury task while the XML is observed.
  } else if (requiresBudgetHandoff) {
    await notifyRoles({
      roles: [ROLES.BUDGET, ROLES.ADMIN],
      eventKey: `request:${request._id}:budget-commitment`,
      type: "BUDGET_COMMITMENT",
      title: "Budget commitment required",
      message: `${request.requestNumber} completed Rectorate approval and is ready for budget commitment.`,
      path: "/budget",
      entityType: "FinancialRequest",
      entityId: request._id
    });
  } else {
    await notifyRoles({
      roles: [ROLES.ACCOUNTING],
      eventKey: `request:${request._id}:accounting`,
      type: "ACCOUNTING_PROCESSING",
      title: "Accounting processing required",
      message: `${request.requestNumber} is budget committed and ready for fiscal processing.`,
      path: "/accounting",
      entityType: "FinancialRequest",
      entityId: request._id
    });
  }
  await request.populate(requestPopulate);
  return { request, budgetWarning };
}

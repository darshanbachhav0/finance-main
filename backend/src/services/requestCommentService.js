import FinancialRequest from "../models/FinancialRequest.js";
import RequestComment from "../models/RequestComment.js";
import User from "../models/User.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { canViewRequest } from "../utils/permissions.js";
import { recordAudit } from "./auditService.js";
import { notificationText, notifyUser } from "./notificationService.js";
import { activeApprovalStep } from "./approvalRuleService.js";

// The request's conversation: anyone who can view the request reads and writes it, and can
// mention (@) anyone else who can view it. A mention, the requester and the person whose decision
// is pending are notified. Comments never change the request's status.

const MAX_BODY = 2000;
const MAX_MENTIONS = 10;
const AUTHOR_FIELDS = "name role area jobTitle";
const idOf = (value) => String(value?._id || value || "");

async function viewableRequest(requestId, user) {
  const request = await FinancialRequest.findById(requestId).select("requestNumber title status requester solicitor approvalRouteSnapshot");
  if (!request) throw new AppError(404, "Request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  if (!canViewRequest(request, user)) throw new AppError(403, "You do not have permission to view this request.", undefined, ERROR_CODES.FORBIDDEN);
  return request;
}

function publicComment(comment) {
  const value = comment.toObject ? comment.toObject() : comment;
  return {
    _id: value._id,
    body: value.body,
    createdAt: value.createdAt,
    author: value.author ? { _id: value.author._id, name: value.author.name, role: value.author.role, jobTitle: value.author.jobTitle } : null,
    mentions: (value.mentions || []).map((user) => ({ _id: user._id, name: user.name }))
  };
}

export async function listRequestComments(requestId, user) {
  await viewableRequest(requestId, user);
  const comments = await RequestComment.find({ request: requestId }).sort({ createdAt: 1 }).populate("author", AUTHOR_FIELDS).populate("mentions", "name");
  return comments.map(publicComment);
}

// People the author can mention: active users whose name matches the search and who can view
// this request (a mention notification must never reveal a request to someone who cannot open it).
export async function mentionableUsers(requestId, user, search = "") {
  const request = await viewableRequest(requestId, user);
  const term = String(search || "").trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const candidates = await User.find({ active: true, _id: { $ne: user._id }, ...(term ? { name: { $regex: term, $options: "i" } } : {}) })
    .select("name role area jobTitle permissions approvalLevel")
    .sort({ name: 1 })
    .limit(40)
    .lean();
  return candidates.filter((candidate) => canViewRequest(request, candidate)).slice(0, 8).map((candidate) => ({ _id: candidate._id, name: candidate.name, role: candidate.role, area: candidate.area, jobTitle: candidate.jobTitle }));
}

export async function addRequestComment(requestId, user, { body, mentions = [] } = {}, req) {
  const request = await viewableRequest(requestId, user);
  const text = String(body || "").trim();
  if (!text) throw new AppError(422, "Write a comment first.", { field: "body" }, ERROR_CODES.VALIDATION_ERROR);
  if (text.length > MAX_BODY) throw new AppError(422, `Comments can be up to ${MAX_BODY} characters.`, { field: "body", max: MAX_BODY }, ERROR_CODES.VALIDATION_ERROR);

  const requestedIds = [...new Set((Array.isArray(mentions) ? mentions : []).map(idOf).filter((id) => /^[a-f\d]{24}$/i.test(id) && id !== idOf(user._id)))].slice(0, MAX_MENTIONS);
  const mentionedUsers = requestedIds.length ? await User.find({ _id: { $in: requestedIds }, active: true }).select("name role permissions approvalLevel").lean() : [];
  const allowedMentions = mentionedUsers.filter((candidate) => canViewRequest(request, candidate));

  const comment = await RequestComment.create({ request: request._id, author: user._id, body: text, mentions: allowedMentions.map((item) => item._id) });
  await recordAudit({ entityType: "FinancialRequest", entity: request, action: "REQUEST_COMMENTED", user, req, module: "REQUESTS", newValues: { comment: comment._id, mentions: allowedMentions.map((item) => item._id) } });

  const excerpt = text.length > 140 ? `${text.slice(0, 137)}...` : text;
  const path = `/requests/${request._id}#comments`;
  const notified = new Set([idOf(user._id)]);
  for (const mentioned of allowedMentions) {
    notified.add(idOf(mentioned._id));
    await notifyUser({ userId: mentioned._id, eventKey: `request:${request._id}:comment:${comment._id}:mention`, type: "COMMENT_MENTION", title: notificationText("You were mentioned"), message: notificationText("{author} mentioned you on {requestNumber}: {excerpt}", { author: user.name, requestNumber: request.requestNumber, excerpt }), path, entityType: "FinancialRequest", entityId: request._id });
  }
  // The requester and whoever must decide next hear about the question even without a mention.
  const pending = activeApprovalStep(request);
  const followers = [request.requester || request.solicitor, pending?.approverUser].map(idOf).filter((id) => id && !notified.has(id));
  for (const followerId of [...new Set(followers)]) {
    await notifyUser({ userId: followerId, eventKey: `request:${request._id}:comment:${comment._id}`, type: "REQUEST_COMMENT", title: notificationText("New comment"), message: notificationText("{author} commented on {requestNumber}: {excerpt}", { author: user.name, requestNumber: request.requestNumber, excerpt }), path, entityType: "FinancialRequest", entityId: request._id });
  }

  await comment.populate([{ path: "author", select: AUTHOR_FIELDS }, { path: "mentions", select: "name" }]);
  return publicComment(comment);
}

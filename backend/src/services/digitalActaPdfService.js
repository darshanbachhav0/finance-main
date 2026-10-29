// Self-contained, deterministic acta PDF; no headless browser or third-party PDF engine.
// This document records authenticated application sign-offs, NOT certified digital signatures.
import FinancialRequest from "../models/FinancialRequest.js";
import User from "../models/User.js";
import { canViewRequest } from "../utils/permissions.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

import { buildDigitalActaPdf } from "./digitalActaPdfRenderer.js";

export async function getCompletedDigitalActaPdf({ requestId, user }) {
  const request = await FinancialRequest.findById(requestId).lean();
  if (!request) throw new AppError(404, "Request not found.", undefined, ERROR_CODES.NOT_FOUND);
  if (!canViewRequest(request, user)) throw new AppError(403, "You cannot view this request's acta.", undefined, ERROR_CODES.FORBIDDEN);
  if (!request.digitalActa || request.digitalActa.status !== "COMPLETE") {
    throw new AppError(409, "Complete the acta signatures before downloading the final PDF.", undefined, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  const signerIds = [...new Set((request.digitalActa.signatures || []).map((signature) => String(signature.signer)))];
  const users = await User.find({ _id: { $in: signerIds } }).select("name").lean();
  const names = Object.fromEntries(users.map((signer) => [String(signer._id), signer.name]));
  return { pdf: buildDigitalActaPdf({ request, acta: request.digitalActa, names }), filename: `ACTA-${String(request.requestNumber || request._id).replace(/[^\w-]/g, "_")}.pdf` };
}

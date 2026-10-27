import User from "../src/models/User.js";
import { activeApprovalStep } from "../src/services/approvalRuleService.js";
import { decideApproval } from "../src/services/approvalService.js";
import { APPROVAL_ROUTING_MODE, REQUEST_STATUS } from "../src/utils/constants.js";

// Approves as `user`, then as each superior the manager chain sends it to (the cost center's
// responsible never finalizes alone), so tests about what follows approval reach it.
export async function approveThroughChain({ id, user, req, comments = "Conforme", forward = false, ...extra }) {
  let result = await decideApproval({ id, action: "APPROVE", comments, forward, user, req, ...extra });
  for (let level = 0; level < 12 && result.request.status === REQUEST_STATUS.PENDING_APPROVAL; level += 1) {
    const step = activeApprovalStep(result.request);
    if (step?.source !== APPROVAL_ROUTING_MODE.MANAGER_CHAIN) break;
    const next = await User.findById(step.approverUser?._id || step.approverUser);
    result = await decideApproval({ id, action: "APPROVE", comments, forward, user: next, req, ...extra });
  }
  return result;
}

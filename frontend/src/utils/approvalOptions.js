// GET /api/approvals/:id/options (and the inbox rows' approvalOptions):
// { chain, canForward, canFinalize, superiorRequired, forwardTo, remainingPolicyStages, supplierApproval }.

// Whether the approver must send the request up to forwardTo instead of finalizing it: above the
// superior-approval threshold the cost center's responsible never finalizes alone.
export function mustSendUp(options) {
  return Boolean(options?.chain) && (options.superiorRequired === true || options.canFinalize === false);
}

// "Financial Administration Management, General Management": the role-based steps (GAF, Gerencia
// General, Head of Treasury) that still follow this one, translated; "" when none.
export function laterStagesText(options, t = (value) => value) {
  return (options?.remainingPolicyStages || []).filter(Boolean).map((stage) => t(stage)).join(", ");
}

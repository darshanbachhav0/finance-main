// Track D (traspaso): money moved between two of UMA's own bank accounts in the same currency.
// Treasury registers it, another Treasury user (Head of Treasury) and the GAF approve it, Treasury
// executes it at the bank and reconciles it with the statement.

export const isTransfer = (request) => request?.flowType === "D";

// The list stages of GET /api/treasury/transfers (summary keys), in workflow order.
export const transferStages = ["pending", "toExecute", "toReconcile", "done", "stopped"];
export const transferStageLabels = {
  pending: "Awaiting approval",
  toExecute: "To execute",
  toReconcile: "To reconcile",
  done: "Completed",
  stopped: "Stopped",
  all: "All transfers"
};

// "BBVA-PEN → BCP-PEN": the source and destination account codes.
export function transferRoute(request) {
  const transfer = request?.treasuryTransfer;
  if (!transfer) return "";
  return `${transfer.sourceAccount?.code || "-"} → ${transfer.destinationAccount?.code || "-"}`;
}

// Where a user decides a pending transfer step: Treasury the first one, the GAF the second.
export const TIER_ROLES = Object.freeze({ TREASURY_HEAD: "Treasury", GAF: "GAF", GENERAL_MANAGEMENT: "Management" });

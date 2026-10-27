import FinancialRequest from "../models/FinancialRequest.js";
import { LEGACY_REQUEST_PRIORITY_MAP, REQUEST_PRIORITY_RANK } from "../../../shared/requestPriority.mjs";

// Requests saved with the former Alta / Media / Baja priority move to the P1-P4 payment priority
// once (Alta -> P2 Urgente, Media and Baja -> P3 Normal), with the rank lists sort by. Idempotent.
export async function migrateLegacyPriorities() {
  const moved = {};
  for (const [legacy, priority] of Object.entries(LEGACY_REQUEST_PRIORITY_MAP)) {
    const result = await FinancialRequest.collection.updateMany({ priority: legacy }, { $set: { priority, priorityRank: REQUEST_PRIORITY_RANK[priority] } });
    moved[legacy] = result.modifiedCount || 0;
  }
  return moved;
}

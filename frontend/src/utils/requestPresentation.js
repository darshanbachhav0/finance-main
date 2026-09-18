import { canonicalRequestStatus, isTerminalRequest } from "../../../shared/workflowStatus.mjs";

export function displayedRequestStatus(request, financialProgress = request?.financialProgress) {
  const storedStatus = canonicalRequestStatus(request?.status);
  if (isTerminalRequest(storedStatus)) return storedStatus;
  if (financialProgress?.counts?.total > 0 && financialProgress.status) {
    return canonicalRequestStatus(financialProgress.status);
  }
  return storedStatus;
}

export function renditionRequirements(documentStatus) {
  const phase = documentStatus?.phases?.RENDITION;
  return {
    total: phase?.requirements?.length || 0,
    missing: phase?.missing || [],
    complete: Boolean(phase?.valid)
  };
}

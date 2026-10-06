import assert from "node:assert/strict";
import fs from "node:fs";
import uxbulkSpanish from "../src/context/i18n/uxbulk.js";

const read = file => fs.readFileSync(new URL(file, import.meta.url), "utf8");
const inbox = read("../src/pages/ApprovalInbox.jsx");
const treasury = read("../src/pages/TreasuryQueue.jsx");
const layout = read("../src/layouts/AppLayout.jsx");
const bell = read("../src/hooks/useNotificationBell.js");
const css = read("../src/styles/global.css");
const approvalService = read("../../backend/src/services/approvalService.js");
const approvalRoutes = read("../../backend/src/routes/approvalRoutes.js");
const notificationRoutes = read("../../backend/src/routes/notificationRoutes.js");

// Bulk approve: one call to the bulk endpoint, only rows the server lets the user approve.
assert.ok(inbox.includes('api.post("/approvals/bulk", body)'));
assert.ok(approvalRoutes.includes('router.post("/bulk", bulkApproveRequestsHandler)'));
assert.ok(approvalRoutes.indexOf('"/bulk"') < approvalRoutes.indexOf('"/:id/approve"'), "/bulk is matched before /:id");
assert.match(inbox, /selection=\{\{ selected: selectedIds, onChange: setSelectedIds, isRowSelectable: \(row\) => hasAction\(row, "APPROVE"\) \}\}/);
assert.ok(inbox.includes("ids: selectedRows.map((row) => row._id), comments"), "one shared comment for the batch");
// The cap is the same on both sides.
const serverCap = Number(approvalService.match(/export const MAX_BULK_APPROVALS = (\d+);/)?.[1]);
const clientCap = Number(inbox.match(/const BULK_APPROVAL_LIMIT = (\d+);/)?.[1]);
assert.equal(serverCap, 50);
assert.equal(clientCap, serverCap);
// The server runs the regular decision for every request; nothing bypasses it.
assert.match(approvalService, /export async function bulkApproveRequests[\s\S]*await decideApproval\(\{ id, action: "APPROVE"/);
// Only approvals are bulk; rejections, returns and observations stay individual.
assert.equal(inbox.match(/api\.post\("\/approvals\/bulk/g)?.length, 1);
assert.equal(approvalRoutes.match(/"\/bulk[^"]*"/g)?.join(), '"/bulk"', "a single bulk route, for approvals");
assert.doesNotMatch(approvalService.slice(approvalService.indexOf("export async function bulkApproveRequests")), /action: "(REJECT|RETURN|OBSERVE)"/);
// "Send to my jefe" for the batch only when every selected row can be forwarded; otherwise it is explained.
assert.ok(inbox.includes("const bulkCanForward = selectedRows.length > 0 && notForwardable.length === 0"));
assert.ok(inbox.includes("disabled={processing || bulkOverLimit || !bulkCanForward}"));
assert.ok(inbox.includes('t("Send to my jefe is available only when every selected request can be sent to your jefe. Not possible for:")'));
// Confirmation shows count and total; the result is summarized and the table refreshes.
assert.ok(inbox.includes('{ label: "Requests", value: String(selectedRows.length) }') && inbox.includes('{ label: "Total amount", value: selectedTotals }'));
assert.ok(inbox.includes('t("{approved} approved, {failed} with errors")') && inbox.includes("setBulkResult(data)") && inbox.includes("approvalTable.reload()"));

// Treasury: DataTable's selection keyed by CXP, select all visible, per-currency totals, cleared after generation.
assert.ok(treasury.includes('rowKey="selectionKey"') && treasury.includes("selection={{ selected, onChange: setSelected, isRowSelectable: isSelectable }}"));
assert.ok(treasury.includes('t("Select all visible")') && treasury.includes("onClick={selectAllVisible}"));
assert.ok(treasury.includes("selectedByCurrency.map(([code, value]) => money(code, value))"));
assert.ok(treasury.includes('<div className="bulk-bar bank-file-bar"') && treasury.includes('t("Generate file")'));
assert.match(treasury, /setResult\(response\.data\);[\s\S]{0,160}setSelected\(\[\]\);/);
assert.ok(!treasury.includes("toggleRow"), "the hand-rolled checkbox column is replaced by DataTable selection");

// Bell: per-item read and "mark done", backed by an owner-scoped endpoint.
assert.ok(notificationRoutes.includes('router.patch("/:id/dismiss", dismissOneNotification)'));
assert.ok(bell.includes("api.patch(`/notifications/${item._id}/dismiss`)") && bell.includes("dismiss };"));
assert.ok(layout.includes('aria-label={t("Mark read")} onClick={() => markNotificationRead(item)}'));
assert.ok(layout.includes('aria-label={t("Mark done")} onClick={() => dismissNotification(item)}'));

// Spanish copy and the single labelled style block at the end of the stylesheet.
assert.equal(uxbulkSpanish["{approved} approved, {failed} with errors"], "{approved} aprobadas, {failed} con error");
assert.equal(uxbulkSpanish["Generate file"], "Generar archivo");
for (const key of ["Approve selected", "Bulk approval", "Select all visible", "Mark read", "Mark done", "Approval comments (shared by every request)", "Choose Approve and finalize or Send to my jefe for the manager-chain requests in this batch."]) assert.ok(uxbulkSpanish[key], `Spanish copy for ${key}`);
const blockStart = css.indexOf("/* ==== ux: bulk actions");
assert.ok(blockStart > css.indexOf("/* ==== design system (final layer)"));
assert.equal(css.indexOf("/* ==== ux: bulk actions", blockStart + 1), -1, "one block only");
assert.ok(css.includes(".bulk-bar {") && css.slice(blockStart).includes("position: sticky"));

console.log("PASS bulk approve, Treasury bulk selection and notification per-item action contracts");

import { Ban, Eye, FileDiff, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import DeepLinkNotice from "../components/DeepLinkNotice.jsx";
import Drawer from "../components/Drawer.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import SupplierCreditsPanel from "../components/SupplierCreditsPanel.jsx";
import Tabs, { tabId } from "../components/Tabs.jsx";
import PayableDetail from "../components/payables/PayableDetail.jsx";
import { cancelBlockedReason, supplierLabel, voucherLabel } from "../utils/payables.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import useDeepLink from "../hooks/useDeepLink.js";
import usePaginatedResource from "../hooks/usePaginatedResource.js";
import { flowTypes } from "../utils/options.js";
import { formatCurrency, formatDate } from "../utils/formatters.js";
import "../styles/accountsPayable.css";

// Work views (server side: backend/src/services/accountsPayableViews.js) and the supplier
// credits list. The view is kept in the URL (?view=due) so it can be linked and reloaded.
const VIEWS = [
  ["open", "To pay"],
  ["due", "Due within 7 days"],
  ["bounced", "Bounced payments"],
  ["paid", "Paid"],
  ["all", "All CXP"],
  ["credits", "Supplier credits"]
];
const VIEW_IDS = VIEWS.map(([id]) => id);

export default function AccountsPayable() {
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const money = (currency, value) => formatCurrency(value, currency || "PEN", language);
  const [searchParams, setSearchParams] = useSearchParams();
  const view = VIEW_IDS.includes(searchParams.get("view")) ? searchParams.get("view") : "open";
  const [selected, setSelected] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [noteTarget, setNoteTarget] = useState(null);
  const [noteFiles, setNoteFiles] = useState({ xml: null, pdf: null });
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState("");

  // ?record=<CXP id> opens that CXP's details; ?request=<request id> lists the request's CXPs.
  // A notification link shows every view, so the linked CXP is never hidden by a tab.
  const deepLink = useDeepLink(["record", "request"]);
  const listView = deepLink.active ? "all" : view === "credits" ? "open" : view;
  const payableTable = usePaginatedResource("/accounting/accounts-payable", { fixedParams: { ...deepLink.link, view: listView }, deepLink: deepLink.active });
  const creditTable = usePaginatedResource("/accounting/supplier-credits", { initialPageSize: 10 });
  const { rows, loading } = payableTable;
  const openedLink = useRef("");
  useEffect(() => {
    const row = deepLink.link.record && rows.find((item) => String(item._id) === deepLink.link.record);
    if (!row || openedLink.current === deepLink.link.record) return;
    openedLink.current = deepLink.link.record;
    setSelected(row);
  }, [deepLink.link.record, rows]);

  const summary = payableTable.payload.summary || {};
  const counts = summary.viewCounts || {};
  const totals = useMemo(() => ({ original: Number(summary.originalPEN || 0), outstanding: Number(summary.outstandingPEN || 0), paid: Number(summary.paidPEN || 0) }), [summary.originalPEN, summary.outstandingPEN, summary.paidPEN]);
  const creditCount = Number(creditTable.pagination.total || 0);

  function changeView(next) {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next === "open") params.delete("view");
      else params.set("view", next);
      return params;
    }, { replace: true });
  }

  function reload() {
    payableTable.reload();
    creditTable.reload();
  }

  function openCancel(row) {
    setActionError("");
    setCancelTarget(row);
  }

  async function confirmCancel(reason) {
    setProcessing(true);
    setActionError("");
    try {
      await api.post(`/accounting/accounts-payable/${cancelTarget._id}/cancel`, { reason });
      notify("CXP cancelled. The reversal was posted, the Purchase Order balance restored and the voucher annulled.");
      setCancelTarget(null);
      setSelected(null);
      reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  function openNote(row) {
    setActionError("");
    setNoteFiles({ xml: null, pdf: null });
    setNoteTarget(row);
  }

  async function submitNote(event) {
    event.preventDefault();
    if (!noteFiles.xml) return;
    setProcessing(true);
    setActionError("");
    const data = new FormData();
    data.append("xml", noteFiles.xml);
    if (noteFiles.pdf) data.append("pdf", noteFiles.pdf);
    if (noteTarget.sunatVoucher?._id) data.append("originalVoucherId", noteTarget.sunatVoucher._id);
    data.append("requestId", noteTarget.request?._id || noteTarget.request);
    try {
      const response = await api.post("/accounting/adjustment-notes", data, { headers: { "Content-Type": "multipart/form-data" } });
      notify(response.data.observed ? "The note was registered but SUNAT could not validate it. Approve a manual SUNAT exception from Accounting Entries to apply it." : response.data.supplierCredit ? "Credit note applied. The paid part is now a supplier credit." : "Note applied to the original invoice.");
      setNoteTarget(null);
      setSelected(null);
      reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  // Actions stay visible; an unavailable cancel says why instead of disappearing.
  const canNote = (row) => Boolean(row.sunatVoucher) && row.status !== "CANCELLED";
  const showCancel = (row) => !["PAID", "CANCELLED"].includes(row.status);
  const rowActions = (row) => [
    // A row click opens the record too, so the menu keeps the table narrow enough to show every column.
    { label: "View CXP details", icon: Eye, onClick: () => setSelected(row) },
    { label: "Register credit/debit note", icon: FileDiff, hidden: !canNote(row), onClick: () => openNote(row) },
    { label: "Cancel unpaid CXP", icon: Ban, tone: "danger", hidden: !showCancel(row), disabled: Boolean(cancelBlockedReason(row)), disabledReason: cancelBlockedReason(row) || undefined, onClick: () => openCancel(row) }
  ];

  const columns = [
    { key: "request", type: "code", primary: true, label: "Request", sortable: false, getValue: (row) => row.request?.requestNumber, render: (row) => row.request ? <div className="primary-cell"><Link to={`/requests/${row.request._id}`}>{row.request.requestNumber}</Link><span><StatusBadge status={row.flowType || row.request.flowType} /></span></div> : "-" },
    { key: "supplier", type: "name", primary: true, label: "Supplier", sortable: false, getValue: supplierLabel, render: (row) => <div className="primary-cell"><strong>{supplierLabel(row)}</strong><span>{row.supplierIdentifierSnapshot || "-"}</span></div> },
    { key: "voucher", type: "code", primary: true, label: "Voucher", sortable: false, getValue: voucherLabel, render: (row) => <div className="primary-cell"><strong>{voucherLabel(row)}</strong><span>{row.sunatValidation?.status === "MANUAL_EXCEPTION" || row.sunatVoucher?.validationStatus === "MANUAL_EXCEPTION" ? t("Manual SUNAT exception") : t(row.sunatVoucher?.sunatStatus || row.sunatVoucher?.validationStatus || "-")}</span></div> },
    { key: "outstandingAmount", type: "money", primary: true, label: "Outstanding", render: (row) => <div className="primary-cell payable-amount"><strong>{money(row.currency, row.outstandingAmount)}</strong>{row.detraction?.status === "PENDING" && <span>{t("Detraction")}: {money("PEN", row.detraction.amountPen ?? row.detraction.amount)}</span>}</div> },
    { key: "dueDate", type: "date", primary: true, label: "Due date", render: (row) => row.dueDate ? formatDate(row.dueDate, language) : row.paymentTermsSnapshot?.paymentCondition ? <span className="cell-note">{t("Date to be confirmed under the agreed terms")}</span> : "-" },
    // A priority payment is flagged next to the status (normal priority needs no badge).
    { key: "status", type: "status", primary: true, label: "Status", render: (row) => <div className="payable-status"><StatusBadge status={row.status} />{row.paymentPriority === "PRIORITY" && <StatusBadge status="PRIORITY" />}</div> }
  ];

  const filters = [
    // The tabs choose the work view; "All CXP" also filters by status (e.g. cancelled).
    ...(listView === "all" ? [{ key: "status", label: "statuses", allLabel: "All statuses", options: ["OPEN", "SCHEDULED", "PAYMENT_FILE_CREATED", "PARTIALLY_PAID", "PAYMENT_BOUNCED", "PAID", "CANCELLED"] }] : []),
    { key: "currency", label: "currencies", allLabel: "All currencies", options: ["PEN", "USD"] },
    { key: "flowType", label: "tracks", allLabel: "All tracks", options: flowTypes },
    { key: "paymentPriority", label: "priorities", allLabel: "All priorities", options: ["NORMAL", "PRIORITY"] }
  ];

  const viewTabs = VIEWS.map(([id, label]) => ({ id, label, count: id === "credits" ? creditCount : counts[id] }));
  const activeTab = deepLink.active ? "all" : view;

  return (
    <section className="accounts-payable-page">
      <PageHeader
        title="Accounts Payable"
        description="Every invoice's payable (CXP): what is owed, when it is due and how it is paid."
        actions={<button type="button" className="secondary-button" onClick={reload} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>}
      />
      <Message type="error">{(noteTarget || cancelTarget ? "" : actionError) || payableTable.error}</Message>
      {deepLink.active && <DeepLinkNotice title="Showing the CXP linked from your notification" missing={!loading && !rows.length} missingDescription="No CXP was found for this link." clearLabel="Show all CXP" onClear={deepLink.clear} />}

      <div className="stats-grid compact-stats payable-kpis">
        <StatCard label="Outstanding amount" value={money("PEN", totals.outstanding)} tone="warning" />
        <StatCard label="Due within 7 days" value={counts.due ?? "-"} tone={counts.due ? "danger" : "success"} />
        <StatCard label="Bounced payments" value={counts.bounced ?? "-"} tone={counts.bounced ? "danger" : "success"} />
        <StatCard label="Paid amount" value={money("PEN", totals.paid)} tone="success" />
      </div>

      <Tabs idPrefix="payables" label="Accounts payable views" value={activeTab} onChange={changeView} tabs={viewTabs} />

      {/* One list serves the five payable views; the selected tab labels it. */}
      <div className="workspace-panel" hidden={activeTab === "credits"} role="tabpanel" aria-labelledby={tabId("payables", activeTab === "credits" ? "open" : activeTab)}>
        <DataTable
          rows={rows}
          loading={loading}
          remote={payableTable.remote}
          filters={filters}
          searchPlaceholder="Search request, supplier, voucher, Purchase Order, or bank batch..."
          emptyTitle="No CXP records yet"
          emptyDescription="A CXP is created for each invoice once Accounting processes it."
          emptyAction={{ label: "Accounting Entries", to: "/accounting" }}
          onRowClick={setSelected}
          rowActions={rowActions}
          columns={columns}
        />
      </div>
      <div hidden={activeTab !== "credits"} role="tabpanel" aria-labelledby={tabId("payables", "credits")}>
        <SupplierCreditsPanel table={creditTable} onChanged={payableTable.reload} />
      </div>

      <Drawer
        open={Boolean(selected)}
        size="large"
        title={selected ? voucherLabel(selected) : "Accounts payable record"}
        description={selected ? [selected.request?.requestNumber, supplierLabel(selected)].filter(Boolean).join(" · ") : ""}
        onClose={() => setSelected(null)}
        footer={selected && <PayableActions row={selected} onNote={openNote} onCancel={openCancel} canNote={canNote(selected)} showCancel={showCancel(selected)} />}
      >
        {selected && <PayableDetail payable={selected} />}
      </Drawer>

      <Drawer
        open={Boolean(noteTarget)}
        error={actionError}
        title="Register credit/debit note"
        description={noteTarget ? `${voucherLabel(noteTarget)} · ${noteTarget.request?.requestNumber || ""}` : ""}
        onClose={() => !processing && setNoteTarget(null)}
        footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setNoteTarget(null)}>{t("Cancel")}</button><button type="submit" form="adjustment-note-form" className="primary-button" disabled={processing || !noteFiles.xml}><FileDiff size={16} /><span>{t(processing ? "Processing..." : "Register note")}</span></button></>}
      >
        {noteTarget && <form id="adjustment-note-form" className="form-grid" onSubmit={submitNote}>
          <p>{t("A credit note lowers this invoice's balance (a part already paid becomes a supplier credit); a debit note raises it.")}</p>
          <label className="field"><span>{t("Note XML")} *</span><input type="file" accept=".xml" required onChange={(event) => setNoteFiles({ ...noteFiles, xml: event.target.files?.[0] || null })} /></label>
          <label className="field"><span>{t("Note PDF")}</span><input type="file" accept=".pdf" onChange={(event) => setNoteFiles({ ...noteFiles, pdf: event.target.files?.[0] || null })} /></label>
        </form>}
      </Drawer>

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="Cancel unpaid CXP?"
        description="The provision is reversed in the current open period, the budget and Purchase Order balance are restored, and the SUNAT voucher is annulled so a corrected invoice can be registered."
        details={cancelTarget ? [{ label: "Voucher", value: voucherLabel(cancelTarget) }, { label: "Amount", value: money(cancelTarget.currency, cancelTarget.originalAmount) }] : []}
        confirmLabel="Cancel CXP"
        cancelLabel="Keep CXP"
        tone="danger"
        inputLabel="Cancellation reason"
        inputRequired
        loading={processing}
        error={actionError}
        onClose={() => !processing && setCancelTarget(null)}
        onConfirm={confirmCancel}
      />
    </section>
  );
}

// The record's actions, in the panel footer. An unavailable cancel shows why.
function PayableActions({ row, onNote, onCancel, canNote, showCancel }) {
  const { t } = useLanguage();
  const blocked = cancelBlockedReason(row);
  return <div className="payable-actions">
    {showCancel && blocked && <small className="payable-action-reason" id="payable-cancel-reason">{t(blocked)}</small>}
    {showCancel && <button type="button" className="danger-button subtle" disabled={Boolean(blocked)} aria-describedby={blocked ? "payable-cancel-reason" : undefined} onClick={() => onCancel(row)}><Ban size={16} /><span>{t("Cancel unpaid CXP")}</span></button>}
    {canNote && <button type="button" className="secondary-button" onClick={() => onNote(row)}><FileDiff size={16} /><span>{t("Register credit/debit note")}</span></button>}
  </div>;
}

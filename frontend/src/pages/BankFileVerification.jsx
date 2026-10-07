import { AlertTriangle, CheckCircle2, Download, Eye, FileCheck2, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import DeepLinkNotice from "../components/DeepLinkNotice.jsx";
import Drawer from "../components/Drawer.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import ProtectedAssetButton from "../components/ProtectedAssetButton.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import useDeepLink from "../hooks/useDeepLink.js";
import usePaginatedResource from "../hooks/usePaginatedResource.js";
import { formatCurrency, formatDate, formatDateTime } from "../utils/formatters.js";

// Treasury downloads a bank TXT and sends it to the bank only after Accounting verifies it here.
// Rejecting a file cancels it: its payments return to Treasury's queue with the reason.
const verificationOf = (batch) => batch?.verification?.status || "VERIFIED";
const activeItems = (batch) => (batch?.items || []).filter((item) => item.status !== "CANCELLED");

// The server's automatic checks, by code (bankFileVerificationService.bankFileProblems).
const problemText = {
  FILE_MISSING: "The TXT file was not found in storage.",
  FILE_CHANGED: "The TXT no longer matches the file that was generated.",
  TOTAL_MISMATCH: "The file total does not match the sum of its payments.",
  NO_ACTIVE_PAYMENTS: "The file has no payment left to send.",
  ITEM_REMOVED: "{requestNumber} was removed from this file after it was generated, but the TXT still contains it.",
  PAYABLE_CHANGED: "{requestNumber}: the payable is no longer waiting in this file.",
  DESTINATION_NOT_VERIFIED: "{requestNumber}: the beneficiary account is no longer verified.",
  BLOCKING_OBSERVATION: "{requestNumber}: the payable has an open observation."
};
// Where each payment stands in the file.
const itemStatusText = {
  INSTRUCTION_CREATED: "In the file",
  CANCELLED: "Removed from the file",
  PARTIALLY_CONFIRMED: "Partly paid",
  CONFIRMED: "Paid",
  REJECTED: "Bounced",
  REPROGRAMMED: "Reprogrammed"
};
const warningText = {
  TODAY: "Its payment date is today. Verify or reject it so Treasury can send it in time.",
  PASSED: "Its payment date has passed. You can still verify it; Treasury will send it late."
};

export default function BankFileVerification() {
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const deepLink = useDeepLink(["record"]);
  const table = usePaginatedResource("/accounting/bank-files", { fixedParams: deepLink.link, deepLink: deepLink.active, initialFilters: { verificationStatus: "PENDING" } });
  const [selected, setSelected] = useState(null);
  const [checks, setChecks] = useState({ loading: false, problems: [], error: "" });
  const [decision, setDecision] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const money = (currency, value) => formatCurrency(value, currency || "PEN", language);
  const pending = verificationOf(selected) === "PENDING" && selected?.status === "GENERATED";
  const problemMessage = (problem) => t(problemText[problem.code] || problem.message).replace("{requestNumber}", problem.requestNumber || "");

  function open(row) {
    setSelected(row);
    setError("");
    setChecks({ loading: false, problems: [], error: "" });
  }

  // The checks are run again on open, so the decision is taken on the file as it is now.
  useEffect(() => {
    if (!selected?._id || verificationOf(selected) !== "PENDING" || selected.status !== "GENERATED") return undefined;
    let active = true;
    setChecks({ loading: true, problems: [], error: "" });
    api.get(`/accounting/bank-files/${selected._id}/checks`)
      .then((response) => { if (active) setChecks({ loading: false, problems: response.data.data?.problems || [], error: "" }); })
      .catch((err) => { if (active) setChecks({ loading: false, problems: [], error: err.message }); });
    return () => { active = false; };
  }, [selected?._id]);

  const openedLink = useRef("");
  useEffect(() => {
    const row = deepLink.link.record && table.rows.find((item) => String(item._id) === deepLink.link.record);
    if (!row || openedLink.current === deepLink.link.record) return;
    openedLink.current = deepLink.link.record;
    open(row);
  }, [deepLink.link.record, table.rows]);

  async function decide(reason) {
    if (!selected || !decision) return;
    setProcessing(true);
    setError("");
    try {
      if (decision === "verify") {
        await api.post(`/accounting/bank-files/${selected._id}/verify`);
        notify("Bank file verified. Treasury can now download it.");
      } else {
        await api.post(`/accounting/bank-files/${selected._id}/reject`, { reason });
        notify("Bank file rejected and cancelled. Its payments are back in Treasury's queue.");
      }
      setDecision(null);
      setSelected(null);
      table.reload();
    } catch (err) {
      const problems = err.details?.problems;
      if (problems?.length) setChecks({ loading: false, problems, error: "" });
      setError(err.message);
      setDecision(null);
    } finally {
      setProcessing(false);
    }
  }

  const fileButtons = (batch) => <div className="inline-document-actions">
    <ProtectedAssetButton className="secondary-button" resourcePath={batch.url} fileName={batch.fileName} preview ariaLabel={`${t("View TXT")}: ${batch.fileName}`}><Eye size={15} aria-hidden="true" /><span>{t("View TXT")}</span></ProtectedAssetButton>
    <ProtectedAssetButton className="secondary-button" resourcePath={batch.url} fileName={batch.fileName} ariaLabel={`${t("Download")}: ${batch.fileName}`}><Download size={15} aria-hidden="true" /><span>{t("Download")}</span></ProtectedAssetButton>
  </div>;

  return (
    <section>
      <PageHeader
        title="Bank file verification"
        description="Check each bank TXT before Treasury downloads it and sends it to the bank. Rejecting a file cancels it and returns its payments to Treasury's queue."
        actions={<button type="button" className="secondary-button" onClick={table.reload} disabled={table.loading}><RefreshCw className={table.loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>}
      />
      <Message type="error">{(selected ? "" : error) || table.error}</Message>
      {deepLink.active && <DeepLinkNotice title="Showing the bank file linked from your notification" missing={!table.loading && !table.rows.length} missingDescription="This bank file is no longer available." clearLabel="Show all bank files" onClear={deepLink.clear} />}
      <div className="workspace-panel">
        <DataTable
          rows={table.rows}
          loading={table.loading}
          remote={table.remote}
          filters={[{ key: "verificationStatus", label: "Verification", allLabel: "All bank files", options: ["PENDING", "VERIFIED", "REJECTED"] }, { key: "currency", label: "currencies", allLabel: "All currencies", options: ["PEN", "USD"] }]}
          searchPlaceholder="Search batch, file, request or supplier..."
          emptyTitle="No bank files to verify"
          emptyDescription="Bank files appear here as soon as Treasury generates them."
          rowActions={(row) => [{ label: verificationOf(row) === "PENDING" && row.status === "GENERATED" ? "Review bank file" : "View details", icon: FileCheck2, primary: true, onClick: () => open(row) }]}
          columns={[
            { key: "batchNumber", type: "code", label: "Batch" },
            { key: "paymentDate", type: "date", primary: true, label: "Payment date", render: (row) => <span className="primary-cell"><strong>{formatDate(row.paymentDate, language)}</strong>{row.paymentDateWarning && <small className="text-danger">{t(row.paymentDateWarning === "PASSED" ? "Payment date passed" : "Payment date is today")}</small>}</span> },
            { key: "currency", type: "code", label: "Currency" },
            { key: "items", type: "number", label: "Payments", sortable: false, render: (row) => activeItems(row).length },
            { key: "totalAmount", type: "money", label: "Total", render: (row) => money(row.currency, row.totalAmount) },
            { key: "generatedAt", type: "date", label: "Generated", render: (row) => <span className="primary-cell"><span>{formatDateTime(row.generatedAt, language)}</span><small>{row.generatedBy?.name || "-"}</small></span> },
            { key: "verification", type: "status", label: "Verification", sortable: false, getValue: verificationOf, render: (row) => <span className="primary-cell"><StatusBadge status={verificationOf(row)} />{row.verification?.reason && <small>{row.verification.reason}</small>}</span> }
          ]}
        />
      </div>

      <Drawer
        open={Boolean(selected)}
        size="large"
        error={error}
        title={pending ? "Verify bank file" : "Bank file"}
        description={selected ? `${selected.batchNumber} · ${money(selected.currency, selected.totalAmount)} · ${formatDate(selected.paymentDate, language)}` : ""}
        onClose={() => !processing && setSelected(null)}
        footer={pending ? <>
          <button type="button" className="danger-button" disabled={processing} onClick={() => setDecision("reject")}><XCircle size={16} />{t("Reject")}</button>
          <button type="button" className="primary-button" disabled={processing || checks.loading || checks.problems.length > 0 || Boolean(checks.error)} onClick={() => setDecision("verify")}><CheckCircle2 size={16} />{t("Verify")}</button>
        </> : <button type="button" className="secondary-button" onClick={() => setSelected(null)}>{t("Close")}</button>}
      >
        {selected && <div className="form-grid">
          {selected.paymentDateWarning && <div className="inline-alert alert-warning"><AlertTriangle size={18} /><div><strong>{t(selected.paymentDateWarning === "PASSED" ? "Payment date passed" : "Payment date is today")}</strong><span>{t(warningText[selected.paymentDateWarning])}</span></div></div>}
          {pending && <div className={`document-requirement${checks.problems.length || checks.error ? " required" : ""}`}>
            {checks.problems.length || checks.error ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}
            <div>
              <strong>{t(checks.loading ? "Running the automatic checks..." : checks.error ? "The automatic checks could not run" : checks.problems.length ? "The file did not pass its checks: reject it so Treasury can generate it again" : "All automatic checks passed")}</strong>
              {checks.error ? <p>{checks.error}</p> : checks.problems.length ? <ul>{checks.problems.map((problem, index) => <li key={`${problem.code}-${index}`}>{problemMessage(problem)}</li>)}</ul> : <p>{t("The TXT is the file that was generated, every payment is still waiting in it, and every beneficiary account is verified. Check that these are the right payments and amounts.")}</p>}
            </div>
          </div>}
          {!pending && <div className="document-requirement"><StatusBadge status={verificationOf(selected)} /><div>
            <strong>{t(verificationOf(selected) === "REJECTED" ? "Rejected by" : "Verified by")}: {(verificationOf(selected) === "REJECTED" ? selected.verification?.rejectedBy?.name : selected.verification?.verifiedBy?.name) || t(selected.verification?.legacy || !selected.verification?.status ? "Generated before verification was required" : "-")}</strong>
            {selected.verification?.reason && <p>{selected.verification.reason}</p>}
          </div></div>}
          {fileButtons(selected)}
          <div className="table-scroll bank-file-items">
            <table>
              <thead><tr><th>{t("Request")}</th><th>{t("Beneficiary")}</th><th>{t("Account")}</th><th>{t("Amount")}</th><th>{t("Status")}</th></tr></thead>
              <tbody>{(selected.items || []).map((item) => <tr key={item._id}>
                <td>{item.requestNumber}</td>
                <td><span className="primary-cell"><span>{item.supplierName}</span><small>{item.supplierIdentifier}</small></span></td>
                <td><span className="primary-cell"><span>{item.bankAccount?.bank || "-"} · {item.bankAccount?.accountNumber || "-"}</span><small>{item.bankAccount?.cci ? `CCI ${item.bankAccount.cci}` : ""}</small></span></td>
                <td className="amount">{money(item.currency, item.amount)}</td>
                <td>{t(itemStatusText[item.status] || item.status)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </div>}
      </Drawer>

      <ConfirmDialog
        open={decision === "verify"}
        title="Verify this bank file?"
        description={selected?.paymentDateWarning ? `${t("Treasury can then download it and send it to the bank.")} ${t(warningText[selected.paymentDateWarning])}` : "Treasury can then download it and send it to the bank."}
        details={selected ? [{ label: "Batch", value: selected.batchNumber }, { label: "Payments", value: String(activeItems(selected).length) }, { label: "Total", value: money(selected.currency, selected.totalAmount) }, { label: "Payment date", value: formatDate(selected.paymentDate, language) }] : []}
        confirmLabel="Verify bank file"
        loading={processing}
        onClose={() => !processing && setDecision(null)}
        onConfirm={() => decide()}
      />
      <ConfirmDialog
        open={decision === "reject"}
        tone="danger"
        title="Reject this bank file?"
        description="The file is cancelled and its payments return to Treasury's queue, so Treasury can correct them and generate a new file. Treasury sees your reason."
        details={selected ? [{ label: "Batch", value: selected.batchNumber }, { label: "Payments", value: String(activeItems(selected).length) }] : []}
        inputLabel="Reason for rejection"
        inputRequired
        confirmLabel="Reject bank file"
        loading={processing}
        onClose={() => !processing && setDecision(null)}
        onConfirm={(reason) => decide(reason)}
      />
    </section>
  );
}

import {
  AlertTriangle,
  Ban,
  Boxes,
  Eye,
  FileDiff,
  RefreshCw
} from "lucide-react";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import SupplierCreditsPanel from "../components/SupplierCreditsPanel.jsx";
import { useToast } from "../context/ToastContext.jsx";

import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  Link
} from "react-router-dom";

import api from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import DeepLinkNotice from "../components/DeepLinkNotice.jsx";
import PaymentTermsSummary from "../components/PaymentTermsSummary.jsx";
import { paymentTermsSummary } from "../../../shared/paymentTerms.mjs";
import Drawer from "../components/Drawer.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";

import {
  useLanguage
} from "../context/LanguageContext.jsx";

import useDeepLink from "../hooks/useDeepLink.js";
import usePaginatedResource from "../hooks/usePaginatedResource.js";

import {
  flowTypes
} from "../utils/options.js";

import { formatCurrency, formatDate, formatDateTime } from "../utils/formatters.js";

const dateText = (
  value
) =>
  value
    ? formatDate(value)
    : "-";

export default function AccountsPayable() {
  const {
    t,
    language
  } =
    useLanguage();

  const money = (currency, value) => formatCurrency(value, currency || "PEN", language);

  const { notify } = useToast();
  const [cancelTarget, setCancelTarget] = useState(null);
  const [noteTarget, setNoteTarget] = useState(null);
  const [noteFiles, setNoteFiles] = useState({ xml: null, pdf: null });
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState("");

  const cancelPayable = (row) => { setActionError(""); setCancelTarget(row); };

  async function confirmCancel(reason) {
    setProcessing(true);
    setActionError("");
    try {
      await api.post(`/accounting/accounts-payable/${cancelTarget._id}/cancel`, { reason });
      notify("CXP cancelled. The reversal was posted, the Purchase Order balance restored and the voucher annulled.");
      setCancelTarget(null);
      payableTable.reload();
      creditTable.reload();
    } catch (err) {
      setActionError(err.message);
      setCancelTarget(null);
    } finally { setProcessing(false); }
  }

  function openNote(row) { setActionError(""); setNoteFiles({ xml: null, pdf: null }); setNoteTarget(row); }

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
      payableTable.reload();
      creditTable.reload();
    } catch (err) { setActionError(err.message); }
    finally { setProcessing(false); }
  }

  const [
    selected,
    setSelected
  ] =
    useState(null);

  // ?record=<CXP id> opens that CXP's details; ?request=<request id> lists the request's CXPs.
  const deepLink = useDeepLink(["record", "request"]);

  const payableTable =
    usePaginatedResource(
      "/accounting/accounts-payable",
      { fixedParams: deepLink.link, deepLink: deepLink.active }
    );

  const openedLink = useRef("");
  useEffect(() => {
    const row = deepLink.link.record && payableTable.rows.find((item) => String(item._id) === deepLink.link.record);
    if (!row || openedLink.current === deepLink.link.record) return;
    openedLink.current = deepLink.link.record;
    setSelected(row);
  }, [deepLink.link.record, payableTable.rows]);

  const creditTable = usePaginatedResource("/accounting/supplier-credits", { initialPageSize: 10 });

  const {
    rows,
    loading
  } =
    payableTable;

  const summary =
    useMemo(
      () => ({
        total:
          Number(
            payableTable
              .payload
              .summary
              ?.originalPEN ||
              0
          ),

        outstanding:
          Number(
            payableTable
              .payload
              .summary
              ?.outstandingPEN ||
              0
          ),

        paid:
          Number(
            payableTable
              .payload
              .summary
              ?.paidPEN ||
              0
          )
      }),
      [
        payableTable
          .payload
          .summary
      ]
    );

  return (
    <section>
      <PageHeader
        title="Accounts Payable"
        description="Review every invoice-level CXP independently, including A2 batch origin, Purchase Order balance, SUNAT result, payment priority, and bounced-payment status."
        actions={
          <button
            type="button"
            className="secondary-button"
            onClick={
              payableTable.reload
            }
            disabled={
              loading
            }
          >
            <RefreshCw
              className={
                loading
                  ? "spin"
                  : ""
              }
              size={16}
            />

            <span>
              {t(
                "Refresh"
              )}
            </span>
          </button>
        }
      />

      <Message type="error">
        {
          (noteTarget ? "" : actionError) || payableTable.error
        }
      </Message>

      {deepLink.active && <DeepLinkNotice title="Showing the CXP linked from your notification" missing={!loading && !rows.length} missingDescription="No CXP was found for this link." clearLabel="Show all CXP" onClear={deepLink.clear} />}

      <div className="stats-grid compact-stats">
        <StatCard
          label="CXP records"
          value={
            payableTable
              .pagination
              .total
          }
          tone="navy"
        />

        <StatCard
          label="Original amount"
          value={money(
            "PEN",
            summary.total
          )}
          tone="teal"
        />

        <StatCard
          label="Outstanding amount"
          value={money(
            "PEN",
            summary.outstanding
          )}
          tone="amber"
        />

        <StatCard
          label="Paid amount"
          value={money(
            "PEN",
            summary.paid
          )}
          tone="green"
        />
      </div>

      <div className="workspace-panel">
        <DataTable
          rows={rows}
          loading={loading}
          remote={
            payableTable.remote
          }
          filters={[
            {
              key:
                "status",

              label:
                "statuses",

              allLabel:
                "All statuses",

              options: [
                "OPEN",
                "SCHEDULED",
                "PAYMENT_FILE_CREATED",
                "PARTIALLY_PAID",
                "PAYMENT_BOUNCED",
                "PAID",
                "CANCELLED"
              ]
            },

            {
              key:
                "currency",

              label:
                "currencies",

              allLabel:
                "All currencies",

              options: [
                "PEN",
                "USD"
              ]
            },

            {
              key:
                "flowType",

              label:
                "tracks",

              allLabel:
                "All tracks",

              options:
                flowTypes
            },

            {
              key:
                "paymentPriority",

              label:
                "priorities",

              allLabel:
                "All priorities",

              options: [
                "NORMAL",
                "PRIORITY"
              ]
            }
          ]}
          searchPlaceholder="Search request, supplier, voucher, Purchase Order, or bank batch..."
          emptyTitle="No CXP records yet"
          emptyDescription="A CXP is created for each invoice once Accounting processes it."
          emptyAction={{ label: "Accounting Entries", to: "/accounting" }}
          rowActions={(
            row
          ) => [
            {
              label:
                "View CXP details",

              primary: true,

              icon:
                Eye,

              onClick:
                () =>
                  setSelected(
                    row
                  )
            },
            ...(row.sunatVoucher && row.status !== "CANCELLED" ? [{
              label: "Register credit/debit note",
              icon: FileDiff,
              onClick: () => openNote(row)
            }] : []),
            // The server refuses cancellation once notes, credits or the SPOT deposit were applied.
            ...(["OPEN", "SCHEDULED"].includes(row.status) && !row.adjustments?.length && !row.supplierCreditApplications?.length && row.detraction?.status !== "DEPOSITED" ? [{
              label: "Cancel unpaid CXP",
              icon: Ban,
              tone: "danger",
              onClick: () => cancelPayable(row)
            }] : [])
          ]}
          columns={[
            {
              key:
                "request",

              type:
                "code",

              label:
                "Request",

              sortable:
                false,

              getValue:
                (row) =>
                  row.request
                    ?.requestNumber,

              render:
                (row) =>
                  row.request
                    ? (
                      <Link
                        to={`/requests/${row.request._id}`}
                      >
                        {
                          row.request.requestNumber
                        }
                      </Link>
                    )
                    : "-"
            },

            {
              key:
                "flowType",

              type:
                "code",

              label:
                "Track",

              getValue:
                (row) =>
                  row.flowType ||
                  row.request
                    ?.flowType,

              render:
                (row) => (
                  <StatusBadge
                    status={
                      row.flowType ||
                      row.request
                        ?.flowType
                    }
                  />
                )
            },

            {
              key:
                "supplier",

              type:
                "name",

              label:
                "Supplier",

              sortable:
                false,

              getValue:
                (row) =>
                  row.supplier
                    ?.legalName ||
                  row.supplier
                    ?.name,

              render:
                (row) => (
                  <div className="primary-cell">
                    <strong>
                      {
                        row.supplier
                          ?.legalName ||
                        row.supplier
                          ?.name ||
                        "UMA collaborator"
                      }
                    </strong>

                    <span>
                      {
                        row.supplierIdentifierSnapshot ||
                        "-"
                      }
                    </span>
                  </div>
                )
            },

            {
              key:
                "voucher",

              type:
                "code",

              label:
                "Voucher",

              sortable:
                false,

              getValue:
                (row) =>
                  `${
                    row.voucher
                      ?.voucherType ||
                    row.voucher
                      ?.documentType ||
                    ""
                  } ${
                    row.voucher
                      ?.series ||
                    ""
                  }-${
                    row.voucher
                      ?.number ||
                    ""
                  }`,

              render:
                (row) => (
                  <div className="primary-cell">
                    <strong>
                      {
                        row.voucher
                          ?.voucherType ||
                        row.voucher
                          ?.documentType ||
                        "-"
                      }{" "}
                      {
                        row.voucher
                          ?.series ||
                        ""
                      }
                      -
                      {
                        row.voucher
                          ?.number ||
                        ""
                      }
                    </strong>

                    <span>
                      {
                        row.sunatValidation?.status === "MANUAL_EXCEPTION" || row.sunatVoucher?.validationStatus === "MANUAL_EXCEPTION"
                          ? t("Manual SUNAT exception")
                          : row.sunatVoucher
                            ?.sunatStatus ||
                          row.sunatVoucher
                            ?.validationStatus ||
                          "-"
                      }
                    </span>
                  </div>
                )
            },

            {
              key:
                "purchaseOrder",

              type:
                "code",

              label:
                "Purchase Order",

              sortable:
                false,

              render:
                (row) =>
                  row.purchaseOrder
                    ? (
                      <div className="primary-cell">
                        <strong>
                          {
                            row.purchaseOrder.poNumber
                          }
                        </strong>

                        <span>
                          {
                            t(
                              "Remaining"
                            )
                          }
                          :{" "}
                          {
                            money(
                              row.currency,
                              row.purchaseOrder.remainingAmount
                            )
                          }
                        </span>
                      </div>
                    )
                    : "-"
            },

            {
              key:
                "batch",

              label:
                "Source",

              sortable:
                false,

              render:
                (row) =>
                  row.sourceBatch
                    ? (
                      <div className="primary-cell">
                        <strong>
                          {
                            row.sourceBatch.batchCode
                          }
                        </strong>

                        <span>
                          {
                            t(
                              "Mass upload"
                            )
                          }
                        </span>
                      </div>
                    )
                    : t(
                        "Individual"
                      )
            },

            {
              key:
                "currency",

              type:
                "code",

              label:
                "Currency"
            },

            {
              key:
                "outstandingAmount",

              type:
                "money",

              label:
                "Outstanding",

              align:
                "right",

              render:
                (row) => (
                  <strong>
                    {
                      money(
                        row.currency,
                        row.outstandingAmount
                      )
                    }
                  </strong>
                )
            },

            {
              key:
                "paymentPriority",

              label:
                "Priority",

              render:
                (row) => (
                  <StatusBadge
                    status={
                      row.paymentPriority ||
                      "NORMAL"
                    }
                  />
                )
            },

            {
              key:
                "status",

              type:
                "status",

              label:
                "Status",

              render:
                (row) => (
                  <StatusBadge
                    status={
                      row.status
                    }
                  />
                )
            },

            {
              key:
                "paymentTerms",

              label:
                "Payment Terms",

              sortable:
                false,

              getValue: (row) => paymentTermsSummary(row.paymentTermsSnapshot || {}, t),
              render: (row) => <PaymentTermsSummary terms={row.paymentTermsSnapshot} showAmounts={false} />
            },

            {
              key:
                "dueDate",

              type:
                "date",

              primary:
                true,

              label:
                "Due date",

              render:
                (row) =>
                  row.dueDate ? dateText(row.dueDate) : row.paymentTermsSnapshot?.paymentCondition ? <span className="cell-note">{t("Date to be confirmed under the agreed terms")}</span> : "-"
            }
          ]}
        />
      </div>

      <Drawer
        open={
          Boolean(
            selected
          )
        }
        title="Accounts payable record"
        description={
          selected
            ?.request
            ?.requestNumber ||
          ""
        }
        onClose={
          () =>
            setSelected(
              null
            )
        }
      >
        {
          selected && (
            <div className="detail-stack">
              {
                selected.status ===
                  "PAYMENT_BOUNCED" && (
                  <div className="alert-strip error">
                    <AlertTriangle
                      size={18}
                    />

                    <div>
                      <strong>
                        {
                          t(
                            "PAGO_REBOTADO"
                          )
                        }
                      </strong>

                      <p>
                        {
                          selected
                            .bouncedPayment
                            ?.reason ||
                          t(
                            "The bank rejected this transfer. A signed CCI letter is required before reprogramming."
                          )
                        }
                      </p>
                    </div>
                  </div>
                )
              }

              <dl className="detail-grid">
                <div>
                  <dt>
                    {
                      t(
                        "Status"
                      )
                    }
                  </dt>

                  <dd>
                    <StatusBadge
                      status={
                        selected.status
                      }
                    />
                  </dd>
                </div>

                <div>
                  <dt>
                    {
                      t(
                        "Track"
                      )
                    }
                  </dt>

                  <dd>
                    <StatusBadge
                      status={
                        selected.flowType ||
                        selected
                          .request
                          ?.flowType
                      }
                    />
                  </dd>
                </div>

                <div>
                  <dt>
                    {
                      t(
                        "Supplier"
                      )
                    }
                  </dt>

                  <dd>
                    {
                      selected
                        .supplier
                        ?.legalName ||
                      selected
                        .supplier
                        ?.name ||
                      "UMA collaborator"
                    }
                  </dd>
                </div>

                <div>
                  <dt>
                    {
                      t(
                        "Voucher"
                      )
                    }
                  </dt>

                  <dd>
                    {
                      selected
                        .voucher
                        ?.voucherType ||
                      selected
                        .voucher
                        ?.documentType ||
                      "-"
                    }{" "}
                    {
                      selected
                        .voucher
                        ?.series ||
                      ""
                    }
                    -
                    {
                      selected
                        .voucher
                        ?.number ||
                      ""
                    }
                  </dd>
                </div>

                <div>
                  <dt>
                    {
                      t(
                        "Original amount"
                      )
                    }
                  </dt>

                  <dd>
                    {
                      money(
                        selected.currency,
                        selected.originalAmount
                      )
                    }
                  </dd>
                </div>

                <div>
                  <dt>
                    {
                      t(
                        "Outstanding amount"
                      )
                    }
                  </dt>

                  <dd>
                    {
                      money(
                        selected.currency,
                        selected.outstandingAmount
                      )
                    }
                  </dd>
                </div>

                <div>
                  <dt>
                    {
                      t(
                        "PEN equivalent"
                      )
                    }
                  </dt>

                  <dd>
                    {
                      money(
                        "PEN",
                        selected.penEquivalent
                      )
                    }
                  </dd>
                </div>

                <div>
                  <dt>
                    {
                      t(
                        "Priority"
                      )
                    }
                  </dt>

                  <dd>
                    <StatusBadge
                      status={
                        selected.paymentPriority ||
                        "NORMAL"
                      }
                    />
                  </dd>
                </div>

                <div>
                  <dt>
                    {
                      t(
                        "Payment Terms"
                      )
                    }
                  </dt>

                  <dd>
                    <PaymentTermsSummary terms={selected.paymentTermsSnapshot} showAmounts={false} />
                  </dd>
                </div>

                <div>
                  <dt>
                    {
                      t(
                        "Due date"
                      )
                    }
                  </dt>

                  <dd>
                    {
                      selected.dueDate ? dateText(selected.dueDate) : selected.paymentTermsSnapshot?.paymentCondition ? t("Date to be confirmed under the agreed terms") : "-"
                    }
                  </dd>
                </div>

                <div>
                  <dt>
                    {
                      t(
                        "Payment Destination Snapshot"
                      )
                    }
                  </dt>

                  <dd>
                    {
                      selected
                        .bankAccountSnapshot
                        ?.bank
                        ? `${
                            selected.bankAccountSnapshot.bank
                          } · ${
                            t(
                              selected.bankAccountSnapshot.sourceType ||
                              "SUPPLIER"
                            )
                          }`
                        : "-"
                    }
                  </dd>
                </div>

                <div>
                  <dt>
                    {
                      t(
                        "Payment batch"
                      )
                    }
                  </dt>

                  <dd>
                    {
                      selected
                        .paymentBatch
                        ?.batchNumber ||
                      "-"
                    }
                  </dd>
                </div>

                <div>
                  <dt>
                    {
                      t(
                        "Purchase Order"
                      )
                    }
                  </dt>

                  <dd>
                    {
                      selected
                        .purchaseOrder
                        ?.poNumber ||
                      "-"
                    }
                  </dd>
                </div>

                <div>
                  <dt>
                    {
                      t(
                        "OC remaining balance"
                      )
                    }
                  </dt>

                  <dd>
                    {
                      selected.purchaseOrder
                        ? money(
                            selected.currency,
                            selected.purchaseOrder.remainingAmount
                          )
                        : "-"
                    }
                  </dd>
                </div>

                <div>
                  <dt>
                    {
                      t(
                        "Mass upload batch"
                      )
                    }
                  </dt>

                  <dd>
                    {
                      selected
                        .sourceBatch
                        ?.batchCode ||
                      "-"
                    }
                  </dd>
                </div>

                <div>
                  <dt>
                    {
                      t(
                        "SUNAT validation"
                      )
                    }
                  </dt>

                  <dd>
                    <StatusBadge
                      status={
                        selected
                          .sunatVoucher
                          ?.sunatStatus ||
                        selected
                          .sunatVoucher
                          ?.validationStatus ||
                        "NOT_REQUIRED"
                      }
                    />
                  </dd>
                </div>

                <div>
                  <dt>{t("Accounting period")}</dt>
                  <dd>{selected.accountingPeriod || "-"}</dd>
                </div>

                <div>
                  <dt>
                    {
                      t(
                        "Provision entry"
                      )
                    }
                  </dt>

                  <dd>
                    {
                      selected
                        .provisionJournal
                        ?.entryNumber ||
                      "-"
                    }
                  </dd>
                </div>

                <div>
                  <dt>
                    {
                      t(
                        "Payment entry"
                      )
                    }
                  </dt>

                  <dd>
                    {
                      selected
                        .paymentJournal
                        ?.entryNumber ||
                      "-"
                    }
                  </dd>
                </div>
              </dl>

              {
                selected.purchaseOrder && (
                  <div className="purchase-order-balance-grid">
                    <div>
                      <Boxes
                        size={17}
                      />

                      <span>
                        {
                          t(
                            "Original OC"
                          )
                        }
                      </span>

                      <strong>
                        {
                          money(
                            selected.currency,
                            selected.purchaseOrder.originalAmount
                          )
                        }
                      </strong>
                    </div>

                    <div>
                      <span>
                        {
                          t(
                            "Consumed"
                          )
                        }
                      </span>

                      <strong>
                        {
                          money(
                            selected.currency,
                            selected.purchaseOrder.consumedAmount
                          )
                        }
                      </strong>
                    </div>

                    <div>
                      <span>
                        {
                          t(
                            "Remaining"
                          )
                        }
                      </span>

                      <strong>
                        {
                          money(
                            selected.currency,
                            selected.purchaseOrder.remainingAmount
                          )
                        }
                      </strong>
                    </div>
                  </div>
                )
              }

              {(selected.sunatValidation?.status === "MANUAL_EXCEPTION" || selected.sunatVoucher?.manualOverride?.reason) && (
                <div className="alert-strip warning">
                  <AlertTriangle size={18} />
                  <div>
                    <strong>{t("Manual SUNAT exception")}</strong>
                    <p>{selected.sunatValidation?.manualException?.reason || selected.sunatVoucher?.manualOverride?.reason}</p>
                    <p>{t("Approved by Accounting on")} {formatDateTime(selected.sunatValidation?.manualException?.approvedAt || selected.sunatVoucher?.manualOverride?.overriddenAt)}{(selected.sunatValidation?.manualException?.evidenceReference || selected.sunatVoucher?.manualOverride?.evidenceReference) ? ` · ${t("Evidence")}: ${selected.sunatValidation?.manualException?.evidenceReference || selected.sunatVoucher?.manualOverride?.evidenceReference}` : ""}</p>
                  </div>
                </div>
              )}

              {selected.adjustments?.length > 0 && (
                <div className="detail-section">
                  <h3>{t("Credit and debit notes")}</h3>
                  <div className="compact-lines">
                    {selected.adjustments.map((item) => (
                      <div key={item._id || `${item.series}-${item.number}`}>
                        <span>
                          {t(item.kind === "CREDIT_NOTE" ? "Credit note" : "Debit note")} {item.series}-{item.number} · {money(selected.currency, item.amount)} · {t("Period")} {item.period}
                          {item.supplierCreditAmount > 0 ? ` · ${t("Supplier credit")}: ${money(selected.currency, item.supplierCreditAmount)}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                  {selected.invoiceAmount !== undefined && <p>{t("Original invoice amount")}: {money(selected.currency, selected.invoiceAmount)}</p>}
                </div>
              )}

              {selected.cancellation?.reason && (
                <div className="detail-section">
                  <h3>{t("Cancellation")}</h3>
                  <p>{selected.cancellation.reason}</p>
                  <p>{t("Reversal posted in period")} {selected.cancellation.period || "-"}</p>
                </div>
              )}

              {
                selected.bouncedPayment && (
                  <div className="detail-section">
                    <h3>
                      {
                        t(
                          "Bank rejection"
                        )
                      }
                    </h3>

                    <dl className="detail-grid">
                      <div>
                        <dt>
                          {
                            t(
                              "Reason"
                            )
                          }
                        </dt>

                        <dd>
                          {
                            selected.bouncedPayment.reason ||
                            "-"
                          }
                        </dd>
                      </div>

                      <div>
                        <dt>
                          {
                            t(
                              "Reference"
                            )
                          }
                        </dt>

                        <dd>
                          {
                            selected.bouncedPayment.bankReference ||
                            "-"
                          }
                        </dd>
                      </div>

                      <div>
                        <dt>
                          {
                            t(
                              "Reported"
                            )
                          }
                        </dt>

                        <dd>
                          {
                            selected.bouncedPayment.bouncedAt
                              ? formatDateTime(selected.bouncedPayment.bouncedAt)
                              : "-"
                          }
                        </dd>
                      </div>
                    </dl>
                  </div>
                )
              }

              <div className="detail-section">
                <h3>
                  {
                    t(
                      "CXP history"
                    )
                  }
                </h3>

                <div className="compact-lines">
                  {
                    (
                      selected.history ||
                      []
                    ).map(
                      (item) => (
                        <div
                          key={
                            item._id ||
                            `${item.status}-${item.at}`
                          }
                        >
                          <span>
                            {
                              formatDateTime(item.at)
                            }
                            {" - "}
                            {
                              item.comments ||
                              t(
                                item.status
                              )
                            }
                          </span>

                          <StatusBadge
                            status={
                              item.status
                            }
                          />
                        </div>
                      )
                    )
                  }
                </div>
              </div>
            </div>
          )
        }
      </Drawer>

      <SupplierCreditsPanel table={creditTable} onChanged={payableTable.reload} />

      <Drawer
        open={Boolean(noteTarget)}
        error={actionError}
        title="Register credit/debit note"
        description={noteTarget ? `${noteTarget.voucher?.series || ""}-${noteTarget.voucher?.number || ""} · ${noteTarget.request?.requestNumber || ""}` : ""}
        onClose={() => !processing && setNoteTarget(null)}
        footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setNoteTarget(null)}>{t("Cancel")}</button><button type="submit" form="adjustment-note-form" className="primary-button" disabled={processing || !noteFiles.xml}><FileDiff size={16} /><span>{t(processing ? "Processing..." : "Register note")}</span></button></>}
      >
        {noteTarget && (
          <form id="adjustment-note-form" className="form-grid" onSubmit={submitNote}>
            <p>{t("A credit note reduces this invoice's unpaid balance; if the invoice was already paid, the paid part becomes a supplier credit that can be recovered or applied to a future invoice. A debit note increases this invoice's payable. The note is linked to this invoice and must reference it if its XML has a reference.")}</p>
            <label className="field"><span>{t("Note XML")} *</span><input type="file" accept=".xml" required onChange={(event) => setNoteFiles({ ...noteFiles, xml: event.target.files?.[0] || null })} /></label>
            <label className="field"><span>{t("Note PDF")}</span><input type="file" accept=".pdf" onChange={(event) => setNoteFiles({ ...noteFiles, pdf: event.target.files?.[0] || null })} /></label>
          </form>
        )}
      </Drawer>

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="Cancel unpaid CXP?"
        description="The provision is reversed in the current open period, the budget and Purchase Order balance are restored, and the SUNAT voucher is annulled so a corrected invoice can be registered."
        details={cancelTarget ? [
          { label: "Voucher", value: `${cancelTarget.voucher?.series || ""}-${cancelTarget.voucher?.number || ""}` },
          { label: "Amount", value: money(cancelTarget.currency, cancelTarget.originalAmount) }
        ] : []}
        confirmLabel="Cancel CXP"
        cancelLabel="Keep CXP"
        tone="danger"
        inputLabel="Cancellation reason"
        inputRequired
        loading={processing}
        onClose={() => !processing && setCancelTarget(null)}
        onConfirm={confirmCancel}
      />
    </section>
  );
}

import {
  AlertTriangle,
  Ban,
  Boxes,
  Eye,
  RefreshCw
} from "lucide-react";

import {
  useMemo,
  useState
} from "react";

import {
  Link
} from "react-router-dom";

import api from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
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

  const cancelPayable = async (row) => {
    const reason = window.prompt(t("Reason for cancelling this unpaid CXP (required):"));
    if (!reason || !reason.trim()) return;
    await api.post(`/accounting/accounts-payable/${row._id}/cancel`, { reason: reason.trim() });
    payableTable.reload();
  };

  const [
    selected,
    setSelected
  ] =
    useState(null);

  const payableTable =
    usePaginatedResource(
      "/accounting/accounts-payable"
    );

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
          payableTable.error
        }
      </Message>

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
          rowActions={(
            row
          ) => [
            {
              label:
                "View CXP details",

              icon:
                Eye,

              onClick:
                () =>
                  setSelected(
                    row
                  )
            },
            ...(["OPEN", "SCHEDULED"].includes(row.status) ? [{
              label: "Cancel unpaid CXP",
              icon: Ban,
              onClick: () => cancelPayable(row)
            }] : [])
          ]}
          columns={[
            {
              key:
                "request",

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
                        row.sunatVoucher
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

              label:
                "Currency"
            },

            {
              key:
                "outstandingAmount",

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

              label:
                "Due date",

              render:
                (row) =>
                  row.dueDate ? dateText(row.dueDate) : row.paymentTermsSnapshot?.paymentCondition ? t("Date to be confirmed under the agreed terms") : "-"
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
    </section>
  );
}

import {
  Building2,
  Edit3,
  Eye,
  Plus,
  RefreshCw,
  ShieldCheck
} from "lucide-react";

import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  useNavigate,
  useSearchParams
} from "react-router-dom";

import api from "../api/client.js";

import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import Drawer from "../components/Drawer.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatusBadge from "../components/StatusBadge.jsx";

import SupplierDetail from "../components/suppliers/SupplierDetail.jsx";
import SupplierForm from "../components/suppliers/SupplierForm.jsx";

import {
  useAuth
} from "../context/AuthContext.jsx";

import {
  useLanguage
} from "../context/LanguageContext.jsx";

import {
  useToast
} from "../context/ToastContext.jsx";

import usePaginatedResource from "../hooks/usePaginatedResource.js";

function freshLookupState() {
  return {
    checked:
      false,

    loading:
      false,

    result:
      null,

    padron:
      null,

    representatives: {
      loading:
        false,

      data:
        null,

      error:
        ""
    },

    error:
      ""
  };
}

export default function Suppliers() {
  const {
    user
  } =
    useAuth();

  const {
    t
  } =
    useLanguage();

  const {
    notify
  } =
    useToast();

  const navigate =
    useNavigate();

  const [
    searchParams
  ] =
    useSearchParams();

  const canPropose =
    [
      "Admin",
      "Accounting",
      "Solicitor"
    ].includes(
      user.role
    );

  const canFinance =
    [
      "Admin",
      "Accounting"
    ].includes(
      user.role
    );

  const suppliers =
    usePaginatedResource(
      "/suppliers",
      {
        persistKey:
          "official-supplier-master",

        initialPageSize:
          10
      }
    );

  const [
    drawer,
    setDrawer
  ] =
    useState({
      open:
        false,

      mode:
        "view"
    });

  const [
    detail,
    setDetail
  ] =
    useState(null);

  const [
    readiness,
    setReadiness
  ] =
    useState(null);

  const [
    identifier,
    setIdentifier
  ] =
    useState("");

  const [
    lookup,
    setLookup
  ] =
    useState(
      freshLookupState
    );

  const [
    loadingDetail,
    setLoadingDetail
  ] =
    useState(false);

  const [
    saving,
    setSaving
  ] =
    useState(false);

  const [
    confirmation,
    setConfirmation
  ] =
    useState(null);

  const lookupSequence =
    useRef(0);

  useEffect(
    () => {
      if (
        searchParams.get(
          "mode"
        ) === "new" &&
        canPropose
      ) {
        startCreate();
      }
    },
    []
  );

  /*
   * After 11 RUC digits have been entered, automatically:
   *
   * 1. Check UMA Supplier Master.
   * 2. Check local SUNAT Padron.
   * 3. Open the form immediately.
   * 4. Retrieve SUNAT legal representatives in background.
   */
  useEffect(
    () => {
      if (
        drawer.mode !==
          "create" ||
        lookup.checked ||
        lookup.loading
      ) {
        return undefined;
      }

      const normalized =
        identifier.replace(
          /\D/g,
          ""
        );

      if (
        !/^\d{11}$/.test(
          normalized
        )
      ) {
        return undefined;
      }

      const timer =
        window.setTimeout(
          () => {
            runIdentifierLookup(
              normalized
            );
          },
          600
        );

      return () =>
        window.clearTimeout(
          timer
        );
    },
    [
      identifier,
      drawer.mode,
      lookup.checked,
      lookup.loading
    ]
  );

  const columns =
    useMemo(
      () => [
        {
          key:
            "supplierCode",

          label:
            "PRV Code",

          width:
            "110px",

          render:
            (row) => (
              <strong className="mono-reference">
                {
                  row
                    .supplierCode ||
                  "-"
                }
              </strong>
            )
        },

        {
          key:
            "legalName",

          label:
            "Supplier",

          render:
            (row) => (
              <div className="table-primary-cell">
                <strong>
                  {
                    row
                      .legalName ||
                    row
                      .name
                  }
                </strong>

                <span>
                  {
                    row
                      .commercialName &&
                    row
                      .commercialName !==
                      row
                        .legalName
                      ? row
                          .commercialName
                      : row
                          .rucDni
                  }
                </span>
              </div>
            )
        },

        {
          key:
            "rucDni",

          label:
            "RUC / DNI",

          width:
            "130px"
        },

        {
          key:
            "homologationStatus",

          label:
            "Homologation Status",

          width:
            "160px",

          render:
            (row) => (
              <StatusBadge
                status={
                  row
                    .homologationStatus
                }
              />
            )
        },

        {
          key:
            "financeReview",

          label:
            "Finance Review",

          width:
            "140px",

          getValue:
            (row) =>
              row
                .complianceReview
                ?.result ||
              "PENDING",

          render:
            (row) => (
              <StatusBadge
                status={
                  row
                    .complianceReview
                    ?.result ||
                  "PENDING"
                }
              />
            )
        },

        {
          key:
            "bankReadiness",

          label:
            "Bank Accounts",

          width:
            "130px",

          sortable:
            false,

          render:
            (row) => (
              <div className="table-primary-cell numeric-cell">
                <strong>
                  {
                    row
                      .activeBankAccountCount ||
                    0
                  }
                </strong>

                <span>
                  {
                    t(
                      "{count} verified"
                    ).replace(
                      "{count}",
                      row
                        .verifiedBankAccountCount ||
                        0
                    )
                  }
                </span>
              </div>
            )
        }
      ],
      [
        t
      ]
    );

  async function loadSupplier(
    id,
    mode = "view"
  ) {
    setDrawer({
      open:
        true,

      mode
    });

    setLoadingDetail(
      true
    );

    try {
      const [
        detailResponse,
        readinessResponse
      ] =
        await Promise.all([
          api.get(
            `/suppliers/${id}`
          ),

          api.get(
            `/suppliers/${id}/homologation-readiness`
          )
        ]);

      setDetail(
        detailResponse
          .data
          .data
      );

      setReadiness(
        readinessResponse
          .data
          .data
      );
    } catch (
      error
    ) {
      notify(
        error.message,
        "error"
      );

      setDrawer({
        open:
          false,

        mode:
          "view"
      });
    } finally {
      setLoadingDetail(
        false
      );
    }
  }

  async function refreshOpenSupplier() {
    if (
      !detail?._id
    ) {
      return;
    }

    const [
      detailResponse,
      readinessResponse
    ] =
      await Promise.all([
        api.get(
          `/suppliers/${detail._id}`
        ),

        api.get(
          `/suppliers/${detail._id}/homologation-readiness`
        )
      ]);

    setDetail(
      detailResponse
        .data
        .data
    );

    setReadiness(
      readinessResponse
        .data
        .data
    );
  }

  async function mutate(
    work,
    successMessage
  ) {
    if (
      saving
    ) {
      return;
    }

    setSaving(
      true
    );

    try {
      await work();

      await refreshOpenSupplier();

      suppliers.reload();

      notify(
        successMessage,
        "success"
      );

      return true;
    } catch (
      error
    ) {
      notify(
        error.message,
        "error"
      );

      return false;
    } finally {
      setSaving(
        false
      );
    }
  }

  function startCreate() {
    lookupSequence.current +=
      1;

    setIdentifier("");

    setLookup(
      freshLookupState()
    );

    setDetail(null);

    setReadiness(null);

    setDrawer({
      open:
        true,

      mode:
        "create"
    });
  }

  function changeIdentifier(
    value
  ) {
    const digitsOnly =
      String(
        value ||
        ""
      )
        .replace(
          /\D/g,
          ""
        )
        .slice(
          0,
          11
        );

    lookupSequence.current +=
      1;

    setIdentifier(
      digitsOnly
    );

    setLookup(
      freshLookupState()
    );
  }

  /*
   * Legal representative lookup is intentionally separate
   * from the local Padron call.
   *
   * That means SUNAT's web portal can be slow/unavailable
   * without preventing the supplier form from opening.
   */
  async function loadLegalRepresentatives(
    sequence,
    ruc,
    legalName
  ) {
    if (
      !legalName
    ) {
      return;
    }

    setLookup(
      (current) => ({
        ...current,

        representatives: {
          loading:
            true,

          data:
            null,

          error:
            ""
        }
      })
    );

    try {
      const response =
        await api.get(
          `/suppliers/consulta-ruc/${ruc}/representatives?legalName=${encodeURIComponent(
            legalName
          )}`
        );

      if (
        sequence !==
        lookupSequence.current
      ) {
        return;
      }

      setLookup(
        (current) => ({
          ...current,

          representatives: {
            loading:
              false,

            data:
              response.data,

            error:
              ""
          }
        })
      );
    } catch (
      error
    ) {
      if (
        sequence !==
        lookupSequence.current
      ) {
        return;
      }

      setLookup(
        (current) => ({
          ...current,

          representatives: {
            loading:
              false,

            data:
              null,

            error:
              error.message ||
              t(
                "SUNAT Consulta RUC could not be reached."
              )
          }
        })
      );
    }
  }

  async function runIdentifierLookup(
    value
  ) {
    const normalized =
      String(
        value ||
        ""
      ).replace(
        /\D/g,
        ""
      );

    if (
      !/^\d{8}$|^\d{11}$/.test(
        normalized
      )
    ) {
      setLookup({
        ...freshLookupState(),

        error:
          t(
            "Enter a valid 11-digit RUC or supported 8-digit DNI."
          )
      });

      return;
    }

    const sequence =
      ++lookupSequence.current;

    setLookup({
      ...freshLookupState(),

      loading:
        true
    });

    try {
      /*
       * STEP 1
       * Avoid duplicate suppliers.
       */
      const response =
        await api.get(
          `/suppliers/lookup/${normalized}`
        );

      if (
        sequence !==
        lookupSequence.current
      ) {
        return;
      }

      setIdentifier(
        response
          .data
          .normalizedIdentifier ||
        normalized
      );

      if (
        response
          .data
          .found
      ) {
        setLookup({
          checked:
            true,

          loading:
            false,

          result:
            response
              .data
              .data,

          padron:
            null,

          representatives: {
            loading:
              false,

            data:
              null,

            error:
              ""
          },

          error:
            ""
        });

        return;
      }

      /*
       * 8-digit DNI:
       * SUNAT Padron RUC lookup does not apply.
       */
      if (
        normalized.length !==
        11
      ) {
        setLookup({
          checked:
            true,

          loading:
            false,

          result:
            null,

          padron:
            null,

          representatives: {
            loading:
              false,

            data:
              null,

            error:
              ""
          },

          error:
            ""
        });

        return;
      }

      /*
       * STEP 2
       * Fast local SUNAT Padron lookup.
       */
      try {
        const padronResponse =
          await api.get(
            `/suppliers/padron/${normalized}`
          );

        if (
          sequence !==
          lookupSequence.current
        ) {
          return;
        }

        const padron =
          padronResponse
            .data;

        setLookup({
          checked:
            true,

          loading:
            false,

          result:
            null,

          padron,

          representatives: {
            loading:
              Boolean(
                padron
                  ?.found &&
                padron
                  ?.data
                  ?.legalName
              ),

            data:
              null,

            error:
              ""
          },

          error:
            ""
        });

        /*
         * STEP 3
         * Background Consulta RUC legal representative lookup.
         */
        if (
          padron
            ?.found &&
          padron
            ?.data
            ?.legalName
        ) {
          void loadLegalRepresentatives(
            sequence,
            normalized,
            padron
              .data
              .legalName
          );
        }

        return;
      } catch (
        padronError
      ) {
        if (
          sequence !==
          lookupSequence.current
        ) {
          return;
        }

        setLookup({
          checked:
            true,

          loading:
            false,

          result:
            null,

          padron: {
            found:
              false,

            ruc:
              normalized,

            message:
              padronError.message ||
              "SUNAT Padrón lookup could not be completed."
          },

          representatives: {
            loading:
              false,

            data:
              null,

            error:
              ""
          },

          error:
            ""
        });
      }
    } catch (
      error
    ) {
      if (
        sequence !==
        lookupSequence.current
      ) {
        return;
      }

      setLookup({
        ...freshLookupState(),

        error:
          error.message
      });
    }
  }

  async function lookupIdentifier(
    event
  ) {
    event.preventDefault();

    await runIdentifierLookup(
      identifier
    );
  }

  async function createSupplier(
    formData
  ) {
    setSaving(
      true
    );

    try {
      const response =
        await api.post(
          "/suppliers",
          formData
        );

      notify(
        "Supplier proposal created. No PRV was assigned yet.",
        "success"
      );

      suppliers.reload();

      const returnTo =
        searchParams.get(
          "returnTo"
        );

      if (
        returnTo?.startsWith(
          "/requests/"
        )
      ) {
        navigate(
          returnTo,
          {
            state: {
              createdSupplierId:
                response
                  .data
                  .data
                  ._id
            }
          }
        );

        return true;
      }

      await loadSupplier(
        response
          .data
          .data
          ._id,
        "view"
      );

      return true;
    } catch (
      error
    ) {
      notify(
        error.message,
        "error"
      );

      return false;
    } finally {
      setSaving(
        false
      );
    }
  }

  async function updateSupplier(
    formData
  ) {
    const success =
      await mutate(
        () =>
          api.patch(
            `/suppliers/${detail._id}/proposal`,
            formData
          ),

        "Supplier corrections saved and returned to the review queue."
      );

    if (
      success
    ) {
      setDrawer(
        (
          current
        ) => ({
          ...current,

          mode:
            "view"
        })
      );
    }

    return success;
  }

  function confirmAction(
    config
  ) {
    setConfirmation({
      ...config,

      loading:
        false
    });
  }

  async function runConfirmedAction() {
    const action =
      confirmation?.action;

    if (
      !action
    ) {
      return;
    }

    setConfirmation(
      (
        current
      ) => ({
        ...current,

        loading:
          true
      })
    );

    try {
      const completed =
        await action();

      if (
        completed !==
        false
      ) {
        setConfirmation(
          null
        );
      } else {
        setConfirmation(
          (
            current
          ) => ({
            ...current,

            loading:
              false
          })
        );
      }
    } catch {
      setConfirmation(
        (
          current
        ) => ({
          ...current,

          loading:
            false
        })
      );
    }
  }

  function requestFinanceReview(
    review
  ) {
    const descriptions = {
      APPROVED:
        "Records Finance approval. It does not assign a PRV until every homologation control passes.",

      OBSERVED:
        "Marks the supplier as observed and returns permitted proposal fields for correction.",

      REJECTED:
        "Rejects this onboarding record. No PRV will be assigned and the identifier cannot be recreated to bypass rejection.",

      PENDING:
        "Returns the Finance review to pending without homologating the supplier."
    };

    confirmAction({
      title:
        "Confirm Finance review",

      description:
        descriptions[
          review.result
        ],

      confirmLabel:
        "Record Finance review",

      tone:
        review.result ===
          "REJECTED"
          ? "danger"
          : "primary",

      details: [
        {
          label:
            "Result",

          value:
            t(
              review.result
            )
        },

        {
          label:
            "Supplier",

          value:
            detail
              .legalName ||
            detail
              .name
        }
      ],

      action:
        () =>
          mutate(
            () =>
              api.post(
                `/suppliers/${detail._id}/review`,
                review
              ),

            "Finance review recorded."
          )
    });
  }

  const rowActions =
    (row) => [
      {
        label:
          "View supplier record",

        icon:
          Eye,

        onClick:
          () =>
            loadSupplier(
              row._id,
              "view"
            )
      },

      {
        label:
          "Edit proposal",

        icon:
          Edit3,

        hidden:
          !row
            .permissions
            ?.canEditProposal,

        onClick:
          () =>
            loadSupplier(
              row._id,
              "edit"
            )
      },

      {
        label:
          "Open Finance review",

        icon:
          ShieldCheck,

        hidden:
          !canFinance,

        onClick:
          () =>
            loadSupplier(
              row._id,
              "view"
            )
      }
    ];

  const drawerTitle =
    drawer.mode ===
      "create"
      ? "New Supplier Proposal"
      : drawer.mode ===
          "edit"
        ? "Correct Supplier Proposal"
        : detail
            ?.legalName ||
          detail
            ?.name ||
          "Supplier Record";

  return (
    <div className="page-shell supplier-page">
      <PageHeader
        title="Supplier Master & Homologation"
        description="RCO-FOR-002 onboarding, SUNAT validations, protected evidence, Finance review, banking history and controlled PRV assignment."
        actions={
          <>
            <button
              type="button"
              className="secondary-button"
              onClick={
                suppliers.reload
              }
            >
              <RefreshCw
                size={16}
              />

              <span>
                {t(
                  "Refresh"
                )}
              </span>
            </button>

            {
              canPropose && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={
                    startCreate
                  }
                >
                  <Plus
                    size={16}
                  />

                  <span>
                    {t(
                      "New supplier"
                    )}
                  </span>
                </button>
              )
            }
          </>
        }
      />

      {
        suppliers.error && (
          <div
            className="inline-alert alert-error"
            role="alert"
          >
            {t(
              "Supplier records could not be loaded."
            )}
            {" "}
            {
              suppliers.error
            }
          </div>
        )
      }

      <DataTable
        tableId="official-supplier-master"
        caption="Supplier Master and Homologation"
        columns={
          columns
        }
        rows={
          suppliers.rows
        }
        loading={
          suppliers.loading
        }
        remote={
          suppliers.remote
        }
        rowActions={
          rowActions
        }
        onRowClick={
          (row) =>
            loadSupplier(
              row._id,
              "view"
            )
        }
        filters={[
          {
            key:
              "homologationStatus",

            label:
              "Homologation Status",

            allLabel:
              "All homologation statuses",

            options: [
              "PENDING_VALIDATION",
              "HOMOLOGATED",
              "OBSERVED",
              "REJECTED",
              "INACTIVE"
            ]
          },

          {
            key:
              "complianceReviewResult",

            label:
              "Finance Review",

            allLabel:
              "All Finance review results",

            options: [
              "PENDING",
              "APPROVED",
              "OBSERVED",
              "REJECTED"
            ]
          }
        ]}
        searchPlaceholder="Search by PRV, RUC, legal or commercial name..."
        exportable
        emptyDescription="No suppliers match the current search and filters."
      />

      <Drawer
        open={
          drawer.open
        }
        size="xlarge"
        title={
          drawerTitle
        }
        description={
          drawer.mode ===
          "create"
            ? "Enter an RUC. UMA checks duplicates, SUNAT Padrón and SUNAT legal representatives automatically."
            : "Official supplier onboarding and homologation record."
        }
        onClose={
          () =>
            !saving &&
            setDrawer({
              open:
                false,

              mode:
                "view"
            })
        }
      >
        {
          drawer.mode ===
            "create" &&
          !lookup.checked && (
            <div className="supplier-lookup-step">
              <div className="lookup-illustration">
                <Building2
                  size={22}
                />

                <div>
                  <strong>
                    {t(
                      "Enter supplier RUC"
                    )}
                  </strong>

                  <span>
                    {t(
                      "When 11 digits are entered, UMA automatically checks the Supplier Master, SUNAT Padrón and SUNAT legal representatives."
                    )}
                  </span>
                </div>
              </div>

              <form
                className="supplier-lookup-form"
                onSubmit={
                  lookupIdentifier
                }
              >
                <label className="field">
                  <span>
                    {t(
                      "RUC / identifier"
                    )}
                  </span>

                  <input
                    autoFocus
                    value={
                      identifier
                    }
                    onChange={
                      (event) =>
                        changeIdentifier(
                          event
                            .target
                            .value
                        )
                    }
                    inputMode="numeric"
                    maxLength="11"
                    placeholder={
                      t(
                        "Enter 11-digit RUC or supported 8-digit DNI"
                      )
                    }
                  />
                </label>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={
                    lookup.loading
                  }
                >
                  {
                    lookup.loading
                      ? t(
                          "Searching..."
                        )
                      : t(
                          "Search now"
                        )
                  }
                </button>
              </form>

              {
                lookup.loading && (
                  <div className="inline-alert alert-info">
                    <RefreshCw
                      size={17}
                      className="spin"
                    />

                    <span>
                      {t(
                        "Checking Supplier Master and SUNAT Padrón..."
                      )}
                    </span>
                  </div>
                )
              }

              {
                lookup.error && (
                  <div
                    className="inline-alert alert-error"
                    role="alert"
                  >
                    {
                      lookup.error
                    }
                  </div>
                )
              }
            </div>
          )
        }

        {
          drawer.mode ===
            "create" &&
          lookup.checked &&
          lookup.result && (
            <div className="supplier-existing-result">
              <div className="inline-alert alert-info">
                <Building2
                  size={18}
                />

                <div>
                  <strong>
                    {t(
                      "Supplier already exists"
                    )}
                  </strong>

                  <span>
                    {t(
                      "Open the existing record. A duplicate will not be created."
                    )}
                  </span>
                </div>
              </div>

              <dl className="supplier-detail-grid">
                <div>
                  <dt>
                    {t(
                      "Legal Name"
                    )}
                  </dt>

                  <dd>
                    {
                      lookup
                        .result
                        .legalName
                    }
                  </dd>
                </div>

                <div>
                  <dt>
                    {t(
                      "RUC / identifier"
                    )}
                  </dt>

                  <dd>
                    {
                      lookup
                        .result
                        .rucDni
                    }
                  </dd>
                </div>

                <div>
                  <dt>
                    {t(
                      "PRV Code"
                    )}
                  </dt>

                  <dd>
                    {
                      lookup
                        .result
                        .supplierCode ||
                      "-"
                    }
                  </dd>
                </div>

                <div>
                  <dt>
                    {t(
                      "Homologation Status"
                    )}
                  </dt>

                  <dd>
                    <StatusBadge
                      status={
                        lookup
                          .result
                          .homologationStatus
                      }
                    />
                  </dd>
                </div>
              </dl>

              <div className="supplier-form-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={
                    () => {
                      lookupSequence.current +=
                        1;

                      setIdentifier(
                        ""
                      );

                      setLookup(
                        freshLookupState()
                      );
                    }
                  }
                >
                  {t(
                    "Search another identifier"
                  )}
                </button>

                <button
                  type="button"
                  className="primary-button"
                  onClick={
                    () =>
                      loadSupplier(
                        lookup
                          .result
                          ._id,

                        lookup
                          .result
                          .permissions
                          ?.canEditProposal
                          ? "edit"
                          : "view"
                      )
                  }
                >
                  {t(
                    "Open existing supplier"
                  )}
                </button>
              </div>
            </div>
          )
        }

        {
          drawer.mode ===
            "create" &&
          lookup.checked &&
          !lookup.result && (
            <SupplierForm
              key={`create-${identifier}-${lookup.padron?.datasetDate || "no-padron"}`}
              identifier={
                identifier
              }
              padronLookup={
                lookup.padron
              }
              representativeLookup={
                lookup
                  .representatives
              }
              includeInitialBank
              loading={
                saving
              }
              onSubmit={
                createSupplier
              }
              onCancel={
                () => {
                  lookupSequence.current +=
                    1;

                  setDrawer({
                    open:
                      false,

                    mode:
                      "view"
                  });
                }
              }
            />
          )
        }

        {
          drawer.mode ===
            "edit" &&
          detail && (
            <SupplierForm
              key={`edit-${detail._id}-${detail.updatedAt}`}
              supplier={
                detail
              }
              loading={
                saving
              }
              onSubmit={
                updateSupplier
              }
              onCancel={
                () =>
                  setDrawer(
                    (
                      current
                    ) => ({
                      ...current,

                      mode:
                        "view"
                    })
                  )
              }
            />
          )
        }

        {
          drawer.mode ===
            "view" &&
          loadingDetail && (
            <div className="supplier-detail-loading">
              <span className="skeleton skeleton-line" />
              <span className="skeleton skeleton-line" />
              <span className="skeleton skeleton-line" />
            </div>
          )
        }

        {
          drawer.mode ===
            "view" &&
          detail &&
          !loadingDetail && (
            <SupplierDetail
              key={`${detail._id}-${detail.updatedAt}`}
              supplier={
                detail
              }
              readiness={
                readiness
              }
              loading={
                saving
              }
              onEdit={
                () =>
                  setDrawer(
                    (
                      current
                    ) => ({
                      ...current,

                      mode:
                        "edit"
                    })
                  )
              }
              onAddBank={
                (bank) =>
                  mutate(
                    () =>
                      api.post(
                        `/suppliers/${detail._id}/bank-accounts`,
                        bank
                      ),

                    "Pending bank account added without removing account history."
                  )
              }
              onReviewBank={
                (
                  account,
                  review
                ) =>
                  mutate(
                    () =>
                      api.post(
                        `/suppliers/${detail._id}/bank-accounts/${account._id}/verify`,
                        review
                      ),

                    "Bank verification and ownership review recorded."
                  )
              }
              onPreferred={
                (account) =>
                  mutate(
                    () =>
                      api.post(
                        `/suppliers/${detail._id}/bank-accounts/${account._id}/preferred`
                      ),

                    "Preferred bank account changed. Previous accounts were retained."
                  )
              }
              onDeactivateBank={
                (account) =>
                  confirmAction({
                    title:
                      "Deactivate bank account?",

                    description:
                      "The account becomes inactive and cannot be preferred. Its history remains available.",

                    confirmLabel:
                      "Deactivate account",

                    tone:
                      "danger",

                    details: [
                      {
                        label:
                          "Bank",

                        value:
                          account.bank
                      },

                      {
                        label:
                          "Account",

                        value:
                          account
                            .accountNumber
                      }
                    ],

                    action:
                      () =>
                        mutate(
                          () =>
                            api.delete(
                              `/suppliers/${detail._id}/bank-accounts/${account._id}`
                            ),

                          "Bank account deactivated and retained in history."
                        )
                  })
              }
              onTaxValidation={
                (
                  validation
                ) =>
                  mutate(
                    () =>
                      api.post(
                        `/suppliers/${detail._id}/taxpayer-validation`,
                        validation
                      ),

                    "Taxpayer validation source and result recorded."
                  )
              }
              onFinanceReview={
                requestFinanceReview
              }
              onHomologate={
                () =>
                  confirmAction({
                    title:
                      "Homologate supplier and assign PRV?",

                    description:
                      "This assigns one immutable PRV code, activates the supplier, and makes it available to the existing request workflow.",

                    confirmLabel:
                      "Homologate and assign PRV",

                    details: [
                      {
                        label:
                          "Supplier",

                        value:
                          detail
                            .legalName ||
                          detail
                            .name
                      },

                      {
                        label:
                          "Result",

                        value:
                          t(
                            "Active homologated supplier"
                          )
                      }
                    ],

                    action:
                      () =>
                        mutate(
                          () =>
                            api.post(
                              `/suppliers/${detail._id}/homologate`
                            ),

                          "Supplier homologated and immutable PRV assigned."
                        )
                  })
              }
              onDeactivateSupplier={
                () =>
                  confirmAction({
                    title:
                      "Deactivate supplier?",

                    description:
                      "The supplier and its active bank accounts become inactive. Historical requests, payments and audit records remain unchanged.",

                    confirmLabel:
                      "Deactivate supplier",

                    tone:
                      "danger",

                    details: [
                      {
                        label:
                          "Supplier",

                        value:
                          detail
                            .legalName ||
                          detail
                            .name
                      },

                      {
                        label:
                          "PRV Code",

                        value:
                          detail
                            .supplierCode ||
                          "-"
                      }
                    ],

                    action:
                      () =>
                        mutate(
                          () =>
                            api.delete(
                              `/suppliers/${detail._id}`
                            ),

                          "Supplier deactivated. Historical records were preserved."
                        )
                  })
              }
            />
          )
        }
      </Drawer>

      <ConfirmDialog
        open={
          Boolean(
            confirmation
          )
        }
        title={
          confirmation
            ?.title
        }
        description={
          confirmation
            ?.description
        }
        confirmLabel={
          confirmation
            ?.confirmLabel
        }
        tone={
          confirmation
            ?.tone
        }
        details={
          confirmation
            ?.details ||
          []
        }
        loading={
          confirmation
            ?.loading
        }
        onConfirm={
          runConfirmedAction
        }
        onClose={
          () =>
            !confirmation
              ?.loading &&
            setConfirmation(
              null
            )
        }
      />
    </div>
  );
}
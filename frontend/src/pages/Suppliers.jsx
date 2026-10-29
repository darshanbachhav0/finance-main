import useWorkDraft, { useDraftResume } from "../hooks/useWorkDraft.js";
import DraftPanel from "../components/DraftPanel.jsx";
import {
  AlertTriangle,
  ArrowLeft,
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
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";

import api from "../api/client.js";

import ConfirmDialog from "../components/ConfirmDialog.jsx";
import Message from "../components/Message.jsx";
import DataTable from "../components/DataTable.jsx";
import Drawer from "../components/Drawer.jsx";
import PageHeader from "../components/PageHeader.jsx";
import ExcelImport from "../components/ExcelImport.jsx";
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
import { formatDateTime } from "../utils/formatters.js";
import { PERMISSIONS, ROLES, hasRole, userCan } from "../utils/access.js";

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
    user,
    readOnly
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

  const location = useLocation();
  // A supplier record is its own page (/suppliers/:id); the list, notifications and resumed
  // drafts open it there. Proposing and correcting a supplier still happen in a panel.
  const { id: routeId } = useParams();
  const recordId = /^[a-f0-9]{24}$/i.test(routeId || "") ? routeId : "";
  const [actionError, setActionError] = useState("");

  // Every internal user can propose a supplier; the proposer's jefe approves it. The read-only
  // Super Admin only looks.
  const canPropose =
    !readOnly;

  // Everyone sees their own department's list; the Admin, the GAF, the Super Admin and the Auditor
  // see every department (backend supplierVisibilityService).
  const departmentScoped =
    !hasRole(user, [ROLES.TREASURY, ROLES.GAF, ROLES.AUDITOR]);
  const userArea =
    String(user.area || "").trim() || "General";

  // Accounting's task links open its work queues, which span every department: the proposals it
  // reviews (?awaitingMyApproval=true) and the bank accounts it verifies (?bankReview=pending).
  const workQueue =
    searchParams.get("awaitingMyApproval") === "true"
      ? "review"
      : searchParams.get("bankReview") === "pending" ? "bankReview" : "";

  const suppliers =
    usePaginatedResource(
      "/suppliers",
      {
        persistKey:
          workQueue ? `official-supplier-master:${workQueue}` : "official-supplier-master",

        fixedParams:
          workQueue === "review"
            ? { awaitingMyApproval: "true" }
            : workQueue === "bankReview" ? { bankReview: "pending" } : {},

        initialPageSize:
          10
      }
    );

  // The Admin can look at one department's list at a time.
  const [departmentOptions, setDepartmentOptions] = useState([]);
  useEffect(() => {
    if (departmentScoped) return;
    api.get("/suppliers/departments").then((response) => setDepartmentOptions(response.data.data || [])).catch(() => setDepartmentOptions([]));
  }, [departmentScoped]);

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

  // "Supplier not found? Propose it" on a request (?mode=new) opens a new proposal, never the
  // unfinished one shown before (it stays in Continue your work). The RUC of the request's
  // invoice (?ruc=) is entered for the user, so it is checked and SUNAT fills the form.
  const fromRequest = useRef(searchParams.get("mode") === "new");
  const proposedRuc = useRef(/^\d{11}$/.test(searchParams.get("ruc") || "") ? searchParams.get("ruc") : "");

  useEffect(
    () => {
      if (
        fromRequest.current &&
        canPropose
      ) {
        startCreate();
        supplierDraft.startNew();
      }
    },
    []
  );

  // ?record=<supplier id> (bank re-verification notifications and task links) opens that
  // supplier's record directly.
  const linkedSupplierId =
    /^[a-f0-9]{24}$/i.test(searchParams.get("record") || "")
      ? searchParams.get("record")
      : "";

  useEffect(
    () => {
      if (linkedSupplierId && !recordId) {
        navigate(`/suppliers/${linkedSupplierId}`, { replace: true });
      }
    },
    [
      linkedSupplierId
    ]
  );

  useEffect(
    () => {
      if (recordId) {
        loadSupplier(recordId, location.state?.mode || "view");
      }
    },
    [
      recordId
    ]
  );

  // A link to one section of the record (Treasury links to #supplier-section-banking-information)
  // opens it there, once per record.
  const scrolledToSection = useRef("");
  useEffect(() => {
    if (!location.hash || loadingDetail || detail?._id !== recordId || scrolledToSection.current === recordId) return;
    scrolledToSection.current = recordId;
    requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" }));
  }, [location.hash, loadingDetail, detail?._id, recordId]);

  /*
   * After 11 RUC digits have been entered, automatically:
   *
   * 1. Check UMA Supplier Master.
   * 2. Open the form after the duplicate check.
   * 3. Fill untouched fields from the local SUNAT Padron in background.
   * 4. Retrieve SUNAT legal representatives in background.
   */
  useEffect(
    () => {
      if (
        drawer.mode !==
          "create" ||
        lookup.checked ||
        lookup.loading ||
        lookup.error
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
          200
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
      lookup.loading,
      lookup.error
    ]
  );

  const columns =
    useMemo(
      () => [
        {
          key:
            "supplierCode",

          type:
            "code",

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

          type:
            "name",

          minWidth:
            "260px",

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
                  {
                    row.similarNameWarning?.possibleDuplicateOf && (
                      <AlertTriangle
                        size={13}
                        className="text-warning"
                        style={{ marginLeft: 6, verticalAlign: "middle" }}
                        title={t("Possible duplicate supplier name - review before homologating")}
                        aria-label={t("Possible duplicate supplier name - review before homologating")}
                      />
                    )
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

          type:
            "code",

          primary:
            true,

          label:
            "RUC / DNI",

          width:
            "130px"
        },

        {
          // The areas whose users see the supplier (none: every area). Only lists that span
          // departments show it (the Admin's and Accounting's work queues).
          key:
            "departments",

          label:
            "Areas",

          primary:
            true,

          sortable:
            false,

          render:
            (row) => row.departments?.length
              ? row.departments.join(", ")
              : t("Every area")
        },

        {
          key:
            "homologationStatus",

          type:
            "status",

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
            "jefeApproval",

          type:
            "status",

          label:
            "Provider review",

          width:
            "170px",

          getValue:
            (row) =>
              row
                .jefeApproval
                ?.decision ||
              "PENDING",

          // While it waits, who decides it: the proposer's jefe, whoever covers for them, or the Admin.
          render:
            (row) => (
              <div className="table-primary-cell">
                <StatusBadge
                  status={
                    row
                      .jefeApproval
                      ?.decision ||
                    "PENDING"
                  }
                />

                {
                  row.approval && (
                    <span>
                      {
                        row.approval.approver
                          ? `${t("Treasury")} / ${row.approval.approver.name}`
                          : t("Treasury")
                      }
                    </span>
                  )
                }
              </div>
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
    if (id !== recordId) {
      // Keeps draft-resume parameters (?workDraft=...) for the record page.
      navigate(`/suppliers/${id}${location.search}`, { state: { mode } });
      return;
    }
    if (mode === "edit") setEntry(null);
    setActionError("");
    setDrawer({
      open:
        mode !== "view",

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
      setActionError(error.message);

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
    setActionError("");

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
      setActionError(error.message);

      return false;
    } finally {
      setSaving(
        false
      );
    }
  }

  const [entry, setEntry] = useState(null);
  const supplierDraft = useWorkDraft({ scope: "supplier", recordId: drawer.mode === "edit" ? detail?._id || "new" : "new", title: "Supplier proposal", enabled: drawer.open && !loadingDetail && ["create", "edit"].includes(drawer.mode),
    value: { identifier, lookup: { ...lookup, loading: false, representatives: { ...lookup.representatives, loading: false } }, entry, checkedAt: lookup.checked ? lookup.checkedAt || null : null },
    restore: data => { if (!data) return; setIdentifier(data.identifier || ""); setLookup(data.lookup || freshLookupState()); setEntry(data.entry); }
  });
  useEffect(() => {
    if (!supplierDraft.ready || !supplierDraft.restoration || !lookup.checked || !/^\d{11}$/.test(identifier)) return;
    let active = true;
    const ruc = identifier;
    // Keep recovered fields visible; recheck duplicate status without resetting the form.
    api.get(`/suppliers/lookup/${ruc}`, { timeout: 10000 }).then(response => {
      if (active && response.data.found && drawer.mode === "create") setLookup(current => ({ ...current, result: response.data.data }));
    }).catch(() => {}); // The submission endpoint also enforces RUC uniqueness.
    if (!lookup.checkedAt || Date.now() - new Date(lookup.checkedAt).getTime() > 86400000) {
      api.get(`/suppliers/padron/${ruc}`, { timeout: 35000 }).then(response => {
        if (active) setLookup(current => ({ ...current, padron: response.data, checkedAt: new Date().toISOString() }));
      }).catch(() => {}); // Cached evidence remains labelled with its original date.
    }
    return () => { active = false; };
  }, [supplierDraft.restoration, supplierDraft.ready]);
  // Entered once the new draft is open, as if typed: the duplicate check and SUNAT lookup follow.
  useEffect(() => {
    if (!supplierDraft.ready || drawer.mode !== "create" || !proposedRuc.current) return;
    changeIdentifier(proposedRuc.current);
    proposedRuc.current = "";
  }, [supplierDraft.ready, drawer.mode]);
  // As on a new request, the address then names the proposal's saved draft, so a reload reopens
  // it instead of starting another. history.replaceState leaves the page as it is.
  useEffect(() => {
    if (!fromRequest.current || drawer.mode !== "create" || !supplierDraft.ready || !supplierDraft.session.revision) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("workDraft") === supplierDraft.session.id) return;
    params.delete("mode"); params.delete("ruc");
    params.set("workDraft", supplierDraft.session.id); params.set("workScope", "supplier"); params.set("workRecord", "new");
    window.history.replaceState(window.history.state, "", `${location.pathname}?${params}`);
  }, [drawer.mode, supplierDraft.ready, supplierDraft.session.revision]);
  // Retry only temporary failures, with no overlapping calls or updates after RUC/drawer changes.
  useEffect(() => {
    if (!drawer.open || drawer.mode !== "create" || !lookup.padron?.retryable || lookup.padron?.ruc !== identifier || !/^\d{11}$/.test(identifier)) return;
    let stopped = false;
    let timer;
    let failures = 0;
    const retry = async () => {
      try {
        const response = await api.get(`/suppliers/padron/${identifier}`, { timeout: 35000 });
        if (!stopped) {
          setLookup(current => ({ ...current, padron: response.data, checkedAt: new Date().toISOString() }));
          if (response.data?.found && response.data?.data?.legalName) {
            void loadLegalRepresentatives(lookupSequence.current, identifier, response.data.data.legalName, response.data.representativesLookup);
          }
        }
      } catch (error) {
        if (stopped) return;
        if (error.details?.retryable === false || error.details?.requiresConfiguration || (error.status && error.status < 500 && error.status !== 429)) {
          setLookup(current => ({ ...current, padron: { ...current.padron, retryable: false, message: error.message } }));
          return;
        }
        failures += 1;
        timer = setTimeout(retry, Math.min(60000, 15000 * (failures + 1)));
      }
    };
    timer = setTimeout(retry, 15000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [drawer.open, drawer.mode, identifier, lookup.padron?.retryable, lookup.padron?.ruc]);
  useDraftResume("supplier-bank", id => { void loadSupplier(id, "view"); });
  useDraftResume("supplier-tax-review", id => { void loadSupplier(id, "view"); });
  useDraftResume("supplier-finance-review", id => { void loadSupplier(id, "view"); });
  useDraftResume("supplier-bank-review", id => { void loadSupplier(id.split("~")[0], "view"); });
  useDraftResume("supplier", id => { if (!canPropose) return; if (id === "new") startCreate(); else void loadSupplier(id, "edit"); });

  function startCreate() {
    setEntry(null);
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

  // Back to the RUC step; what was filled belonged to the previous identifier.
  function searchAnotherIdentifier() {
    setEntry(null);
    changeIdentifier("");
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
    legalName,
    prefetched
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
      if (prefetched?.error) throw new Error(prefetched.error);
      const response =
        prefetched?.data ? { data: prefetched.data } : await api.get(
          `/suppliers/consulta-ruc/${ruc}/representatives?legalName=${encodeURIComponent(
            legalName
          )}`,
          { timeout: 35000 }
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

    // Start independent checks together; catch immediately to avoid an unhandled
    // rejection if the duplicate check finishes first or finds an existing supplier.
    const profilePromise = normalized.length === 11
      ? api.get(`/suppliers/padron/${normalized}`, { timeout: 35000 })
          .then(response => ({ response }), error => ({ error }))
      : null;
    try {
      /*
       * STEP 1
       * Avoid duplicate suppliers.
       */
      const response =
        await api.get(
          `/suppliers/lookup/${normalized}`,
          { timeout: 10_000 }
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
          checkedAt: new Date().toISOString(),
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
          checkedAt: new Date().toISOString(),
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
       * Open immediately after the duplicate check. Enrich the same form in
       * background so slow Padrón I/O never blocks manual entry or loses edits.
       */
      setLookup({
        ...freshLookupState(),
        checkedAt: new Date().toISOString(),
        checked: true,
        padron: { loading: true, ruc: normalized }
      });
      try {
        const profileResult = await profilePromise;
        if (profileResult.error) throw profileResult.error;
        const padronResponse = profileResult.response;

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
          checkedAt: new Date().toISOString(),
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
              .legalName,
            padron.representativesLookup
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
          checkedAt: new Date().toISOString(),
          checked:
            true,

          loading:
            false,

          result:
            null,

          padron: {
            unavailable: true,
            assistedAvailable: padronError.details?.assistedAvailable === true,
            retryable: padronError.details?.retryable !== false && !padronError.details?.requiresConfiguration && (!padronError.status || padronError.status >= 500 || padronError.status === 429),
            found:
              false,

            ruc:
              normalized,

            message:
              padronError.message ||
              "SUNAT automatic lookup could not be completed."
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
    setActionError("");

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

      await supplierDraft.complete();
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

      setDrawer({ open: false, mode: "view" });
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
      setActionError(error.message);

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
      await supplierDraft.complete();
      setDrawer({ open: false, mode: "view" });
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

  async function runConfirmedAction(
    input
  ) {
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
        await action(input);

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

  // Approval is one click. Observe and reject still need a reason.
  function requestApprovalDecision(
    decision
  ) {
    if (decision === "APPROVE") {
      return mutate(
        () => api.post(`/suppliers/${detail._id}/approval`, { decision }),
        "Supplier approved. It can now be used on requests."
      );
    }
    const definitions = {
      OBSERVE: {
        title: "Observe this supplier?",
        description: "The proposer corrects the stated observations and the supplier comes back to you.",
        confirmLabel: "Observe supplier",
        tone: "danger",
        inputLabel: "Observation comments",
        inputRequired: true,
        success: "Supplier observed and returned to the proposer."
      },
      REJECT: {
        title: "Reject this supplier?",
        description: "No PRV is assigned and the RUC/DNI cannot be proposed again to bypass the rejection.",
        confirmLabel: "Reject supplier",
        tone: "danger",
        inputLabel: "Rejection comments",
        inputRequired: true,
        success: "Supplier rejected with a preserved decision record."
      }
    };
    const definition = definitions[decision];

    confirmAction({
      ...definition,

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
            "Proposed By",

          value:
            detail
              .proposedBy
              ?.name ||
            "-"
        }
      ],

      action: (comments) =>
        mutate(
          () =>
            api.post(
              `/suppliers/${detail._id}/approval`,
              { decision, comments }
            ),
          definition.success
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
          "Review and decide",

        icon:
          ShieldCheck,

        hidden:
          !row
            .permissions
            ?.canApprove,

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

  const modals = (
    <>
      <Drawer
        open={
          drawer.open
        }
        error={actionError}
        size="xlarge"
        title={
          drawerTitle
        }
        description={
          drawer.mode ===
          "create"
            ? "Enter a RUC. UMA retrieves the supplier details automatically from SUNAT."
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
        {drawer.open && ["create", "edit"].includes(drawer.mode) && <DraftPanel busy={saving} draft={supplierDraft} onDiscard={() => setDrawer({ open: false, mode: "view" })} />}
        {drawer.mode === "create" && lookup.checkedAt && <p className="section-note">{t("SUNAT lookup last checked")}: {formatDateTime(lookup.checkedAt)}{lookup.checked && !lookup.result && <> · <button type="button" className="text-button" disabled={saving || !supplierDraft.ready} onClick={searchAnotherIdentifier}>{t("Use another RUC")}</button></>}</p>}
        <fieldset className="work-draft-fields" disabled={saving || (["create", "edit"].includes(drawer.mode) && (!supplierDraft.ready || supplierDraft.status === "conflict"))}>
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
                        "Checking Supplier Master for duplicates..."
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
                      lookup.result.otherDepartment
                        ? "It is registered for another area. Ask Treasury to share it with your area; a duplicate will not be created."
                        : "Open the existing record. A duplicate will not be created."
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
                    searchAnotherIdentifier
                  }
                >
                  {t(
                    "Search another identifier"
                  )}
                </button>

                {lookup.result.otherDepartment ? (
                <button
                  type="button"
                  className="primary-button"
                  onClick={
                    () =>
                      mutate(
                        () =>
                          api.post(
                            `/suppliers/${lookup.result._id}/access-request`
                          ),

                        "An Admin was asked to share this supplier with your area."
                      )
                  }
                >
                  {t(
                    "Ask to share it with my area"
                  )}
                </button>
                ) : (
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
                )}
              </div>
            </div>
          )
        }

        {
          drawer.mode ===
            "create" &&
          supplierDraft.ready &&
          lookup.checked &&
          !lookup.result && (
            <SupplierForm
              draftValue={entry}
              onDraftChange={setEntry}
              key={`create-${identifier}-${supplierDraft.restoration}`}
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
              onRetryRepresentatives={() => loadLegalRepresentatives(
                lookupSequence.current,
                identifier,
                lookup.padron?.data?.legalName || lookup.representatives?.data?.legalName || ""
              )}
              onVerifiedSunat={profile => {
                if (profile.ruc !== identifier) return;
                setLookup(current => ({ ...current, padron: profile, checkedAt: new Date().toISOString(), representatives: { loading: false, data: null, error: "" } }));
              }}
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
          supplierDraft.ready &&
          detail && (
            <SupplierForm
              draftValue={entry}
              onDraftChange={setEntry}
              key={`edit-${detail._id}-${detail.updatedAt}-${supplierDraft.restoration}`}
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

        </fieldset>
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
        inputLabel={
          confirmation
            ?.inputLabel
        }
        inputRequired={
          confirmation
            ?.inputRequired
        }
        error={actionError}
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
    </>
  );

  if (recordId) {
    return (
      <div className="page-shell supplier-page supplier-record-page">
        <PageHeader
          title={detail?._id === recordId ? detail.legalName || detail.name : "Supplier record"}
          description={detail?._id === recordId ? [detail.rucDni && `RUC ${detail.rucDni}`, detail.supplierCode].filter(Boolean).join(" · ") : ""}
          actions={<Link className="text-link back-link" to="/suppliers"><ArrowLeft size={16} aria-hidden="true" /><span>{t("Back to suppliers")}</span></Link>}
        />
        <Message type="error">{drawer.open || confirmation ? "" : actionError}</Message>
        <fieldset className="work-draft-fields" disabled={saving}>
        {
          loadingDetail && (
            <div className="supplier-detail-loading">
              <span className="skeleton skeleton-line" />
              <span className="skeleton skeleton-line" />
              <span className="skeleton skeleton-line" />
            </div>
          )
        }

        {
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
              onEdit={() => { setEntry(null); setActionError(""); setDrawer({ open: true, mode: "edit" }); }}
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
              onDecision={
                requestApprovalDecision
              }
              onDepartments={
                (departments) =>
                  mutate(
                    () =>
                      api.put(
                        `/suppliers/${detail._id}/departments`,
                        { departments }
                      ),

                    "Supplier areas updated."
                  )
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
        </fieldset>
        {modals}
      </div>
    );
  }

  return (
    <div className="page-shell supplier-page">
      <PageHeader
        title="Supplier Master & Homologation"
        description="RCO-FOR-002 onboarding, SUNAT validations, protected evidence, review by Accounting, banking history and controlled PRV assignment."
        actions={
          <>
            {!readOnly && userCan(user, PERMISSIONS.SUPPLIER_VALIDATE) && <ExcelImport kind="suppliers" onImported={() => suppliers.reload()} />}
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

      {
        // Which list this is: the user's department's, or one of Accounting's work queues.
        workQueue ? (
          <div
            className="inline-alert alert-info"
            role="status"
          >
            {t(
              workQueue === "review"
                ? "Suppliers waiting for your review, from every area. Once reviewed, they stay in their own area's list."
                : "Suppliers with a bank account waiting for your verification, from every area."
            )}
            {" "}
            <Link className="text-link" to="/suppliers">
              {t(departmentScoped ? "Back to my area's suppliers" : "Back to all suppliers")}
            </Link>
          </div>
        ) : departmentScoped && (
          <div
            className="inline-alert alert-info"
            role="status"
          >
            {t("Suppliers of your area: {area}. Everyone in your area sees the suppliers any of you register; other areas do not.").replace("{area}", userArea)}
          </div>
        )
      }

      <DataTable
        tableId="official-supplier-master"
        caption="Supplier Master and Homologation"
        columns={
          departmentScoped && !workQueue
            ? columns.filter((column) => column.key !== "departments")
            : columns
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
          ...(!departmentScoped && !workQueue
            ? [{
                key:
                  "department",

                label:
                  "Area",

                allLabel:
                  "All areas",

                options: [
                  { value: "__shared", label: "Shared with every area" },
                  ...departmentOptions.map((area) => ({ value: area, label: area }))
                ]
              }]
            : []),

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
          }
        ]}
        searchPlaceholder="Search by PRV, RUC, legal or commercial name..."
        exportable
        emptyTitle="No suppliers yet"
        emptyDescription={canPropose ? "Propose a supplier to start its RCO-FOR-002 homologation." : "Suppliers appear here once they are proposed for homologation."}
        emptyAction={canPropose ? { label: "New supplier", onClick: startCreate, icon: Plus } : undefined}
      />

      {modals}
    </div>
  );
}

import SectionNavigation from "../SectionNavigation.jsx";
import useWorkDraft, { useDraftResume } from "../../hooks/useWorkDraft.js";
import DraftPanel from "../DraftPanel.jsx";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  Edit3,
  FileCheck2,
  History,
  Landmark,
  MessageSquareWarning,
  Plus,
  Power,
  RefreshCw,
  Save,
  MapPin,
  ShieldCheck,
  Star,
  UserCheck,
  Users,
  X,
  XCircle
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import api from "../../api/client.js";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { LIMA_TIME_ZONE } from "../../../../shared/businessCalendar.mjs";
import EmptyState from "../EmptyState.jsx";
import ProtectedAssetButton from "../ProtectedAssetButton.jsx";
import StatusBadge from "../StatusBadge.jsx";
import BankAccountFields from "./BankAccountFields.jsx";
import { bankAccountPayload, bankAccountProblems, emptyBankAccount } from "../../utils/bankAccounts.js";
import { bankDisplayName } from "../../../../shared/peruBanks.mjs";

function displayDate(value, language) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat(language === "es" ? "es-PE" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: LIMA_TIME_ZONE }).format(date);
}

function sectionId(title) { return `supplier-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`; }

function Section({ icon: Icon, title, status, actions, children }) {
  const { t } = useLanguage();
  if (/Audit \/ History/.test(title)) return <details className="supplier-detail-section" id={sectionId(title)}><summary>{t(title)}</summary>{children}</details>;
  return (
    <section className="supplier-detail-section" id={sectionId(title)}>
      <header>
        <span className="section-icon"><Icon size={17} aria-hidden="true" /></span>
        <div><h3>{t(title)}</h3>{status && <small>{t(status)}</small>}</div>
        {actions && <div className="section-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

function DetailGrid({ children }) {
  return <dl className="supplier-detail-grid">{children}</dl>;
}

function Detail({ label, value, children }) {
  const { t } = useLanguage();
  return <div><dt>{t(label)}</dt><dd>{children || value || "-"}</dd></div>;
}

function Contact({ title, value }) {
  const { t } = useLanguage();
  return (
    <div className="contact-summary">
      <strong>{t(title)}</strong>
      <span>{value?.name || "-"}</span>
      <small>{[value?.position, value?.phone, value?.email].filter(Boolean).join(" · ") || "-"}</small>
    </div>
  );
}

export default function SupplierDetail({
  supplier,
  readiness,
  loading,
  onEdit,
  onAddBank,
  onReviewBank,
  onPreferred,
  onDeactivateBank,
  onTaxValidation,
  onDecision,
  onDeactivateSupplier,
  onDepartments
}) {
  const { t, language } = useLanguage();
  const [showBankForm, setShowBankForm] = useState(false);
  const [reviewAccount, setReviewAccount] = useState(null);
  const bankReviewRef = useRef(null);
  useEffect(() => {
    if (!reviewAccount) return;
    const frame = requestAnimationFrame(() => {
      bankReviewRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
      bankReviewRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [reviewAccount]);
  const [bankForm, setBankForm] = useState(() => emptyBankAccount(supplier.legalName || supplier.name || "", supplier.currency || "PEN"));
  const [bankErrors, setBankErrors] = useState({});
  // Areas that see this supplier in their list (none: every area). Accounting / Admin choose them.
  const [editingAreas, setEditingAreas] = useState(false);
  const [areaOptions, setAreaOptions] = useState([]);
  const [areas, setAreas] = useState(supplier.departments || []);
  useEffect(() => {
    if (!editingAreas || areaOptions.length) return;
    api.get("/suppliers/departments").then((response) => setAreaOptions(response.data.data || [])).catch(() => setAreaOptions([]));
  }, [editingAreas]);
  async function saveAreas(event) {
    event.preventDefault();
    if (await onDepartments?.(areas)) setEditingAreas(false);
  }
  const [bankReview, setBankReview] = useState({ verificationStatus: "VERIFIED", ownershipResult: "MATCH", comments: "" });
  const [taxForm, setTaxForm] = useState({ valid: true, returnedIdentifier: supplier.rucDni || "", returnedLegalName: supplier.legalName || supplier.name || "", comments: "" });
  const permissions = supplier.permissions || {};
  // SPOT: Banco de la Nacion detracciones account, maintained by Accounting/Admin.
  const [detractionAccount, setDetractionAccount] = useState(supplier.detractionAccount?.accountNumber || "");
  const [detractionMessage, setDetractionMessage] = useState("");
  async function saveDetractionAccount(event) {
    event.preventDefault();
    try {
      const response = await api.put(`/treasury/suppliers/${supplier._id}/detraction-account`, { accountNumber: detractionAccount });
      setDetractionAccount(response.data?.data?.detractionAccount?.accountNumber || detractionAccount);
      setDetractionMessage(t("Detracciones account saved."));
    } catch (error) {
      setDetractionMessage(error.message);
    }
  }
  // Fix 1: the possible-duplicate-name signal is shown as its own alert in Legal Identification below
  // (it needs the matched supplier's name), so it is excluded here to avoid showing it twice.
  const riskWarnings = (supplier.riskyDeclarations || readiness?.warnings || []).filter((warning) => warning.code !== "POSSIBLE_DUPLICATE_SUPPLIER_NAME");
  const documents = supplier.documents || [];
  const docKinds = new Set(documents.map((item) => item.kind));
  const hasDeclarations = ["stateSanctions", "complianceModel"].some((key) => ["YES", "NO"].includes(supplier.declarations?.[key]?.answer));
  const provider = supplier.sunatProvider || { state: "NOT_CONFIGURED", configured: false };
  const approvalDisabledReason = readiness?.issues?.[0]?.message || "";
  // Only the proposer's jefe approves. While the supplier waits, approval names who decides it now.
  const jefeApproval = supplier.jefeApproval || {};
  const onBehalfOf = (person) => (person?.name ? ` (${t("on behalf of {name}").replace("{name}", person.name)})` : "");
  const waitingOn = supplier.approval
    ? supplier.approval.approver ? `${supplier.approval.approver.name}${onBehalfOf(supplier.approval.coveringFor)}` : t("Admin (no jefe available)")
    : "";
  const decidedBy = jefeApproval.decidedBy?.name ? `${jefeApproval.decidedBy.name}${onBehalfOf(jefeApproval.coveringFor)}` : "";
  // Fix 2: homologation is only valid for a configurable period (default 12 months) from when it was granted.
  const homologationExpired = supplier.homologationStatus === "HOMOLOGATED"
    && Boolean(supplier.homologationValidUntil)
    && new Date(supplier.homologationValidUntil).getTime() < Date.now();

  // Drafts saved before the bank list grew kept "currency" instead of "accountCurrency".
  const bankDraft = useWorkDraft({ scope: "supplier-bank", recordId: supplier._id, title: "Supplier bank account", enabled: showBankForm, value: bankForm, restore: (saved) => setBankForm({ ...emptyBankAccount(supplier.legalName || supplier.name || "", supplier.currency || "PEN"), ...saved, accountCurrency: saved?.accountCurrency || saved?.currency || supplier.currency || "PEN" }) });
  const taxDraft = useWorkDraft({ scope: "supplier-tax-review", recordId: supplier._id, title: "Supplier taxpayer review", enabled: permissions.canValidateTaxpayer && provider.state === "MANUAL", value: taxForm, restore: setTaxForm, sourceVersion: supplier.updatedAt });
  const bankReviewDraft = useWorkDraft({ scope: "supplier-bank-review", recordId: `${supplier._id}~${reviewAccount?._id || "new"}`, title: "Supplier bank review", enabled: permissions.canVerifyBanking && Boolean(reviewAccount), value: bankReview, restore: setBankReview, sourceVersion: reviewAccount?.updatedAt });
  useDraftResume("supplier-bank-review", id => { const account = supplier.bankAccounts?.find(row => row._id === id.split("~")[1]); if (account) setReviewAccount(account); });
  useDraftResume("supplier-bank", () => setShowBankForm(true));

  async function submitBank(event) {
    event.preventDefault();
    if (!bankDraft.ready || bankDraft.status === "conflict") return;
    const problems = bankAccountProblems(bankForm);
    setBankErrors(problems);
    if (Object.keys(problems).length) return;
    if (await onAddBank(bankAccountPayload(bankForm))) { await bankDraft.complete(); setShowBankForm(false); setBankForm(emptyBankAccount(supplier.legalName || supplier.name || "", supplier.currency || "PEN")); }
  }

  async function submitBankReview(event) {
    event.preventDefault();
    if (!bankReviewDraft.ready || bankReviewDraft.status === "conflict") return;
    if (await onReviewBank(reviewAccount, bankReview)) { await bankReviewDraft.complete(); setReviewAccount(null); }
  }

  async function submitTax(event) {
    event.preventDefault();
    if (!taxDraft.ready || taxDraft.status === "conflict") return;
    if (await onTaxValidation(taxForm)) await taxDraft.complete();
  }

  return (
    <div className="supplier-detail-stack">
      <div className="supplier-summary-strip">
        <div>
          <span>{t("ERP Supplier Code")}</span>
          <strong>{supplier.supplierCode || t("Pending data migration")}</strong>
        </div>
        <div>
          <span>{t("Homologation Status")}</span>
          <StatusBadge status={supplier.homologationStatus} />
          {supplier.homologationStatus === "HOMOLOGATED" && supplier.homologationValidUntil && (
            <small className={homologationExpired ? "text-danger" : undefined}>
              {t(homologationExpired ? "Expired on" : "Valid until")} {displayDate(supplier.homologationValidUntil, language)}
            </small>
          )}
        </div>
        <div>
          <span>{t("Jefe approval")}</span>
          <StatusBadge status={jefeApproval.decision || "PENDING"} />
          {waitingOn && <small>{t("Waiting for")}: {waitingOn}</small>}
        </div>
        <div className="supplier-summary-actions">
          {permissions.canEditProposal && <button type="button" className="secondary-button" onClick={onEdit}><Edit3 size={16} /><span>{t("Edit proposal")}</span></button>}
          {permissions.canDeactivate && <button type="button" className="danger-button ghost-danger" onClick={onDeactivateSupplier} disabled={loading}><Power size={16} /><span>{t("Deactivate supplier")}</span></button>}
        </div>
      </div>

      <SectionNavigation className="supplier-section-nav" aria-label={t("Supplier sections")}>
        {["Legal Identification", "Areas", "Banking Information", "Homologation Readiness", "Jefe Approval", "Audit / History"].map((title) => <a key={title} href={`#${sectionId(title)}`}>{t(title)}</a>)}
      </SectionNavigation>
      {permissions.canApprove && <div className="record-next-action"><div><strong>{t("Next step")}</strong><p>{t(readiness?.valid ? "Review the supplier and approve, observe or reject it." : "Some requirements are missing. Observe the supplier so the proposer completes them, or reject it.")}</p></div><a className="secondary-button" href={`#${sectionId("Jefe Approval")}`}>{t("Decide")}</a></div>}

      <Section icon={Building2} title="Legal Identification" status={supplier.proposalJustification ? "Registration justification recorded" : "Registration justification missing"}>
        {supplier.similarNameWarning?.possibleDuplicateOf && (
          <div className="inline-alert alert-warning">
            <AlertTriangle size={16} />
            <div>
              <strong>{t("Possible duplicate supplier name")}</strong>
              <span>{t("This legal name closely matches an existing supplier with a different RUC/DNI")}: {supplier.similarNameWarning.matchedLegalName || supplier.similarNameWarning.possibleDuplicateOf?.legalName || supplier.similarNameWarning.possibleDuplicateOf?.name}. {t("This is advisory only and does not block any action - confirm these are not the same entity before homologating.")}</span>
            </div>
          </div>
        )}
        <DetailGrid>
          <Detail label="RUC / identifier" value={supplier.rucDni} />
          <Detail label="Person Type" value={t(supplier.personType || "Not recorded")} />
          <Detail label="Legal Name" value={supplier.legalName || supplier.name} />
          <Detail label="Commercial Name" value={supplier.commercialName} />
          <Detail label="Fiscal Address" value={supplier.fiscalAddress || supplier.taxAddress} />
          <Detail label="Location" value={[supplier.location?.district, supplier.location?.province, supplier.location?.department].filter(Boolean).join(", ")} />
          <Detail label="Website" value={supplier.website} />
          <Detail label="Legal Representative" value={supplier.legalRepresentative} />
          <Detail label="Representative document" value={[supplier.legalRepresentativeDocument?.type, supplier.legalRepresentativeDocument?.number].filter(Boolean).join(" ")} />
          <Detail label="Proposed By" value={supplier.proposedBy?.name} />
          <Detail label="Proposed At" value={displayDate(supplier.proposedAt || supplier.createdAt, language)} />
          <Detail label="Registration justification" value={supplier.proposalJustification} />
        </DetailGrid>
      </Section>

      <Section
        icon={MapPin}
        title="Areas"
        status={supplier.departments?.length ? "Only these areas see the supplier in their list" : "Shared with every area"}
        actions={permissions.canManageDepartments && !editingAreas && <button type="button" className="secondary-button compact-button" onClick={() => { setAreas(supplier.departments || []); setEditingAreas(true); }}><Edit3 size={15} /><span>{t("Change areas")}</span></button>}
      >
        {!editingAreas && <div className="area-tags">{supplier.departments?.length ? supplier.departments.map((area) => <span className="area-tag" key={area}>{area}</span>) : <span className="muted-text">{t("Every area")}</span>}</div>}
        {editingAreas && <form className="supplier-inline-form" onSubmit={saveAreas}>
          <fieldset className="area-choices">
            <legend>{t("Areas that see this supplier")}</legend>
            {[...new Set([...areaOptions, ...areas])].map((area) => <label key={area} className="checkbox-row"><input type="checkbox" checked={areas.includes(area)} onChange={(event) => setAreas((current) => event.target.checked ? [...current, area] : current.filter((item) => item !== area))} /><span>{area}</span></label>)}
            {!areaOptions.length && !areas.length && <small className="muted-text">{t("Loading areas...")}</small>}
          </fieldset>
          <p className="section-note">{t("With no area chosen, every area sees the supplier.")}</p>
          <div className="inline-form-actions"><button type="button" className="secondary-button" onClick={() => setEditingAreas(false)}>{t("Cancel")}</button><button type="submit" className="primary-button" disabled={loading}><Save size={15} /><span>{t("Save areas")}</span></button></div>
        </form>}
      </Section>

      <Section icon={Users} title="Contacts" status="Commercial and operations contacts remain separate">
        <div className="contact-summary-grid">
          <Contact title="Commercial Contact" value={supplier.commercialContact} />
          <Contact title="Operations / Logistics Contact" value={supplier.operationsContact} />
        </div>
      </Section>

      <Section icon={Building2} title="Commercial Conditions">
        <DetailGrid>
          <Detail label="Billing Currency" value={supplier.currency} />
          {supplier.paymentTerms?.option && <Detail label="Legacy supplier terms (fallback)" value={`${t(supplier.paymentTerms.option)} · ${supplier.paymentTerms.days || 0} ${t("days")}`} />}
          <Detail label="Goods / services profile" value={supplier.goodsServicesProfile || supplier.supplierType} />
          <Detail label="Delivery Method" value={supplier.delivery?.method ? t(supplier.delivery.method) : "-"} />
        </DetailGrid>
      </Section>

      <Section
        icon={Landmark}
        title="Banking Information"
        status={permissions.canViewFullBankData ? "Sensitive data visible for your role" : "Sensitive account values are masked"}
        actions={permissions.canAddBankAccount && <button type="button" className="secondary-button compact-button" onClick={() => setShowBankForm((current) => !current)}><Plus size={15} /><span>{t("Add bank account")}</span></button>}
      >
        {showBankForm && (
          <DraftPanel busy={loading} draft={bankDraft} onDiscard={() => setShowBankForm(false)}><form className="supplier-inline-form" onSubmit={submitBank}>
            {/* "Detraction" is not offered here: the Banco de la Nación detracciones account is kept below. */}
            <BankAccountFields value={bankForm} onChange={(patch) => { setBankErrors((current) => { const next = { ...current }; Object.keys(patch).forEach((key) => delete next[key]); return next; }); setBankForm((current) => ({ ...current, ...patch })); }} errors={bankErrors} />
            <div className="inline-form-actions"><button type="button" className="secondary-button" onClick={() => setShowBankForm(false)}>{t("Cancel")}</button><button type="submit" className="primary-button" disabled={loading}><Save size={15} /><span>{t("Add pending account")}</span></button></div>
          </form></DraftPanel>
        )}

        <div className="supplier-bank-list">
          {(supplier.bankAccounts || []).map((account) => (
            <article className={`supplier-bank-row${account.active ? "" : " is-inactive"}`} key={account._id}>
              <div className="bank-main"><strong>{bankDisplayName(account.bank, account.bankOtherName)} · {t(account.accountType === "SAVINGS" ? "Savings account" : account.accountType === "CURRENT" ? "Current account" : account.accountType)}</strong><span>{account.accountNumber || "-"}</span><small>{t("CCI")}: {account.cci || "-"}</small></div>
              <div className="bank-meta"><span>{account.currency}</span><StatusBadge status={account.verificationStatus} /><StatusBadge status={account.ownershipResult} />{account.preferred && <span className="badge badge-info"><Star size={12} />{t("Preferred")}</span>}</div>
              <div className="bank-review-meta"><small>{t("Account holder")}: {account.accountHolderName || "-"}</small><small>{t("Verification source")}: {account.verificationSource || t("Not reviewed")}</small><small>{displayDate(account.verifiedAt || account.validFrom, language)}</small></div>
              {permissions.canVerifyBanking && account.active && (
                <div className="bank-actions">
                  <button type="button" className="secondary-button compact-button" aria-expanded={reviewAccount?._id === account._id} aria-controls="supplier-bank-review-panel" title={t("Review bank account")} aria-label={t("Review bank account")} onClick={() => { setReviewAccount(account); setBankReview({ verificationStatus: account.verificationStatus === "PENDING" ? "VERIFIED" : account.verificationStatus, ownershipResult: account.ownershipResult === "NOT_REVIEWED" ? "MATCH" : account.ownershipResult, comments: account.verificationComments || "" }); }}><ShieldCheck size={16} /><span>{t("Review bank account")}</span></button>
                  {!account.preferred && <button type="button" className="icon-button" title={t("Set preferred account")} aria-label={t("Set preferred account")} onClick={() => onPreferred(account)}><Star size={16} /></button>}
                  <button type="button" className="icon-button danger-icon" title={t("Deactivate bank account")} aria-label={t("Deactivate bank account")} onClick={() => onDeactivateBank(account)}><Power size={16} /></button>
                </div>
              )}
            </article>
          ))}
          {!supplier.bankAccounts?.length && <EmptyState compact title="No supplier bank accounts recorded." />}
        </div>
        <form className="supplier-inline-form" onSubmit={saveDetractionAccount}>
          <div className="form-grid supplier-form-grid">
            <label className="field"><span>{t("Banco de la Nación detracciones account")}</span><input inputMode="numeric" value={detractionAccount} readOnly={!permissions.canVerifyBanking} onChange={(event) => setDetractionAccount(event.target.value)} /><small className="field-hint">{detractionMessage || t("Treasury deposits SPOT detracciones here; it is never a BBVA transfer destination.")}</small></label>
          </div>
          {permissions.canVerifyBanking && <div className="inline-form-actions"><button type="submit" className="secondary-button" disabled={loading || !detractionAccount.trim()}><Save size={15} /><span>{t("Save detracciones account")}</span></button></div>}
        </form>

        {reviewAccount && permissions.canVerifyBanking && (
          <div id="supplier-bank-review-panel" ref={bankReviewRef} tabIndex={-1} role="region" aria-label={t("Finance bank review")}>
          <DraftPanel busy={loading} draft={bankReviewDraft} onDiscard={() => setReviewAccount(null)}><form className="supplier-inline-form" onSubmit={submitBankReview}>
            <div className="inline-form-heading"><div><strong>{t("Finance bank review")}</strong><small>{bankDisplayName(reviewAccount.bank, reviewAccount.bankOtherName)} · {reviewAccount.accountNumber}</small></div><button type="button" className="icon-button quiet" onClick={() => setReviewAccount(null)} aria-label={t("Close bank review")}><X size={16} /></button></div>
            <div className="form-grid supplier-form-grid">
              <label className="field"><span>{t("Verification Status")}</span><select value={bankReview.verificationStatus} onChange={(event) => setBankReview((current) => ({ ...current, verificationStatus: event.target.value }))}>{["VERIFIED", "OBSERVED", "REJECTED"].map((item) => <option key={item} value={item}>{t(item)}</option>)}</select></label>
              <label className="field"><span>{t("Ownership Result")}</span><select value={bankReview.ownershipResult} onChange={(event) => setBankReview((current) => ({ ...current, ownershipResult: event.target.value }))}>{["NOT_REVIEWED", "MATCH", "MISMATCH", "MANUAL_ACCEPTED"].map((item) => <option key={item} value={item}>{t(item)}</option>)}</select></label>
              <label className="field field-span-2"><span>{t("Finance verification comments")}</span><textarea rows="2" value={bankReview.comments} onChange={(event) => setBankReview((current) => ({ ...current, comments: event.target.value }))} /></label>
            </div>
            <p className="section-note">{t("The verification source is recorded as an authorized manual review. No external bank verification is claimed.")}</p>
            <div className="inline-form-actions"><button type="submit" className="primary-button" disabled={loading || !bankReviewDraft.ready || bankReviewDraft.status === "conflict"}><UserCheck size={15} /><span>{t("Record bank review")}</span></button></div>
          </form></DraftPanel>
          </div>
        )}
      </Section>

      {/* The proposal form no longer asks for the compliance declarations or the three documents;
          what an older proposal recorded is still shown. */}
      {(hasDeclarations || riskWarnings.length > 0) && <Section icon={ShieldCheck} title="Compliance Declarations" status={riskWarnings.length ? "Risk flags to review before approving" : "Declarations recorded without automatic legal conclusions"}>
        <div className="declaration-summary-grid">
          <div><span>{t("State sanctions / proceedings")}</span><StatusBadge status={supplier.declarations?.stateSanctions?.answer || "NOT_DECLARED"} /><small>{supplier.declarations?.stateSanctions?.comments || "-"}</small></div>
          <div><span>{t("Compliance / prevention model")}</span><StatusBadge status={supplier.declarations?.complianceModel?.answer || "NOT_DECLARED"} /><small>{supplier.declarations?.complianceModel?.comments || "-"}</small></div>
        </div>
        {riskWarnings.map((warning) => <div className="inline-alert alert-warning" key={warning.code}><AlertTriangle size={16} /><div><strong>{t(warning.code)}</strong><span>{t(warning.message)}</span></div></div>)}
      </Section>}

      {documents.length > 0 && <Section icon={FileCheck2} title="Supporting documents" status="Documents uploaded with the proposal">
        <div className="supplier-document-list">
          {["RUC_FILE", "LEGAL_REP_ID", "BANK_CERTIFICATE"].filter((kind) => docKinds.has(kind)).map((kind) => (
            <div key={kind} className="supplier-document-row">
              <div><CheckCircle2 className="text-success" size={17} /><span>{t(kind)}</span></div>
              <div>{documents.filter((item) => item.kind === kind).map((item) => <ProtectedAssetButton key={item._id} resourcePath={item.url} fileName={item.originalName} preview><Download size={15} /><span>{item.originalName}</span></ProtectedAssetButton>)}</div>
            </div>
          ))}
        </div>
      </Section>}

      <Section icon={ShieldCheck} title="Taxpayer Validation" status={provider.configured ? `${t("Provider")}: ${t(provider.state)}` : "SUNAT integration not configured"}>
        <DetailGrid>
          <Detail label="Validation source" value={supplier.taxpayerValidation?.source || provider.state} />
          <Detail label="Taxpayer Status" value={t(supplier.taxpayerStatus || "PENDING")} />
          <Detail label="Identifier Match" value={t(supplier.taxpayerValidation?.identifierMatch || "NOT_VERIFIED")} />
          <Detail label="Legal Name Match" value={t(supplier.taxpayerValidation?.legalNameMatch || "NOT_VERIFIED")} />
          <Detail label="Validated At" value={displayDate(supplier.taxpayerValidation?.validatedAt, language)} />
          <Detail label="Validated By" value={supplier.taxpayerValidation?.validatedBy?.name} />
        </DetailGrid>
        {permissions.canValidateTaxpayer && provider.variant === "PADRON" && (
          <div className="inline-form-actions">
            <button type="button" className="primary-button" disabled={loading} onClick={() => onTaxValidation({})}>
              <RefreshCw size={15} /><span>{t("Validate automatically with SUNAT")}</span>
            </button>
          </div>
        )}
        {permissions.canValidateTaxpayer && provider.state === "MANUAL" && (
          <DraftPanel busy={loading} draft={taxDraft} onDiscard={() => setReviewAccount(null)}><form className="supplier-inline-form" onSubmit={submitTax}>
            <div className="form-grid supplier-form-grid">
              <label className="field"><span>{t("Manual validation result")}</span><select value={String(taxForm.valid)} onChange={(event) => setTaxForm((current) => ({ ...current, valid: event.target.value === "true" }))}><option value="true">{t("Valid")}</option><option value="false">{t("Invalid")}</option></select></label>
              <label className="field"><span>{t("Returned / reviewed RUC")}</span><input value={taxForm.returnedIdentifier} onChange={(event) => setTaxForm((current) => ({ ...current, returnedIdentifier: event.target.value }))} /></label>
              <label className="field field-span-2"><span>{t("Returned / reviewed legal name")}</span><input value={taxForm.returnedLegalName} onChange={(event) => setTaxForm((current) => ({ ...current, returnedLegalName: event.target.value }))} /></label>
              <label className="field field-span-2"><span>{t("Manual validation comments")}</span><textarea rows="2" value={taxForm.comments} onChange={(event) => setTaxForm((current) => ({ ...current, comments: event.target.value }))} /></label>
            </div>
            <p className="section-note">{t("This records an authorized manual validation and does not claim live SUNAT verification.")}</p>
            <div className="inline-form-actions"><button type="submit" className="primary-button" disabled={loading}><Save size={15} /><span>{t("Record taxpayer validation")}</span></button></div>
          </form></DraftPanel>
        )}
      </Section>

      <Section icon={CheckCircle2} title="Homologation Readiness" status={readiness?.valid ? "Complete" : "Incomplete"}>
        {readiness?.legacyCompatible && <div className="inline-alert alert-info"><CheckCircle2 size={16} /><span>{t("This already-homologated legacy supplier remains compatible without reinterpreting historical data.")}</span></div>}
        {!readiness?.valid && readiness?.issues?.length > 0 && (
          <ul className="requirement-list">
            {readiness.issues.map((issue) => <li key={`${issue.code}-${issue.field}`}><AlertTriangle size={15} /><div><strong>{t(issue.code)}</strong><span>{t(issue.message)}</span><small>{issue.source}</small></div></li>)}
          </ul>
        )}
        {readiness?.valid && !readiness?.legacyCompatible && <div className="inline-alert alert-success"><CheckCircle2 size={16} /><span>{t("All backend homologation requirements are currently satisfied.")}</span></div>}
      </Section>

      <Section icon={UserCheck} title="Jefe Approval" status={jefeApproval.decision === "APPROVED" ? "Approved for use on requests" : waitingOn ? "Waiting for the decision of the proposer's jefe" : "Only the proposer's jefe approves a supplier"}>
        <DetailGrid>
          <Detail label="Decision"><StatusBadge status={jefeApproval.decision || "PENDING"} /></Detail>
          <Detail label={waitingOn ? "Waiting for" : "Decided By"} value={waitingOn || decidedBy} />
          <Detail label="Decided At" value={displayDate(jefeApproval.decidedAt, language)} />
          <Detail label="Decision comments" value={jefeApproval.comments} />
        </DetailGrid>
        {permissions.canApprove && (
          <div className="homologation-action-row">
            <div><strong>{t("Your decision")}</strong><span>{t("Approving lets the supplier's areas use it on requests. Accounting still verifies its bank account before Treasury pays it.")}</span></div>
            <div className="row-actions decision-actions">
              <button type="button" className="primary-button" disabled={loading || !readiness?.valid} title={!readiness?.valid ? t(approvalDisabledReason || "Complete all required controls first.") : undefined} onClick={() => onDecision("APPROVE")}><CheckCircle2 size={16} /><span>{t("Approve supplier")}</span></button>
              <button type="button" className="secondary-button" disabled={loading} onClick={() => onDecision("OBSERVE")}><MessageSquareWarning size={16} /><span>{t("Observe")}</span></button>
              <button type="button" className="danger-button ghost-danger" disabled={loading} onClick={() => onDecision("REJECT")}><XCircle size={16} /><span>{t("Reject")}</span></button>
            </div>
          </div>
        )}
      </Section>

      <Section icon={History} title="Audit / History" status="Insert-only application audit">
        <div className="supplier-audit-list">
          {(supplier.auditHistory || []).map((event) => <div key={event._id}><span className="audit-dot" /><div><strong>{t(event.action)}</strong><span>{event.actorName || t("System")} · {t(event.role || "System")}</span>{event.message && <small>{event.message}</small>}</div><time>{displayDate(event.createdAt, language)}</time></div>)}
          {!supplier.auditHistory?.length && <EmptyState compact title="No supplier history recorded." />}
        </div>
      </Section>
    </div>
  );
}

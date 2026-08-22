import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  Edit3,
  FileCheck2,
  History,
  Landmark,
  Plus,
  Power,
  Save,
  ShieldCheck,
  Star,
  UserCheck,
  Users,
  X
} from "lucide-react";
import { useState } from "react";
import { useLanguage } from "../../context/LanguageContext.jsx";
import ProtectedAssetButton from "../ProtectedAssetButton.jsx";
import StatusBadge from "../StatusBadge.jsx";

function displayDate(value, language) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat(language === "es" ? "es-PE" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function Section({ icon: Icon, title, status, actions, children }) {
  const { t } = useLanguage();
  return (
    <section className="supplier-detail-section">
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
  onFinanceReview,
  onHomologate,
  onDeactivateSupplier
}) {
  const { t, language } = useLanguage();
  const [showBankForm, setShowBankForm] = useState(false);
  const [reviewAccount, setReviewAccount] = useState(null);
  const [bankForm, setBankForm] = useState({ bank: "BCP", accountType: "CURRENT", accountNumber: "", cci: "", currency: supplier.currency || "PEN", accountHolderName: supplier.legalName || supplier.name || "" });
  const [bankReview, setBankReview] = useState({ verificationStatus: "VERIFIED", ownershipResult: "MATCH", comments: "" });
  const [taxForm, setTaxForm] = useState({ valid: true, returnedIdentifier: supplier.rucDni || "", returnedLegalName: supplier.legalName || supplier.name || "", comments: "" });
  const [financeReview, setFinanceReview] = useState({ result: supplier.complianceReview?.result || "PENDING", comments: supplier.complianceReview?.comments || "" });
  const permissions = supplier.permissions || {};
  const riskWarnings = supplier.riskyDeclarations || readiness?.warnings || [];
  const documents = supplier.documents || [];
  const docKinds = new Set(documents.map((item) => item.kind));
  const provider = supplier.sunatProvider || { state: "NOT_CONFIGURED", configured: false };
  const homologationDisabledReason = readiness?.issues?.[0]?.message || "";

  async function submitBank(event) {
    event.preventDefault();
    await onAddBank(bankForm);
    setShowBankForm(false);
  }

  async function submitBankReview(event) {
    event.preventDefault();
    await onReviewBank(reviewAccount, bankReview);
    setReviewAccount(null);
  }

  async function submitTax(event) {
    event.preventDefault();
    await onTaxValidation(taxForm);
  }

  async function submitFinanceReview(event) {
    event.preventDefault();
    await onFinanceReview(financeReview);
  }

  return (
    <div className="supplier-detail-stack">
      <div className="supplier-summary-strip">
        <div>
          <span>{t("ERP Supplier Code")}</span>
          <strong>{supplier.supplierCode || t(["HOMOLOGATED", "INACTIVE"].includes(supplier.homologationStatus) ? "Pending data migration" : "Assigned after homologation")}</strong>
        </div>
        <div>
          <span>{t("Homologation Status")}</span>
          <StatusBadge status={supplier.homologationStatus} />
        </div>
        <div>
          <span>{t("Finance Review")}</span>
          <StatusBadge status={supplier.complianceReview?.result || "PENDING"} />
        </div>
        <div className="supplier-summary-actions">
          {permissions.canEditProposal && <button type="button" className="secondary-button" onClick={onEdit}><Edit3 size={16} /><span>{t("Edit proposal")}</span></button>}
          {permissions.canReview && supplier.homologationStatus !== "INACTIVE" && <button type="button" className="danger-button ghost-danger" onClick={onDeactivateSupplier} disabled={loading}><Power size={16} /><span>{t("Deactivate supplier")}</span></button>}
        </div>
      </div>

      <Section icon={Building2} title="Legal Identification" status={supplier.proposalJustification ? "Registration justification recorded" : "Registration justification missing"}>
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

      <Section icon={Users} title="Contacts" status="Commercial and operations contacts remain separate">
        <div className="contact-summary-grid">
          <Contact title="Commercial Contact" value={supplier.commercialContact} />
          <Contact title="Operations / Logistics Contact" value={supplier.operationsContact} />
        </div>
      </Section>

      <Section icon={Building2} title="Commercial Conditions">
        <DetailGrid>
          <Detail label="Billing Currency" value={supplier.currency} />
          <Detail label="Payment Terms" value={supplier.paymentTerms?.option ? `${t(supplier.paymentTerms.option)} · ${supplier.paymentTerms.days || 0} ${t("days")}` : "-"} />
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
          <form className="supplier-inline-form" onSubmit={submitBank}>
            <div className="form-grid supplier-form-grid">
              <label className="field"><span>{t("Bank")}</span><select value={bankForm.bank} onChange={(event) => setBankForm((current) => ({ ...current, bank: event.target.value }))}>{["BCP", "BBVA", "INTERBANK", "SCOTIABANK", "BANCO_NACION"].map((item) => <option key={item} value={item}>{t(item)}</option>)}</select></label>
              <label className="field"><span>{t("Account Type")}</span><select value={bankForm.accountType} onChange={(event) => setBankForm((current) => ({ ...current, accountType: event.target.value }))}><option value="CURRENT">{t("CURRENT")}</option><option value="DETRACTION">{t("DETRACTION")}</option></select></label>
              <label className="field"><span>{t("Account Number")}</span><input required inputMode="numeric" value={bankForm.accountNumber} onChange={(event) => setBankForm((current) => ({ ...current, accountNumber: event.target.value }))} /></label>
              <label className="field"><span>{t("CCI (20 digits)")}</span><input required inputMode="numeric" value={bankForm.cci} onChange={(event) => setBankForm((current) => ({ ...current, cci: event.target.value }))} /></label>
              <label className="field"><span>{t("Account Currency")}</span><select value={bankForm.currency} onChange={(event) => setBankForm((current) => ({ ...current, currency: event.target.value }))}><option value="PEN">PEN</option><option value="USD">USD</option></select></label>
              <label className="field"><span>{t("Account Holder Name")}</span><input required value={bankForm.accountHolderName} onChange={(event) => setBankForm((current) => ({ ...current, accountHolderName: event.target.value }))} /></label>
            </div>
            {bankForm.accountType === "DETRACTION" && <p className="section-note warning-note">{t("Detraction accounts must use Banco de la Nacion. This does not classify the supplier as subject to detraction.")}</p>}
            <div className="inline-form-actions"><button type="button" className="secondary-button" onClick={() => setShowBankForm(false)}>{t("Cancel")}</button><button type="submit" className="primary-button" disabled={loading}><Save size={15} /><span>{t("Add pending account")}</span></button></div>
          </form>
        )}

        <div className="supplier-bank-list">
          {(supplier.bankAccounts || []).map((account) => (
            <article className={`supplier-bank-row${account.active ? "" : " is-inactive"}`} key={account._id}>
              <div className="bank-main"><strong>{t(account.bank)} · {t(account.accountType)}</strong><span>{account.accountNumber || "-"}</span><small>{t("CCI")}: {account.cci || "-"}</small></div>
              <div className="bank-meta"><span>{account.currency}</span><StatusBadge status={account.verificationStatus} /><StatusBadge status={account.ownershipResult} />{account.preferred && <span className="badge badge-blue"><Star size={12} />{t("Preferred")}</span>}</div>
              <div className="bank-review-meta"><small>{t("Account holder")}: {account.accountHolderName || "-"}</small><small>{t("Verification source")}: {account.verificationSource || t("Not reviewed")}</small><small>{displayDate(account.verifiedAt || account.validFrom, language)}</small></div>
              {permissions.canVerifyBanking && account.active && (
                <div className="bank-actions">
                  <button type="button" className="icon-button" title={t("Review bank account")} aria-label={t("Review bank account")} onClick={() => { setReviewAccount(account); setBankReview({ verificationStatus: account.verificationStatus === "PENDING" ? "VERIFIED" : account.verificationStatus, ownershipResult: account.ownershipResult === "NOT_REVIEWED" ? "MATCH" : account.ownershipResult, comments: account.verificationComments || "" }); }}><ShieldCheck size={16} /></button>
                  {!account.preferred && <button type="button" className="icon-button" title={t("Set preferred account")} aria-label={t("Set preferred account")} onClick={() => onPreferred(account)}><Star size={16} /></button>}
                  <button type="button" className="icon-button danger-icon" title={t("Deactivate bank account")} aria-label={t("Deactivate bank account")} onClick={() => onDeactivateBank(account)}><Power size={16} /></button>
                </div>
              )}
            </article>
          ))}
          {!supplier.bankAccounts?.length && <p className="empty-inline">{t("No supplier bank accounts recorded.")}</p>}
        </div>

        {reviewAccount && (
          <form className="supplier-inline-form" onSubmit={submitBankReview}>
            <div className="inline-form-heading"><div><strong>{t("Finance bank review")}</strong><small>{reviewAccount.bank} · {reviewAccount.accountNumber}</small></div><button type="button" className="icon-button quiet" onClick={() => setReviewAccount(null)} aria-label={t("Close bank review")}><X size={16} /></button></div>
            <div className="form-grid supplier-form-grid">
              <label className="field"><span>{t("Verification Status")}</span><select value={bankReview.verificationStatus} onChange={(event) => setBankReview((current) => ({ ...current, verificationStatus: event.target.value }))}>{["VERIFIED", "OBSERVED", "REJECTED"].map((item) => <option key={item} value={item}>{t(item)}</option>)}</select></label>
              <label className="field"><span>{t("Ownership Result")}</span><select value={bankReview.ownershipResult} onChange={(event) => setBankReview((current) => ({ ...current, ownershipResult: event.target.value }))}>{["NOT_REVIEWED", "MATCH", "MISMATCH", "MANUAL_ACCEPTED"].map((item) => <option key={item} value={item}>{t(item)}</option>)}</select></label>
              <label className="field field-span-2"><span>{t("Finance verification comments")}</span><textarea rows="2" value={bankReview.comments} onChange={(event) => setBankReview((current) => ({ ...current, comments: event.target.value }))} /></label>
            </div>
            <p className="section-note">{t("The verification source is recorded as an authorized manual review. No external bank verification is claimed.")}</p>
            <div className="inline-form-actions"><button type="submit" className="primary-button" disabled={loading}><UserCheck size={15} /><span>{t("Record bank review")}</span></button></div>
          </form>
        )}
      </Section>

      <Section icon={ShieldCheck} title="Compliance Declarations" status={riskWarnings.length ? "Risk flags require Finance review" : "Declarations recorded without automatic legal conclusions"}>
        <div className="declaration-summary-grid">
          <div><span>{t("State sanctions / proceedings")}</span><StatusBadge status={supplier.declarations?.stateSanctions?.answer || "NOT_DECLARED"} /><small>{supplier.declarations?.stateSanctions?.comments || "-"}</small></div>
          <div><span>{t("Compliance / prevention model")}</span><StatusBadge status={supplier.declarations?.complianceModel?.answer || "NOT_DECLARED"} /><small>{supplier.declarations?.complianceModel?.comments || "-"}</small></div>
        </div>
        {riskWarnings.map((warning) => <div className="inline-alert alert-warning" key={warning.code}><AlertTriangle size={16} /><div><strong>{t(warning.code)}</strong><span>{t(warning.message)}</span></div></div>)}
      </Section>

      <Section icon={FileCheck2} title="Mandatory Documents" status={`${docKinds.size}/3 ${t("document types present")}`}>
        <div className="supplier-document-list">
          {["RUC_FILE", "LEGAL_REP_ID", "BANK_CERTIFICATE"].map((kind) => {
            const items = documents.filter((item) => item.kind === kind);
            return (
              <div key={kind} className="supplier-document-row">
                <div>{items.length ? <CheckCircle2 className="text-success" size={17} /> : <AlertTriangle className="text-warning" size={17} />}<span>{t(kind)}</span></div>
                <div>{items.map((item) => <ProtectedAssetButton key={item._id} resourcePath={item.url} fileName={item.originalName} preview><Download size={15} /><span>{item.originalName}</span></ProtectedAssetButton>)}{!items.length && <small>{t("Missing")}</small>}</div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section icon={ShieldCheck} title="Taxpayer Validation" status={provider.configured ? `${t("Provider")}: ${t(provider.state)}` : "SUNAT integration not configured"}>
        <DetailGrid>
          <Detail label="Validation source" value={supplier.taxpayerValidation?.source || provider.state} />
          <Detail label="Taxpayer Status" value={t(supplier.taxpayerStatus || "PENDING")} />
          <Detail label="Identifier Match" value={t(supplier.taxpayerValidation?.identifierMatch || "NOT_VERIFIED")} />
          <Detail label="Legal Name Match" value={t(supplier.taxpayerValidation?.legalNameMatch || "NOT_VERIFIED")} />
          <Detail label="Validated At" value={displayDate(supplier.taxpayerValidation?.validatedAt, language)} />
          <Detail label="Validated By" value={supplier.taxpayerValidation?.validatedBy?.name} />
        </DetailGrid>
        {permissions.canReview && provider.state === "MANUAL" && (
          <form className="supplier-inline-form" onSubmit={submitTax}>
            <div className="form-grid supplier-form-grid">
              <label className="field"><span>{t("Manual validation result")}</span><select value={String(taxForm.valid)} onChange={(event) => setTaxForm((current) => ({ ...current, valid: event.target.value === "true" }))}><option value="true">{t("Valid")}</option><option value="false">{t("Invalid")}</option></select></label>
              <label className="field"><span>{t("Returned / reviewed RUC")}</span><input value={taxForm.returnedIdentifier} onChange={(event) => setTaxForm((current) => ({ ...current, returnedIdentifier: event.target.value }))} /></label>
              <label className="field field-span-2"><span>{t("Returned / reviewed legal name")}</span><input value={taxForm.returnedLegalName} onChange={(event) => setTaxForm((current) => ({ ...current, returnedLegalName: event.target.value }))} /></label>
              <label className="field field-span-2"><span>{t("Manual validation comments")}</span><textarea rows="2" value={taxForm.comments} onChange={(event) => setTaxForm((current) => ({ ...current, comments: event.target.value }))} /></label>
            </div>
            <p className="section-note">{t("This records an authorized manual validation and does not claim live SUNAT verification.")}</p>
            <div className="inline-form-actions"><button type="submit" className="primary-button" disabled={loading}><Save size={15} /><span>{t("Record taxpayer validation")}</span></button></div>
          </form>
        )}
      </Section>

      <Section icon={UserCheck} title="Finance / Compliance Review" status="Finance decision is separate from supplier declarations">
        <DetailGrid>
          <Detail label="Review Result"><StatusBadge status={supplier.complianceReview?.result || "PENDING"} /></Detail>
          <Detail label="Reviewed By" value={supplier.complianceReview?.reviewedBy?.name} />
          <Detail label="Reviewed At" value={displayDate(supplier.complianceReview?.reviewedAt, language)} />
          <Detail label="Review Comments" value={supplier.complianceReview?.comments} />
        </DetailGrid>
        {permissions.canReview && (
          <form className="supplier-inline-form" onSubmit={submitFinanceReview}>
            <div className="form-grid supplier-form-grid">
              <label className="field"><span>{t("Finance Review Result")}</span><select value={financeReview.result} onChange={(event) => setFinanceReview((current) => ({ ...current, result: event.target.value }))}>{["PENDING", "APPROVED", "OBSERVED", "REJECTED"].map((item) => <option key={item} value={item}>{t(item)}</option>)}</select></label>
              <label className="field field-span-2"><span>{t("Review Comments")}</span><textarea rows="3" value={financeReview.comments} onChange={(event) => setFinanceReview((current) => ({ ...current, comments: event.target.value }))} /></label>
            </div>
            <div className="inline-form-actions"><button type="submit" className={financeReview.result === "REJECTED" ? "danger-button" : "primary-button"} disabled={loading}><Save size={15} /><span>{t("Record Finance review")}</span></button></div>
          </form>
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
        {permissions.canHomologate && (
          <div className="homologation-action-row">
            <div><strong>{t("Final homologation")}</strong><span>{t("Assigns one immutable PRV code and makes the supplier available to the existing request workflow.")}</span></div>
            <button type="button" className="primary-button" disabled={loading || !readiness?.valid} title={!readiness?.valid ? t(homologationDisabledReason || "Complete all required controls first.") : undefined} onClick={onHomologate}><CheckCircle2 size={16} /><span>{t("Homologate and assign PRV")}</span></button>
          </div>
        )}
      </Section>

      <Section icon={History} title="Audit / History" status="Insert-only application audit">
        <div className="supplier-audit-list">
          {(supplier.auditHistory || []).map((event) => <div key={event._id}><span className="audit-dot" /><div><strong>{t(event.action)}</strong><span>{event.actorName || t("System")} · {t(event.role || "System")}</span>{event.message && <small>{event.message}</small>}</div><time>{displayDate(event.createdAt, language)}</time></div>)}
          {!supplier.auditHistory?.length && <p className="empty-inline">{t("No supplier history recorded.")}</p>}
        </div>
      </Section>
    </div>
  );
}

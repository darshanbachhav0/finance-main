import { Link } from "react-router-dom";
import PageHeader from "../components/PageHeader.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
export default function WorkspaceHub({ administration = false }) {
  const { t } = useLanguage();
  const links = administration ? [["Users & Roles", "/users"], ["Cost Centers", "/cost-centers"], ["Approval Rules", "/configuration/approval-rules"], ["Document Rules", "/configuration/document-rules"], ["Accounting Configuration", "/configuration/accounting-mappings"], ["BBVA Configuration", "/configuration/bank-formats"], ["Exchange Rates", "/exchange-rates"], ["Audit", "/audit"]] : [["A2 Batch Invoices", "/batch-invoices"], ["Invoice Observations", "/accounting/invoice-observations"], ["Accounts Payable", "/accounting/payables"]];
  const additional = [["Requests", "/requests"], ["Approvals", "/approvals"], ["Budget Control", "/budget"], ["Accounting", "/accounting"], ["Payments", "/treasury"], ["Payment History", "/treasury/history"], ["Management Reports", "/reports"], ["Suppliers", "/suppliers"], ["Reimbursement Banking", "/reimbursement-bank"], ["Accounting Periods", "/accounting/periods"], ["SIRE", "/accounting/sire"], ["Expense Types", "/expense-types"], ["Projects", "/configuration/projects"], ["Budget Rules", "/configuration/budget-rules"], ["Budget Allocations", "/configuration/budget-allocations"], ["A2 Batch Invoices", "/batch-invoices"]];
  const grid = items => <div className="workspace-hub">{items.map(([label, path]) => <Link className="workspace-panel hub-link" key={path} to={path}>{t(label)}<span aria-hidden="true">&rarr;</span></Link>)}</div>;
  return <section><PageHeader title={administration ? "Administration" : "Invoices"} />{grid(links)}{administration && <details className="workspace-panel section-spacer"><summary>{t("Other workspaces")}</summary>{grid(additional)}</details>}</section>;
}

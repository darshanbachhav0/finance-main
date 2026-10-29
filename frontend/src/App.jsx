import "./styles/uma-pilot.css";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./layouts/AppLayout.jsx";
import ProtectedRoute from "./routes/ProtectedRoute.jsx";
import WorkspaceSkeleton from "./components/WorkspaceSkeleton.jsx";

const SettingsHub = lazy(() => import("./pages/SettingsHub.jsx"));
const UmaGuides = lazy(() => import("./pages/UmaGuides.jsx"));
const RequestProcessSelection = lazy(() => import("./pages/RequestProcessSelection.jsx"));
const UmaInvestments = lazy(() => import("./pages/UmaInvestments.jsx"));
const UmaSpecialExpenses = lazy(() => import("./pages/UmaSpecialExpenses.jsx"));
const UmaStatementReviews = lazy(() => import("./pages/UmaStatementReviews.jsx"));
const UmaAudit = lazy(() => import("./pages/UmaAudit.jsx"));
const UmaInsights = lazy(() => import("./pages/UmaInsights.jsx"));
const AccountingEntries = lazy(() => import("./pages/AccountingEntries.jsx"));
const AccountsPayable = lazy(() => import("./pages/AccountsPayable.jsx"));
const BankFileVerification = lazy(() => import("./pages/BankFileVerification.jsx"));
const AccountingPeriods = lazy(() => import("./pages/AccountingPeriods.jsx"));
const AdminUsers = lazy(() => import("./pages/AdminUsers.jsx"));
const ApprovalInbox = lazy(() => import("./pages/ApprovalInbox.jsx"));
const ApprovalDecision = lazy(() => import("./pages/ApprovalDecision.jsx"));
const CostCenters = lazy(() => import("./pages/CostCenters.jsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const DepartmentInvoices = lazy(() => import("./pages/DepartmentInvoices.jsx"));
const ExchangeRates = lazy(() => import("./pages/ExchangeRates.jsx"));
const ExpenseTypes = lazy(() => import("./pages/ExpenseTypes.jsx"));
const Login = lazy(() => import("./pages/Login.jsx"));
const RequestCreate = lazy(() => import("./pages/RequestCreate.jsx"));
const RequestDetail = lazy(() => import("./pages/RequestDetail.jsx"));
const RequestsList = lazy(() => import("./pages/RequestsList.jsx"));
const SireExport = lazy(() => import("./pages/SireExport.jsx"));
const Suppliers = lazy(() => import("./pages/Suppliers.jsx"));
const TreasuryQueue = lazy(() => import("./pages/TreasuryQueue.jsx"));
const TreasuryTransfers = lazy(() => import("./pages/TreasuryTransfers.jsx"));
const BudgetControl = lazy(() => import("./pages/BudgetControl.jsx"));
const ManagementReports = lazy(() => import("./pages/ManagementReports.jsx"));
const MasterConfiguration = lazy(() => import("./pages/MasterConfiguration.jsx"));
const EmployeeReimbursementBanking = lazy(() => import("./pages/EmployeeReimbursementBanking.jsx"));
const BulkInvoiceUpload = lazy(() => import("./pages/BulkInvoiceUpload.jsx"));
const InvoiceObservations = lazy(() => import("./pages/InvoiceObservations.jsx"));
const MyTeam = lazy(() => import("./pages/MyTeam.jsx"));
const AdminPlatform = lazy(() => import("./pages/admin/AdminPlatform.jsx"));
const AdminAlerts = lazy(() => import("./pages/admin/AdminAlerts.jsx"));
const AdminAudit = lazy(() => import("./pages/admin/AdminAudit.jsx"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings.jsx"));
const AccessReview = lazy(() => import("./pages/admin/AccessReview.jsx"));

function RouteFallback() {
  return <div className="route-loading"><WorkspaceSkeleton /></div>;
}

// Each route opens for the same rule as its menu entry (utils/navigationAccess.js); the API checks
// every call again.
const page = (path, element, extra = {}) => <Route path={path.replace(/^\//, "")} element={<ProtectedRoute path={path} {...extra} />}><Route index element={element} /></Route>;

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}><Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          {page("/settings", <SettingsHub />)}
          {/* Former pages, kept as redirects for saved links. */}
          <Route path="super-admin/*" element={<Navigate to="/administration" replace />} />
          <Route path="management-view" element={<Navigate to="/" replace />} />
          {page("/requests", <RequestsList />)}
          {page("/guides", <UmaGuides />)}
          {page("/investments", <UmaInvestments />)}
          {page("/special-expenses", <UmaSpecialExpenses />)}
          {page("/treasury/statement-reviews", <UmaStatementReviews />)}
          {page("/audit", <UmaAudit />)}
          {page("/consultas", <UmaInsights />)}
          {page("/indicadores", <UmaInsights type="indicadores" />)}
          <Route path="requests/invoices" element={<ProtectedRoute path="/requests" />}><Route index element={<DepartmentInvoices />} /></Route>
          <Route path="my-team" element={<ProtectedRoute requiresTeam path="/my-team" />}><Route index element={<MyTeam />} /></Route>
          <Route path="requests/new" element={<ProtectedRoute path="/requests/new" />}>
            <Route index element={<RequestProcessSelection />} />
            <Route path="form" element={<RequestCreate />} />
          </Route>
          <Route path="requests/:id/edit" element={<ProtectedRoute path="/requests/new" />}><Route index element={<RequestCreate />} /></Route>
          {/* The server decides who reads a request (its requester, its approvers, the scope of request.view). */}
          <Route path="requests/:id" element={<ProtectedRoute />}><Route index element={<RequestDetail />} /></Route>
          <Route path="approvals" element={<ProtectedRoute path="/approvals" />}>
            <Route index element={<ApprovalInbox />} />
            <Route path=":id" element={<ApprovalDecision />} />
          </Route>
          {page("/batch-invoices", <BulkInvoiceUpload />)}
          {page("/accounting/bank-files", <BankFileVerification />)}
          {page("/accounting/payables", <AccountsPayable />)}
          {page("/accounting/periods", <AccountingPeriods />)}
          {page("/accounting/sire", <SireExport />)}
          <Route path="accounting/invoices" element={<Navigate to="/accounting/payables" replace />} />
          {page("/accounting", <AccountingEntries />)}
          {page("/accounting/invoice-observations", <InvoiceObservations />)}
          {page("/treasury/transfers", <TreasuryTransfers />)}
          {page("/treasury/history", <TreasuryQueue historyOnly />)}
          {page("/treasury", <TreasuryQueue />)}
          {page("/reimbursement-bank", <EmployeeReimbursementBanking />)}
          {page("/budget", <BudgetControl />)}
          {page("/reports", <ManagementReports />)}
          <Route path="suppliers" element={<ProtectedRoute path="/suppliers" />}>
            <Route index element={<Suppliers />} />
            <Route path=":id" element={<Suppliers />} />
          </Route>
          {page("/cost-centers", <CostCenters />)}
          {page("/expense-types", <ExpenseTypes />)}
          {page("/exchange-rates", <ExchangeRates />)}
          {page("/users", <AdminUsers />)}
          {page("/administration/access", <AccessReview />)}
          {page("/administration/audit", <AdminAudit />)}
          {page("/administration/alerts", <AdminAlerts />)}
          {page("/administration/settings", <AdminSettings />)}
          {page("/administration", <AdminPlatform />)}
          <Route path="configuration/:resource" element={<ProtectedRoute path="/configuration/*" />}><Route index element={<MasterConfiguration />} /></Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></Suspense>
  );
}

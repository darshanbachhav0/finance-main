import "./styles/uma-pilot.css";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./layouts/AppLayout.jsx";
import ProtectedRoute from "./routes/ProtectedRoute.jsx";
import WorkspaceSkeleton from "./components/WorkspaceSkeleton.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { configurationRoles, navigationAccess, settingsRoles } from "./utils/navigationAccess.js";

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
const ExternalManagementPortal = lazy(() => import("./pages/ExternalManagementPortal.jsx"));
const SuperAdminOverview = lazy(() => import("./pages/superadmin/SuperAdminOverview.jsx"));
const SuperAdminAdministrators = lazy(() => import("./pages/superadmin/SuperAdminAdministrators.jsx"));
const SuperAdminAlerts = lazy(() => import("./pages/superadmin/SuperAdminAlerts.jsx"));
const SuperAdminAudit = lazy(() => import("./pages/superadmin/SuperAdminAudit.jsx"));
const SuperAdminSettings = lazy(() => import("./pages/superadmin/SuperAdminSettings.jsx"));

const internalRoles = ["Admin", "Solicitor", "AreaDirector", "ViceRector", "Accounting", "Treasury", "Procurement", "Management", "GAF", "Legal", "HumanResources"];
// The Super Admin and the Auditor read these pages (read-only); the Super Admin also has its console.
const readOnlyRoles = ["SuperAdmin", "Auditor"];
const readers = [...internalRoles, ...readOnlyRoles];
const requesterRoles = ["Admin", "Solicitor", "Legal", "HumanResources"];

function RoleHome() {
  const { user } = useAuth();
  if (user?.role === "SuperAdmin") return <Navigate to="/super-admin" replace />;
  // The Auditor has no task dashboard: it starts at the request list.
  if (user?.role === "Auditor") return <Navigate to="/requests" replace />;
  return user?.role === "ManagementViewer" ? <Navigate to="/management-view" replace /> : <Dashboard />;
}

function RouteFallback() {
  return <div className="route-loading"><WorkspaceSkeleton /></div>;
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}><Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<RoleHome />} />
          <Route path="management-view" element={<ProtectedRoute roles={["Admin", "Management", "ManagementViewer", "GAF", "SuperAdmin", "Auditor"]} permissions={["management-portal:view"]} />}>
            <Route index element={<ExternalManagementPortal />} />
          </Route>
          <Route path="settings" element={<ProtectedRoute roles={settingsRoles} permissions={["bank-format:certify"]} />}><Route index element={<SettingsHub />} /></Route>
          {/* Former hub pages: their links now live in the menu and on Settings. */}
          <Route path="administration" element={<Navigate to="/settings" replace />} />
          <Route path="requests" element={<ProtectedRoute roles={readers} />}><Route index element={<RequestsList />} /></Route>
          <Route path="guides" element={<ProtectedRoute roles={navigationAccess["/guides"]} />}><Route index element={<UmaGuides />} /></Route>
          <Route path="investments" element={<ProtectedRoute roles={navigationAccess["/investments"]} />}><Route index element={<UmaInvestments />} /></Route>
          <Route path="special-expenses" element={<ProtectedRoute roles={navigationAccess["/special-expenses"]} />}><Route index element={<UmaSpecialExpenses />} /></Route>
          <Route path="treasury/statement-reviews" element={<ProtectedRoute roles={["Admin","Treasury","Accounting","GAF", ...readOnlyRoles]} />}><Route index element={<UmaStatementReviews />} /></Route>
          <Route path="audit" element={<ProtectedRoute roles={["Admin","GAF","Accounting","Management", ...readOnlyRoles]} />}><Route index element={<UmaAudit />} /></Route>
          <Route path="consultas" element={<ProtectedRoute roles={["Admin","GAF","Accounting","Treasury","Management", ...readOnlyRoles]} />}><Route index element={<UmaInsights />} /></Route>
          <Route path="indicadores" element={<ProtectedRoute roles={["Admin","GAF","Accounting","Treasury","Management", ...readOnlyRoles]} />}><Route index element={<UmaInsights type="indicadores" />} /></Route>
          <Route path="requests/invoices" element={<ProtectedRoute roles={readers} />}><Route index element={<DepartmentInvoices />} /></Route>
          <Route path="my-team" element={<ProtectedRoute requiresTeam roles={internalRoles} />}><Route index element={<MyTeam />} /></Route>
          <Route path="requests/new" element={<ProtectedRoute roles={requesterRoles} permissions={["request:create"]} />}>
            <Route index element={<RequestProcessSelection />} />
            <Route path="form" element={<RequestCreate />} />
          </Route>
          <Route path="requests/:id/edit" element={<ProtectedRoute roles={requesterRoles} permissions={["request:create"]} />}>
            <Route index element={<RequestCreate />} />
          </Route>
          <Route path="requests/:id" element={<ProtectedRoute roles={readers} />}><Route index element={<RequestDetail />} /></Route>
          <Route path="approvals" element={<ProtectedRoute roles={internalRoles} />}>
            <Route index element={<ApprovalInbox />} />
            <Route path=":id" element={<ApprovalDecision />} />
          </Route>
          <Route path="batch-invoices" element={<ProtectedRoute roles={["Admin", "Solicitor", "Accounting"]} permissions={["batch-invoice:upload", "batch-invoice:review"]} />}>
            <Route index element={<BulkInvoiceUpload />} />
          </Route>
          {/* The GAF approves bank files as Accounting does (backend bank-file:verify). */}
          <Route path="accounting/bank-files" element={<ProtectedRoute roles={navigationAccess["/accounting/bank-files"]} />}>
            <Route index element={<BankFileVerification />} />
          </Route>
          <Route path="accounting" element={<ProtectedRoute roles={["Admin", "Accounting", ...readOnlyRoles]} />}>
            <Route index element={<AccountingEntries />} />
            <Route path="invoices" element={<Navigate to="/accounting/payables" replace />} />
            <Route path="payables" element={<AccountsPayable />} />
            <Route path="periods" element={<AccountingPeriods />} />
            <Route path="sire" element={<SireExport />} />
          </Route>
          <Route path="accounting/invoice-observations" element={<ProtectedRoute roles={["Admin", "Accounting", ...readOnlyRoles]} permissions={["batch-invoice:review"]} />}>
            <Route index element={<InvoiceObservations />} />
          </Route>
          {/* Track D: transfers between UMA's own accounts (Treasury, the GAF, Accounting). */}
          <Route path="treasury/transfers" element={<ProtectedRoute roles={navigationAccess["/treasury/transfers"]} />}>
            <Route index element={<TreasuryTransfers />} />
          </Route>
          <Route path="treasury" element={<ProtectedRoute roles={["Admin", "Treasury", ...readOnlyRoles]} />}>
            <Route index element={<TreasuryQueue />} />
            <Route path="history" element={<TreasuryQueue historyOnly />} />
          </Route>
          <Route path="reimbursement-bank" element={<ProtectedRoute roles={["Admin", "Solicitor", "Legal", "HumanResources", "Accounting", "Treasury"]} permissions={["employee-bank:manage-own", "employee-bank:review"]} />}>
            <Route index element={<EmployeeReimbursementBanking />} />
          </Route>
          <Route path="budget" element={<ProtectedRoute roles={navigationAccess["/budget"]} permissions={["budget:view"]} />}>
            <Route index element={<BudgetControl />} />
          </Route>
          <Route path="reports" element={<ProtectedRoute roles={navigationAccess["/reports"]} permissions={["report:view"]} />}>
            <Route index element={<ManagementReports />} />
          </Route>
          <Route path="suppliers" element={<ProtectedRoute roles={readers} permissions={["supplier:bank-view"]} />}>
            <Route index element={<Suppliers />} />
            <Route path=":id" element={<Suppliers />} />
          </Route>
          <Route path="cost-centers" element={<ProtectedRoute roles={["Admin", "Accounting", ...readOnlyRoles]} />}>
            <Route index element={<CostCenters />} />
          </Route>
          <Route path="expense-types" element={<ProtectedRoute roles={["Admin", "Accounting", ...readOnlyRoles]} />}>
            <Route index element={<ExpenseTypes />} />
          </Route>
          <Route path="exchange-rates" element={<ProtectedRoute roles={["Admin", "Accounting", ...readOnlyRoles]} />}>
            <Route index element={<ExchangeRates />} />
          </Route>
          <Route path="users" element={<ProtectedRoute roles={["Admin", ...readOnlyRoles]} />}>
            <Route index element={<AdminUsers />} />
          </Route>
          <Route path="super-admin" element={<ProtectedRoute roles={["SuperAdmin"]} />}>
            <Route index element={<SuperAdminOverview />} />
            <Route path="administrators" element={<SuperAdminAdministrators />} />
            <Route path="alerts" element={<SuperAdminAlerts />} />
            <Route path="audit" element={<SuperAdminAudit />} />
            <Route path="settings" element={<SuperAdminSettings />} />
          </Route>
          {/* Admin, Accounting, Budget and Treasury (bank-format certification); MasterConfiguration
              narrows each resource to its own roles. */}
          <Route path="configuration/:resource" element={<ProtectedRoute roles={configurationRoles} permissions={["bank-format:certify"]} />}>
            <Route index element={<MasterConfiguration />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></Suspense>
  );
}

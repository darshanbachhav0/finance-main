import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./layouts/AppLayout.jsx";
import ProtectedRoute from "./routes/ProtectedRoute.jsx";
import WorkspaceSkeleton from "./components/WorkspaceSkeleton.jsx";
import { useAuth } from "./context/AuthContext.jsx";

const WorkspaceHub = lazy(() => import("./pages/WorkspaceHub.jsx"));
const AccountingEntries = lazy(() => import("./pages/AccountingEntries.jsx"));
const AccountsPayable = lazy(() => import("./pages/AccountsPayable.jsx"));
const AccountingPeriods = lazy(() => import("./pages/AccountingPeriods.jsx"));
const AdminUsers = lazy(() => import("./pages/AdminUsers.jsx"));
const ApprovalInbox = lazy(() => import("./pages/ApprovalInbox.jsx"));
const CostCenters = lazy(() => import("./pages/CostCenters.jsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const ExchangeRates = lazy(() => import("./pages/ExchangeRates.jsx"));
const ExpenseTypes = lazy(() => import("./pages/ExpenseTypes.jsx"));
const Login = lazy(() => import("./pages/Login.jsx"));
const RequestCreate = lazy(() => import("./pages/RequestCreate.jsx"));
const RequestDetail = lazy(() => import("./pages/RequestDetail.jsx"));
const RequestsList = lazy(() => import("./pages/RequestsList.jsx"));
const SireExport = lazy(() => import("./pages/SireExport.jsx"));
const Suppliers = lazy(() => import("./pages/Suppliers.jsx"));
const TreasuryQueue = lazy(() => import("./pages/TreasuryQueue.jsx"));
const BudgetControl = lazy(() => import("./pages/BudgetControl.jsx"));
const ManagementReports = lazy(() => import("./pages/ManagementReports.jsx"));
const MasterConfiguration = lazy(() => import("./pages/MasterConfiguration.jsx"));
const AuditViewer = lazy(() => import("./pages/AuditViewer.jsx"));
const EmployeeReimbursementBanking = lazy(() => import("./pages/EmployeeReimbursementBanking.jsx"));
const BulkInvoiceUpload = lazy(() => import("./pages/BulkInvoiceUpload.jsx"));
const InvoiceObservations = lazy(() => import("./pages/InvoiceObservations.jsx"));
const MyTeam = lazy(() => import("./pages/MyTeam.jsx"));
const ExternalManagementPortal = lazy(() => import("./pages/ExternalManagementPortal.jsx"));

const internalRoles = ["Admin", "Solicitor", "Approver", "Accounting", "Treasury", "Budget", "Procurement", "Management"];

function RoleHome() {
  const { user } = useAuth();
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
          <Route path="management-view" element={<ProtectedRoute roles={["Admin", "Management", "ManagementViewer"]} />}>
            <Route index element={<ExternalManagementPortal />} />
          </Route>
          <Route path="administration" element={<ProtectedRoute roles={["Admin"]} />}><Route index element={<WorkspaceHub administration />} /></Route>
          <Route path="requests" element={<ProtectedRoute roles={internalRoles} />}><Route index element={<RequestsList />} /></Route>
          <Route path="my-team" element={<ProtectedRoute requiresTeam roles={[...internalRoles, "ManagementViewer"]} />}><Route index element={<MyTeam />} /></Route>
          <Route path="requests/new" element={<ProtectedRoute roles={["Admin", "Solicitor"]} />}>
            <Route index element={<RequestCreate />} />
          </Route>
          <Route path="requests/:id/edit" element={<ProtectedRoute roles={["Admin", "Solicitor"]} />}>
            <Route index element={<RequestCreate />} />
          </Route>
          <Route path="requests/:id" element={<ProtectedRoute roles={internalRoles} />}><Route index element={<RequestDetail />} /></Route>
          <Route path="approvals" element={<ProtectedRoute roles={internalRoles} />}>
            <Route index element={<ApprovalInbox />} />
          </Route>
          <Route path="batch-invoices" element={<ProtectedRoute roles={["Admin", "Solicitor", "Accounting"]} />}>
            <Route index element={<BulkInvoiceUpload />} />
          </Route>
          <Route path="accounting" element={<ProtectedRoute roles={["Admin", "Accounting"]} />}>
            <Route index element={<AccountingEntries />} />
            <Route path="invoices" element={<WorkspaceHub />} />
            <Route path="payables" element={<AccountsPayable />} />
            <Route path="invoice-observations" element={<InvoiceObservations />} />
            <Route path="periods" element={<AccountingPeriods />} />
            <Route path="sire" element={<SireExport />} />
          </Route>
          <Route path="treasury" element={<ProtectedRoute roles={["Admin", "Treasury"]} />}>
            <Route index element={<TreasuryQueue />} />
            <Route path="history" element={<TreasuryQueue historyOnly />} />
          </Route>
          <Route path="reimbursement-bank" element={<ProtectedRoute roles={["Admin", "Solicitor", "Accounting", "Treasury"]} />}>
            <Route index element={<EmployeeReimbursementBanking />} />
          </Route>
          <Route path="budget" element={<ProtectedRoute roles={["Admin", "Approver", "Accounting", "Budget", "Management"]} />}>
            <Route index element={<BudgetControl />} />
          </Route>
          <Route path="reports" element={<ProtectedRoute roles={["Admin", "Approver", "Accounting", "Treasury", "Budget", "Procurement", "Management"]} />}>
            <Route index element={<ManagementReports />} />
          </Route>
          <Route path="suppliers" element={<ProtectedRoute roles={["Admin", "Accounting", "Treasury", "Solicitor", "Procurement"]} />}>
            <Route index element={<Suppliers />} />
          </Route>
          <Route path="cost-centers" element={<ProtectedRoute roles={["Admin", "Accounting"]} />}>
            <Route index element={<CostCenters />} />
          </Route>
          <Route path="expense-types" element={<ProtectedRoute roles={["Admin", "Accounting"]} />}>
            <Route index element={<ExpenseTypes />} />
          </Route>
          <Route path="exchange-rates" element={<ProtectedRoute roles={["Admin", "Accounting"]} />}>
            <Route index element={<ExchangeRates />} />
          </Route>
          <Route path="users" element={<ProtectedRoute roles={["Admin"]} />}>
            <Route index element={<AdminUsers />} />
          </Route>
          <Route path="configuration/:resource" element={<ProtectedRoute roles={["Admin", "Accounting", "Budget"]} />}>
            <Route index element={<MasterConfiguration />} />
          </Route>
          <Route path="audit" element={<ProtectedRoute roles={["Admin", "Accounting"]} />}>
            <Route index element={<AuditViewer />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></Suspense>
  );
}

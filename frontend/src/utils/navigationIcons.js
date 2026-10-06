import {
  BarChart3,
  BookOpenCheck,
  Building2,
  CalendarRange,
  ChartNoAxesCombined,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  FileArchive,
  FilePlus2,
  FileSpreadsheet,
  History,
  Landmark,
  ListChecks,
  ReceiptText,
  Settings2,
  SlidersHorizontal,
  TriangleAlert,
  Users,
  WalletCards
} from "lucide-react";

// Icons for the pages in utils/navigationAccess.js (pageLabels). Kept apart so the navigation
// rules stay plain JavaScript that the node tests can import.
const icons = {
  "/": BarChart3,
  "/requests": ReceiptText,
  "/requests/new": FilePlus2,
  "/approvals": ClipboardCheck,
  "/my-team": Users,
  "/operations": ListChecks,
  "/batch-invoices": FileArchive,
  "/accounting/invoice-observations": TriangleAlert,
  "/accounting/payables": BookOpenCheck,
  "/reimbursement-bank": CircleDollarSign,
  "/treasury": Landmark,
  "/treasury/history": History,
  "/accounting": FileSpreadsheet,
  "/accounting/periods": CalendarRange,
  "/accounting/sire": ClipboardList,
  "/budget": WalletCards,
  "/reports": ChartNoAxesCombined,
  "/management-view": ChartNoAxesCombined,
  "/suppliers": Building2,
  "/settings": Settings2,
  "/users": Users,
  "/cost-centers": CircleDollarSign,
  "/expense-types": BookOpenCheck,
  "/exchange-rates": CircleDollarSign,
  "/configuration/bank-formats": Landmark,
  "/configuration/accounting-mappings": BookOpenCheck
};

export function navigationIcon(path) {
  return icons[path] || (path?.startsWith("/configuration/") ? SlidersHorizontal : Settings2);
}

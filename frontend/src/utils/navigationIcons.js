import {
  BarChart3,
  BellRing,
  BookOpenCheck,
  Building2,
  CalendarRange,
  ChartNoAxesCombined,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  FileArchive,
  FileCheck2,
  FilePlus2,
  Gauge,
  FileSpreadsheet,
  History,
  Landmark,
  ReceiptText,
  ScrollText,
  Settings2,
  SlidersHorizontal,
  TriangleAlert,
  UserCog,
  Users,
  WalletCards,
  Wrench
} from "lucide-react";

// Icons for the pages in utils/navigationAccess.js (pageLabels). Kept apart so the navigation
// rules stay plain JavaScript that the node tests can import.
const icons = {
  "/": BarChart3,
  "/requests": ReceiptText,
  "/requests/new": FilePlus2,
  "/approvals": ClipboardCheck,
  "/my-team": Users,
  "/batch-invoices": FileArchive,
  "/accounting/invoice-observations": TriangleAlert,
  "/accounting/payables": BookOpenCheck,
  "/accounting/bank-files": FileCheck2,
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
  "/configuration/accounting-mappings": BookOpenCheck,
  "/super-admin": Gauge,
  "/super-admin/administrators": UserCog,
  "/super-admin/alerts": BellRing,
  "/super-admin/audit": ScrollText,
  "/super-admin/settings": Wrench
};

export function navigationIcon(path) {
  return icons[path] || (path?.startsWith("/configuration/") ? SlidersHorizontal : Settings2);
}

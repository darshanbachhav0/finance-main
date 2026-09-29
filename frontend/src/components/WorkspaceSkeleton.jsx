import { useLanguage } from "../context/LanguageContext.jsx";
import UmaPulse from "./UmaPulse.jsx";

// One loading pattern for every list: placeholder rows whose lines vary in width, so a table
// that is loading and a page that is still being fetched look the same.
const LINE_WIDTHS = ["72%", "54%", "64%", "46%", "58%", "40%"];
const lineWidth = (row, column) => LINE_WIDTHS[(row * 2 + column) % LINE_WIDTHS.length];

// Skeleton <tr> rows for DataTable. `cells` lists each column: "check" (checkbox or menu
// button) or "line" (text).
export function TableSkeletonRows({ cells, rowCount = 6 }) {
  return Array.from({ length: rowCount }).map((_, rowIndex) => (
    <tr key={`loading-${rowIndex}`} className="skeleton-row" aria-hidden="true">
      {cells.map((kind, cellIndex) => (
        <td key={cellIndex} className={kind === "check" ? "skeleton-check-cell" : undefined}>
          {kind === "check"
            ? <span className="skeleton skeleton-check" />
            : <span className="skeleton skeleton-line" style={{ width: lineWidth(rowIndex, cellIndex) }} />}
        </td>
      ))}
    </tr>
  ));
}

// The same rows outside a table (page-level loading, lists that are not DataTables).
export function ListSkeleton({ rowCount = 6, columnCount = 4 }) {
  return (
    <div className="list-skeleton" aria-hidden="true">
      {Array.from({ length: rowCount }).map((_, rowIndex) => (
        <div className="list-skeleton-row" key={rowIndex}>
          {Array.from({ length: columnCount }).map((__, cellIndex) => (
            <span key={cellIndex} className="skeleton skeleton-line" style={{ width: lineWidth(rowIndex, cellIndex) }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function WorkspaceSkeleton({ label = "Loading records..." }) {
  const { t } = useLanguage();
  return <div className="workspace-loading" role="status">
    <span className="loading-caption"><UmaPulse />{t(label)}</span>
    <div aria-hidden="true">
      <span className="skeleton skeleton-line loading-title" />
      <div className="workspace-panel loading-panel"><ListSkeleton /></div>
    </div>
  </div>;
}

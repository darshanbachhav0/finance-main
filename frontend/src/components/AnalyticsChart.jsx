import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useId, useMemo } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { useTheme } from "../context/ThemeContext.jsx";
import { formatNumber, localeFor } from "../utils/formatters.js";

const palette = ["#c91545", "#45404e", "#19733d", "#d18a00", "#2463a6", "#7a5ca3", "#667581", "#b4232c"];
const darkPalette = ["#ff789a", "#bcb4ca", "#78d49b", "#edc06a", "#91beef", "#ba9fe9", "#a9bbc8", "#ff909b"];

// Category values often arrive as workflow codes (TXT_GENERADO, PAYMENT_FILE_CREATED, ENTREGA_RENDIR).
// They are shown through the dictionary so axes, legends and tooltips never display raw codes.
const LABEL_KEY = "__label";
const MAX_CATEGORY_CHARS = 24;
const shorten = (text) => (text.length > MAX_CATEGORY_CHARS ? `${text.slice(0, MAX_CATEGORY_CHARS - 1)}…` : text);

function CategoryTick({ x, y, payload, anchor = "end", dy = 4 }) {
  const full = String(payload?.value ?? "");
  return <g transform={`translate(${x},${y})`}><title>{full}</title><text textAnchor={anchor} dy={dy} className="chart-category-tick">{shorten(full)}</text></g>;
}

function ExactTooltip({ active, payload, label, valueFormatter, t }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      {label !== undefined && <strong>{label}</strong>}
      {payload.map((item) => (
        <div key={`${item.dataKey}-${item.name}`}><span style={{ background: item.color }} />{t(item.name)}<b>{valueFormatter(item.value, item.dataKey)}</b></div>
      ))}
    </div>
  );
}

function ChartFallback({ data, xKey, series, valueFormatter, t }) {
  return (
    <details className="chart-data-fallback">
      <summary>{t("View exact data")}</summary>
      <div className="chart-table-scroll">
        <table>
          <thead><tr><th>{t("Category")}</th>{series.map((item) => <th key={item.key}>{t(item.label)}</th>)}</tr></thead>
          <tbody>{data.map((row, index) => <tr key={`${row[xKey]}-${index}`}><th>{row[LABEL_KEY] || t("Unassigned")}</th>{series.map((item) => <td key={item.key}>{valueFormatter(row[item.key], item.key)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

export default function AnalyticsChart({
  title,
  description,
  data = [],
  type = "bar",
  xKey = "name",
  series = [{ key: "value", label: "Value" }],
  height = 270,
  loading = false,
  error = "",
  emptyLabel = "No data is available for the selected filters.",
  valueFormatter = (value) => formatNumber(value),
  onDrillDown,
  horizontal = false,
  compact = false
}) {
  const { t, language } = useLanguage();
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const { theme } = useTheme();
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const dark = theme === "dark" || theme === "system" && systemDark;
  const colors = dark ? darkPalette : palette;
  const titleId = useId();
  const chartSeries = series.map((item) => {
    const color = ({ "#087c75": "#c91545", "#17344c": "#45404e" })[item.color] || item.color;
    return { ...item, label: t(item.label), color: dark && palette.includes(color) ? darkPalette[palette.indexOf(color)] : color };
  });
  // Category colors belong to donuts/single-series bars; grouped bars use their series color.
  const chartData = useMemo(() => data.map((row, index) => {
    const labelled = { ...row, [LABEL_KEY]: row[xKey] === undefined || row[xKey] === null || row[xKey] === "" ? "" : t(String(row[xKey])) };
    return type === "donut" || type === "bar" && series.length === 1
      ? { ...labelled, fill: row.fill || colors[index % colors.length] }
      : labelled;
  }), [data, colors, type, series.length, xKey, t]);
  // Compact axis numbers (2,6 M instead of 2600000); exact values stay in tooltips and the data table.
  const axisNumber = useMemo(() => {
    const format = new Intl.NumberFormat(localeFor(language), { notation: "compact", maximumFractionDigits: 1 });
    return (value) => format.format(Number(value || 0));
  }, [language]);
  // Counts (requests, approvals) get whole-number ticks; amounts keep compact decimals.
  const integerValues = chartData.every((row) => series.every((item) => Number.isInteger(Number(row[item.key] ?? 0))));
  const longestLabel = chartData.reduce((max, row) => Math.max(max, Math.min(String(row[LABEL_KEY] || "").length, MAX_CATEGORY_CHARS)), 0);
  const categoryAxisWidth = Math.min(180, Math.max(72, Math.round(longestLabel * 6.6) + 12));
  // Horizontal bars get a fixed row height so category labels never collide.
  const chartHeight = horizontal ? Math.max(height, chartData.length * 30 + 48) : height;
  const common = { data: chartData, margin: horizontal ? { top: 8, right: 16, left: 20, bottom: 4 } : { top: 8, right: 10, left: 0, bottom: 4 }, accessibilityLayer: true };
  const tooltip = <Tooltip cursor={{ fill: "rgba(12, 27, 42, 0.045)" }} content={<ExactTooltip valueFormatter={valueFormatter} t={t} />} />;

  function renderChart() {
    if (type === "donut") {
      return <PieChart accessibilityLayer><Pie isAnimationActive={!reduceMotion} animationDuration={220} data={chartData} dataKey={series[0].key} nameKey={LABEL_KEY} innerRadius="54%" outerRadius="80%" paddingAngle={2} stroke="#fff" strokeWidth={2} onClick={(entry) => onDrillDown?.(entry)} />{tooltip}<Legend verticalAlign="bottom" iconType="circle" iconSize={8} /></PieChart>;
    }
    if (type === "line") {
      return <LineChart {...common}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey={LABEL_KEY} tickLine={false} axisLine={false} minTickGap={24} /><YAxis tickLine={false} axisLine={false} width={54} tickFormatter={axisNumber} allowDecimals={!integerValues} />{tooltip}<Legend iconType="circle" iconSize={8} />{chartSeries.map((item, index) => <Line isAnimationActive={!reduceMotion} animationDuration={220} key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={item.color || colors[index]} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4, onClick: (_, event) => onDrillDown?.(event?.payload) }} />)}</LineChart>;
    }
    if (type === "area") {
      return <AreaChart {...common}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey={LABEL_KEY} tickLine={false} axisLine={false} minTickGap={24} /><YAxis tickLine={false} axisLine={false} width={54} tickFormatter={axisNumber} allowDecimals={!integerValues} />{tooltip}<Legend iconType="circle" iconSize={8} />{chartSeries.map((item, index) => <Area isAnimationActive={!reduceMotion} animationDuration={220} key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={item.color || colors[index]} fill={item.fill || `${item.color || colors[index]}24`} strokeWidth={2} activeDot={{ r: 4, onClick: (_, event) => onDrillDown?.(event?.payload) }} />)}</AreaChart>;
    }
    return <BarChart {...common} layout={horizontal ? "vertical" : "horizontal"} barCategoryGap={compact ? "24%" : "16%"}>
      <CartesianGrid strokeDasharray="3 3" horizontal={!horizontal} vertical={horizontal} />
      {horizontal ? <><XAxis type="number" tickLine={false} axisLine={false} tickFormatter={axisNumber} allowDecimals={!integerValues} /><YAxis type="category" dataKey={LABEL_KEY} tickLine={false} axisLine={false} width={categoryAxisWidth} interval={0} tick={<CategoryTick />} /></> : <><XAxis dataKey={LABEL_KEY} tickLine={false} axisLine={false} minTickGap={20} tick={<CategoryTick anchor="middle" dy={12} />} /><YAxis tickLine={false} axisLine={false} width={54} tickFormatter={axisNumber} allowDecimals={!integerValues} /></>}
      {tooltip}
      {series.length > 1 && <Legend iconType="circle" iconSize={8} />}
      {chartSeries.map((item, index) => <Bar isAnimationActive={!reduceMotion} animationDuration={220} key={item.key} dataKey={item.key} name={item.label} stackId={item.stackId} fill={item.color || colors[index]} radius={horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]} maxBarSize={38} onClick={(entry) => onDrillDown?.(entry?.payload || entry)} />)}
    </BarChart>;
  }

  return (
    <section className={`analytics-panel${onDrillDown ? " is-interactive" : ""}`} aria-labelledby={titleId}>
      <header className="analytics-heading"><div><h3 id={titleId}>{t(title)}</h3>{description && <p>{t(description)}</p>}</div>{onDrillDown && <span>{t("Select a chart item to drill down")}</span>}</header>
      {loading ? <div className="chart-skeleton" style={{ height: chartHeight }} aria-label={t("Loading chart...")}><span className="skeleton skeleton-block" /></div> : error ? <div className="chart-state error" role="alert">{t(error)}</div> : chartData.length ? <>
        <div className="chart-canvas" style={{ height: chartHeight }} role="img" aria-label={`${t(title)}. ${t(description || "Interactive financial chart.")}`}>
          <ResponsiveContainer width="100%" height="100%">{renderChart()}</ResponsiveContainer>
        </div>
        <ChartFallback data={chartData} xKey={xKey} series={chartSeries} valueFormatter={valueFormatter} t={t} />
      </> : <div className="chart-state">{t(emptyLabel)}</div>}
    </section>
  );
}

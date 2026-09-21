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

const palette = ["#c91545", "#45404e", "#19733d", "#d18a00", "#2463a6", "#7a5ca3", "#667581", "#b4232c"];
const darkPalette = ["#ff789a", "#bcb4ca", "#78d49b", "#edc06a", "#91beef", "#ba9fe9", "#a9bbc8", "#ff909b"];

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

function ChartFallback({ data, xKey, series, valueFormatter, t, onDrillDown }) {
  return (
    <details className="chart-data-fallback">
      <summary>{t("View exact data")}</summary>
      <div className="chart-table-scroll">
        <table>
          <thead><tr><th>{t("Category")}</th>{series.map((item) => <th key={item.key}>{t(item.label)}</th>)}</tr></thead>
          <tbody>{data.map((row, index) => <tr key={`${row[xKey]}-${index}`}><th>{onDrillDown ? <button type="button" className="text-button" onClick={() => onDrillDown(row)}>{row[xKey] || t("Unassigned")}</button> : row[xKey] || t("Unassigned")}</th>{series.map((item) => <td key={item.key}>{valueFormatter(row[item.key], item.key)}</td>)}</tr>)}</tbody>
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
  valueFormatter = (value) => Number(value || 0).toLocaleString(),
  onDrillDown,
  horizontal = false,
  compact = false
}) {
  const { t } = useLanguage();
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
  const chartData = useMemo(() => data.map((row, index) => (
    type === "donut" || type === "bar" && series.length === 1
      ? { ...row, fill: row.fill || colors[index % colors.length] }
      : row
  )), [data, colors, type, series.length]);
  const common = { data: chartData, margin: horizontal ? { top: 8, right: 16, left: 20, bottom: 4 } : { top: 8, right: 10, left: 0, bottom: 4 }, accessibilityLayer: true };
  const tooltip = <Tooltip cursor={{ fill: "rgba(12, 27, 42, 0.045)" }} content={<ExactTooltip valueFormatter={valueFormatter} t={t} />} />;

  function renderChart() {
    if (type === "donut") {
      return <PieChart accessibilityLayer><Pie isAnimationActive={!reduceMotion} animationDuration={220} data={chartData} dataKey={series[0].key} nameKey={xKey} innerRadius="54%" outerRadius="80%" paddingAngle={2} stroke="#fff" strokeWidth={2} onClick={(entry) => onDrillDown?.(entry)} />{tooltip}<Legend verticalAlign="bottom" iconType="circle" iconSize={8} /></PieChart>;
    }
    if (type === "line") {
      return <LineChart {...common}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey={xKey} tickLine={false} axisLine={false} minTickGap={24} /><YAxis tickLine={false} axisLine={false} width={54} />{tooltip}<Legend iconType="circle" iconSize={8} />{chartSeries.map((item, index) => <Line isAnimationActive={!reduceMotion} animationDuration={220} key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={item.color || colors[index]} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4, onClick: (_, event) => onDrillDown?.(event?.payload) }} />)}</LineChart>;
    }
    if (type === "area") {
      return <AreaChart {...common}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey={xKey} tickLine={false} axisLine={false} minTickGap={24} /><YAxis tickLine={false} axisLine={false} width={54} />{tooltip}<Legend iconType="circle" iconSize={8} />{chartSeries.map((item, index) => <Area isAnimationActive={!reduceMotion} animationDuration={220} key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={item.color || colors[index]} fill={item.fill || `${item.color || colors[index]}24`} strokeWidth={2} activeDot={{ r: 4, onClick: (_, event) => onDrillDown?.(event?.payload) }} />)}</AreaChart>;
    }
    return <BarChart {...common} layout={horizontal ? "vertical" : "horizontal"} barCategoryGap={compact ? "24%" : "16%"}>
      <CartesianGrid strokeDasharray="3 3" horizontal={!horizontal} vertical={horizontal} />
      {horizontal ? <><XAxis type="number" tickLine={false} axisLine={false} /><YAxis type="category" dataKey={xKey} tickLine={false} axisLine={false} width={92} /></> : <><XAxis dataKey={xKey} tickLine={false} axisLine={false} minTickGap={20} /><YAxis tickLine={false} axisLine={false} width={54} /></>}
      {tooltip}
      {series.length > 1 && <Legend iconType="circle" iconSize={8} />}
      {chartSeries.map((item, index) => <Bar isAnimationActive={!reduceMotion} animationDuration={220} key={item.key} dataKey={item.key} name={item.label} stackId={item.stackId} fill={item.color || colors[index]} radius={horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]} maxBarSize={38} onClick={(entry) => onDrillDown?.(entry?.payload || entry)} />)}
    </BarChart>;
  }

  return (
    <section className={`analytics-panel${onDrillDown ? " is-interactive" : ""}`} aria-labelledby={titleId}>
      <header className="analytics-heading"><div><h3 id={titleId}>{t(title)}</h3>{description && <p>{t(description)}</p>}</div>{onDrillDown && <span>{t("Select a chart item to drill down")}</span>}</header>
      {loading ? <div className="chart-skeleton" style={{ height }} aria-label={t("Loading chart...")}><span className="skeleton skeleton-block" /></div> : error ? <div className="chart-state error" role="alert">{t(error)}</div> : chartData.length ? <>
        <div className="chart-canvas" style={{ height }} role="img" aria-label={`${t(title)}. ${t(description || "Interactive financial chart.")}`}>
          <ResponsiveContainer width="100%" height="100%">{renderChart()}</ResponsiveContainer>
        </div>
        <ChartFallback onDrillDown={onDrillDown} data={chartData} xKey={xKey} series={chartSeries} valueFormatter={valueFormatter} t={t} />
      </> : <div className="chart-state">{t(emptyLabel)}</div>}
    </section>
  );
}

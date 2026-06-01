import { applyStaticTranslations } from "./i18n/dom.js";
import { t } from "./i18n/en.js";

const EVENT_KEYS = [
  "page_view",
  "report_analyzed",
  "browser_report_analyzed",
  "sample_report_analyzed",
  "parse_error",
  "summary_copied",
  "json_export",
  "print_opened",
];
const CHART_DAYS = 7;

const els = {
  grid: document.querySelector("#statsGrid"),
  charts: document.querySelector("#statsCharts"),
  status: document.querySelector("#statsStatus"),
};

applyStaticTranslations();
await trackStatEvent("page_view");
loadStats();

async function loadStats() {
  try {
    const response = await fetch("/api/stats");
    if (!response.ok) throw new Error(`Stats API returned ${response.status}`);
    renderStats(await response.json());
  } catch {
    els.status.textContent = t("stats.unavailable");
    els.grid.innerHTML = "";
  }
}

function renderStats(stats) {
  const totals = stats?.totals ?? {};
  const dailySeries = buildDailySeries(stats?.daily ?? []);
  const cards = EVENT_KEYS.map((eventName) => statCard(
    eventName,
    t(`stats.events.${eventName}`),
    formatNumber(totals[eventName]),
    t(`stats.eventDescriptions.${eventName}`),
    sparkline(eventName, dailySeries, t(`stats.events.${eventName}`)),
  ));
  cards.push(statCard(
    "analysis_success_rate",
    t("stats.successRate"),
    formatPercent(successRate(totals)),
    t("stats.eventDescriptions.analysis_success_rate"),
    sparkline("analysis_success_rate", dailySeries, t("stats.successRate")),
  ));

  els.grid.innerHTML = cards.join("");
  renderCharts(dailySeries);
  els.status.textContent = stats?.updatedAt
    ? t("stats.lastUpdated", { timestamp: formatDate(stats.updatedAt) })
    : t("stats.notRecorded");
}

function renderCharts(dailySeries) {
  els.charts.innerHTML = renderDailyChart(dailySeries);
}

function renderDailyChart(dailySeries) {
  const visits = seriesValues(dailySeries, "page_view");
  const analyzed = seriesValues(dailySeries, "report_analyzed");
  const failures = seriesValues(dailySeries, "parse_error");
  const width = 720;
  const height = 250;
  const padding = 24;
  const max = maxSeriesValue(visits, analyzed, failures);
  const visitPoints = linePoints(visits, width, height, padding, max);
  const analyzedPoints = linePoints(analyzed, width, height, padding, max);
  const failurePoints = linePoints(failures, width, height, padding, max);
  const startDate = dailySeries[0]?.label ?? "";
  const endDate = dailySeries.at(-1)?.label ?? "";

  return `
    <article class="daily-chart-card">
      <div class="stats-chart-head">
        <h3>${escapeHtml(t("stats.charts.dailyActivity.title"))}</h3>
        <p>${escapeHtml(t("stats.charts.dailyActivity.description"))}</p>
      </div>
      <svg class="daily-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(t("stats.charts.dailyActivity.ariaLabel"))}" preserveAspectRatio="none">
        <path class="chart-gridline" d="M ${padding} ${padding} H ${width - padding}"></path>
        <path class="chart-gridline" d="M ${padding} ${height / 2} H ${width - padding}"></path>
        <path class="chart-gridline" d="M ${padding} ${height - padding} H ${width - padding}"></path>
        <path class="daily-area accent" d="${escapeAttr(areaPath(visitPoints, height, padding))}"></path>
        <path class="daily-line accent" d="${escapeAttr(linePath(visitPoints))}"></path>
        <path class="daily-line success" d="${escapeAttr(linePath(analyzedPoints))}"></path>
        <path class="daily-line danger" d="${escapeAttr(linePath(failurePoints))}"></path>
        ${pointMarkers(visitPoints, "accent")}
        ${pointMarkers(analyzedPoints, "success")}
        ${pointMarkers(failurePoints, "danger")}
      </svg>
      <div class="daily-axis" aria-hidden="true">
        <span>${escapeHtml(startDate)}</span>
        <span>${escapeHtml(endDate)}</span>
      </div>
      <div class="chart-legend">
        ${legendItem("accent", t("stats.events.page_view"), maxValue(visits))}
        ${legendItem("success", t("stats.events.report_analyzed"), maxValue(analyzed))}
        ${legendItem("danger", t("stats.events.parse_error"), maxValue(failures))}
      </div>
    </article>
  `;
}

function statCard(eventName, label, value, description, trend) {
  return `
    <article class="stat-card" data-event="${escapeAttr(eventName)}">
      <div class="stat-card-head">
        <span class="stat-label">${escapeHtml(label)}</span>
        <span class="stat-card-icon" aria-hidden="true"></span>
      </div>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(description)}</p>
      ${trend}
    </article>
  `;
}

function sparkline(eventName, dailySeries, label) {
  const values = eventName === "analysis_success_rate"
    ? dailySeries.map((row) => {
      const analyzed = numberValue(row.totals.report_analyzed);
      const failed = numberValue(row.totals.parse_error);
      return row.hasData && analyzed + failed ? Math.round((analyzed / (analyzed + failed)) * 100) : null;
    })
    : seriesValues(dailySeries, eventName);
  const width = 160;
  const height = 48;
  const padding = 4;
  const max = maxSeriesValue(values);
  const points = linePoints(values, width, height, padding, max);
  return `
    <svg class="sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(label)} ${escapeAttr(t("stats.sparklineLabel"))}" preserveAspectRatio="none">
      <path class="sparkline-area ${escapeAttr(toneForEvent(eventName))}" d="${escapeAttr(areaPath(points, height, padding))}"></path>
      <path class="sparkline-line ${escapeAttr(toneForEvent(eventName))}" d="${escapeAttr(linePath(points))}"></path>
      ${pointMarkers(points, toneForEvent(eventName), "sparkline-dot")}
    </svg>
  `;
}

function buildDailySeries(rows) {
  const byDate = new Map((Array.isArray(rows) ? rows : []).map((row) => [row.date, row.totals ?? {}]));
  return Array.from({ length: CHART_DAYS }, (_, index) => {
    const date = isoDateDaysAgo(CHART_DAYS - index - 1);
    return {
      date,
      label: shortDate(date),
      hasData: byDate.has(date),
      totals: byDate.get(date) ?? {},
    };
  });
}

function seriesValues(dailySeries, eventName) {
  return dailySeries.map((row) => row.hasData ? numberValue(row.totals?.[eventName]) : null);
}

function linePoints(values, width, height, padding, max) {
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  return values.map((value, index) => {
    if (value === null || value === undefined) return null;
    const x = values.length === 1 ? width / 2 : padding + (usableWidth * index) / (values.length - 1);
    const y = height - padding - (numberValue(value) / max) * usableHeight;
    return [roundPoint(x), roundPoint(y)];
  });
}

function linePath(points) {
  let drawing = false;
  return points.map((point) => {
    if (!point) {
      drawing = false;
      return "";
    }
    const [x, y] = point;
    const command = drawing ? "L" : "M";
    drawing = true;
    return `${command} ${x} ${y}`;
  }).filter(Boolean).join(" ");
}

function areaPath(points, height, padding) {
  const baseline = height - padding;
  const paths = [];
  let segment = [];
  for (const point of points) {
    if (point) {
      segment.push(point);
      continue;
    }
    paths.push(areaSegmentPath(segment, baseline));
    segment = [];
  }
  paths.push(areaSegmentPath(segment, baseline));
  return paths.filter(Boolean).join(" ");
}

function areaSegmentPath(segment, baseline) {
  if (segment.length < 2) return "";
  const [firstX] = segment[0];
  const [lastX] = segment.at(-1);
  return `M ${firstX} ${baseline} ${linePath(segment).replace(/^M /, "L ")} L ${lastX} ${baseline} Z`;
}

function pointMarkers(points, tone, className = "chart-dot") {
  const radius = className === "sparkline-dot" ? 3 : 4;
  return points.filter(Boolean).map(([x, y]) => (
    `<circle class="${escapeAttr(className)} ${escapeAttr(tone)}" cx="${x}" cy="${y}" r="${radius}"></circle>`
  )).join("");
}

function legendItem(tone, label, peak) {
  return `
    <span class="chart-legend-item">
      <span class="chart-legend-dot ${escapeAttr(tone)}" aria-hidden="true"></span>
      ${escapeHtml(label)}
      <span class="chart-legend-value">${escapeHtml(t("stats.peak", { value: formatNumber(peak) }))}</span>
    </span>
  `;
}

function toneForEvent(eventName) {
  if (eventName === "parse_error") return "danger";
  if (eventName === "json_export" || eventName === "summary_copied" || eventName === "print_opened") return "warn";
  if (eventName === "report_analyzed" || eventName === "browser_report_analyzed" || eventName === "sample_report_analyzed" || eventName === "analysis_success_rate") return "success";
  return "accent";
}

function isoDateDaysAgo(offset) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function shortDate(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(parsed);
}

function roundPoint(value) {
  return Math.round(value * 10) / 10;
}

function maxSeriesValue(...series) {
  return Math.max(1, ...series.flat().filter((value) => value !== null && value !== undefined).map(numberValue));
}

function maxValue(values) {
  return Math.max(0, ...values.filter((value) => value !== null && value !== undefined).map(numberValue));
}

function successRate(totals) {
  const analyzed = numberValue(totals.report_analyzed);
  const failed = numberValue(totals.parse_error);
  const denominator = analyzed + failed;
  return denominator ? analyzed / denominator : 0;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(numberValue(value));
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function formatPercent(value) {
  return new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";
  return date.toLocaleString();
}

function trackStatEvent(eventName) {
  return fetch("/api/stats/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: eventName }),
    keepalive: true,
  }).catch(() => {});
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

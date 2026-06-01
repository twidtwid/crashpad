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
const TREND_MIN_DAYS = 2;
const DEFAULT_WINDOW = "7d";
const WINDOWS = new Map([
  ["1d", 1],
  ["7d", 7],
  ["30d", 30],
  ["90d", 90],
]);

const els = {
  grid: document.querySelector("#statsGrid"),
  charts: document.querySelector("#statsCharts"),
  status: document.querySelector("#statsStatus"),
  windowButtons: [...document.querySelectorAll("[data-window]")],
};
let currentStats = null;

applyStaticTranslations();
syncWindowButtons(selectedWindow());
for (const button of els.windowButtons) {
  button.addEventListener("click", () => setSelectedWindow(button.dataset.window));
}
await trackStatEvent("page_view");
loadStats();

async function loadStats() {
  try {
    const response = await fetch("/api/stats");
    if (!response.ok) throw new Error(`Stats API returned ${response.status}`);
    currentStats = await response.json();
    renderStats(currentStats);
  } catch {
    els.status.textContent = t("stats.unavailable");
    els.grid.innerHTML = "";
  }
}

function renderStats(stats) {
  const windowKey = selectedWindow();
  const dailySeries = buildDailySeries(stats?.daily ?? [], stats?.startedAt, windowDays(windowKey));
  const totals = sumTotals(dailySeries);
  const trendReady = hasTrendData(dailySeries);
  const cards = EVENT_KEYS.map((eventName) => statCard(
    eventName,
    t(`stats.events.${eventName}`),
    formatNumber(totals[eventName]),
    t(`stats.cardSubtitles.${eventName}`),
    trendReady ? sparkline(eventName, dailySeries, t(`stats.events.${eventName}`)) : "",
  ));
  cards.push(statCard(
    "analysis_success_rate",
    t("stats.successRate"),
    formatPercent(successRate(totals)),
    t("stats.cardSubtitles.analysis_success_rate"),
    trendReady ? sparkline("analysis_success_rate", dailySeries, t("stats.successRate")) : "",
  ));

  els.grid.innerHTML = cards.join("");
  renderCharts(dailySeries);
  els.status.textContent = stats?.updatedAt
    ? t("stats.lastUpdated", { timestamp: formatDate(stats.updatedAt) })
    : t("stats.notRecorded");
}

function selectedWindow() {
  const params = new URLSearchParams(window.location.search);
  const candidate = params.get("window") ?? DEFAULT_WINDOW;
  return WINDOWS.has(candidate) ? candidate : DEFAULT_WINDOW;
}

function setSelectedWindow(windowKey) {
  if (!WINDOWS.has(windowKey)) return;
  const url = new URL(window.location.href);
  url.searchParams.set("window", windowKey);
  window.history.replaceState({}, "", url);
  syncWindowButtons(windowKey);
  if (currentStats) renderStats(currentStats);
}

function syncWindowButtons(windowKey) {
  for (const button of els.windowButtons) {
    const isActive = button.dataset.window === windowKey;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

function windowDays(windowKey) {
  return WINDOWS.get(windowKey) ?? WINDOWS.get(DEFAULT_WINDOW);
}

function renderCharts(dailySeries) {
  els.charts.innerHTML = hasTrendData(dailySeries)
    ? renderDailyChart(dailySeries)
    : renderNotEnoughHistory(dailySeries);
}

function renderNotEnoughHistory(dailySeries) {
  const latest = dailySeries.findLast((row) => row.hasData) ?? dailySeries.at(-1);
  const latestTotals = latest?.totals ?? {};
  return `
    <article class="daily-chart-card daily-chart-card--empty">
      <div class="stats-chart-head">
        <h3>${escapeHtml(t("stats.charts.dailyActivity.title"))}</h3>
        <p>${escapeHtml(t("stats.charts.dailyActivity.notEnoughHistory", { date: latest?.label ?? "" }))}</p>
      </div>
      <div class="daily-summary-grid" role="list" aria-label="${escapeAttr(t("stats.charts.dailyActivity.todayLabel"))}">
        ${summaryMetric("accent", t("stats.events.page_view"), latestTotals.page_view)}
        ${summaryMetric("success", t("stats.events.report_analyzed"), latestTotals.report_analyzed)}
        ${summaryMetric("danger", t("stats.events.parse_error"), latestTotals.parse_error)}
      </div>
    </article>
  `;
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
  const axis = axisLabels(startDate, endDate);

  return `
    <article class="daily-chart-card">
      <div class="stats-chart-head">
        <h3>${escapeHtml(t("stats.charts.dailyActivity.title"))}</h3>
        <p>${escapeHtml(t("stats.charts.dailyActivity.description"))}</p>
      </div>
      <div class="chart-legend chart-legend--top">
        ${legendItem("accent", t("stats.events.page_view"), maxValue(visits))}
        ${legendItem("success", t("stats.events.report_analyzed"), maxValue(analyzed))}
        ${legendItem("danger", t("stats.events.parse_error"), maxValue(failures))}
      </div>
      <svg class="daily-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(t("stats.charts.dailyActivity.ariaLabel"))}" preserveAspectRatio="none">
        <path class="chart-gridline" d="M ${padding} ${padding} H ${width - padding}"></path>
        <path class="chart-gridline" d="M ${padding} ${height / 2} H ${width - padding}"></path>
        <path class="chart-gridline" d="M ${padding} ${height - padding} H ${width - padding}"></path>
        <path class="daily-area accent" d="${escapeAttr(areaPath(visitPoints, height, padding))}"></path>
        <path class="daily-line accent" d="${escapeAttr(linePath(visitPoints))}"></path>
        <path class="daily-line success" d="${escapeAttr(linePath(analyzedPoints))}"></path>
        <path class="daily-line danger" d="${escapeAttr(linePath(failurePoints))}"></path>
      </svg>
      <div class="daily-axis" aria-hidden="true">
        ${axis.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
      </div>
    </article>
  `;
}

function statCard(eventName, label, value, subtitle, trend) {
  const tone = toneForEvent(eventName);
  return `
    <article class="stat-card" data-event="${escapeAttr(eventName)}" data-tone="${escapeAttr(tone)}">
      <div class="stat-card-label">${escapeHtml(label)}</div>
      <div class="stat-card-value">${escapeHtml(value)}</div>
      <div class="stat-card-sub">${escapeHtml(subtitle)}</div>
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
  if (!hasTrendValues(values)) return "";
  const width = 160;
  const height = 48;
  const padding = 4;
  const max = maxSeriesValue(values);
  const points = linePoints(values, width, height, padding, max);
  const tone = toneForEvent(eventName);
  const gradientId = `spark-${eventName.replaceAll("_", "-")}`;
  return `
    <div class="stat-card-spark" aria-label="${escapeAttr(label)} ${escapeAttr(t("stats.sparklineLabel"))}">
      <svg class="sparkline" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false" preserveAspectRatio="none">
        <defs>
          <linearGradient id="${escapeAttr(gradientId)}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="currentColor" stop-opacity="0.22"></stop>
            <stop offset="100%" stop-color="currentColor" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        <path class="sparkline-area" d="${escapeAttr(areaPath(points, height, padding))}" fill="url(#${escapeAttr(gradientId)})"></path>
        <path class="sparkline-line" d="${escapeAttr(linePath(points))}"></path>
      </svg>
    </div>
  `;
}

function buildDailySeries(rows, startedAt, days) {
  const byDate = new Map((Array.isArray(rows) ? rows : []).map((row) => [row.date, row.totals ?? {}]));
  return chartDates(startedAt, days).map((date) => ({
    date,
    label: shortDate(date),
    hasData: byDate.has(date),
    totals: byDate.get(date) ?? {},
  }));
}

function sumTotals(dailySeries) {
  const totals = Object.fromEntries(EVENT_KEYS.map((eventName) => [eventName, 0]));
  for (const row of dailySeries) {
    if (!row.hasData) continue;
    for (const eventName of EVENT_KEYS) {
      totals[eventName] += numberValue(row.totals?.[eventName]);
    }
  }
  return totals;
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
  return pointSegments(points).map(smoothSegmentPath).filter(Boolean).join(" ");
}

function areaPath(points, height, padding) {
  const baseline = height - padding;
  return pointSegments(points).map((segment) => areaSegmentPath(segment, baseline)).filter(Boolean).join(" ");
}

function areaSegmentPath(segment, baseline) {
  if (segment.length < 2) return "";
  const [firstX] = segment[0];
  const [lastX] = segment.at(-1);
  return `M ${firstX} ${baseline} ${smoothSegmentPath(segment).replace(/^M /, "L ")} L ${lastX} ${baseline} Z`;
}

function pointSegments(points) {
  const segments = [];
  let segment = [];
  for (const point of points) {
    if (point) {
      segment.push(point);
      continue;
    }
    if (segment.length) segments.push(segment);
    segment = [];
  }
  if (segment.length) segments.push(segment);
  return segments;
}

function smoothSegmentPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return "";
  if (points.length === 2) return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;

  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const hs = xs.slice(0, -1).map((x, index) => xs[index + 1] - x);
  const deltas = hs.map((h, index) => h ? (ys[index + 1] - ys[index]) / h : 0);
  const tangents = Array(points.length).fill(0);
  tangents[0] = deltas[0];
  tangents[tangents.length - 1] = deltas.at(-1);
  for (let index = 1; index < points.length - 1; index += 1) {
    if (deltas[index - 1] * deltas[index] <= 0) {
      tangents[index] = 0;
    } else {
      const w1 = 2 * hs[index] + hs[index - 1];
      const w2 = hs[index] + 2 * hs[index - 1];
      const denominator = (w1 / deltas[index - 1]) + (w2 / deltas[index]);
      tangents[index] = denominator ? (w1 + w2) / denominator : 0;
    }
  }

  const commands = [`M ${xs[0]} ${ys[0]}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const h = hs[index];
    const c1x = roundPoint(xs[index] + h / 3);
    const c1y = roundPoint(ys[index] + (tangents[index] * h) / 3);
    const c2x = roundPoint(xs[index + 1] - h / 3);
    const c2y = roundPoint(ys[index + 1] - (tangents[index + 1] * h) / 3);
    commands.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${xs[index + 1]} ${ys[index + 1]}`);
  }
  return commands.join(" ");
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

function summaryMetric(tone, label, value) {
  return `
    <div class="daily-summary-metric ${escapeAttr(tone)}" role="listitem">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatNumber(value))}</strong>
    </div>
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

function chartDates(startedAt, days) {
  const today = isoDateDaysAgo(0);
  const fallbackStart = isoDateDaysAgo(Math.max(1, days) - 1);
  const startedDay = dateKey(startedAt);
  const start = startedDay ? maxDateKey(startedDay, fallbackStart) : today;
  return dateRange(start > today ? today : start, today, days);
}

function dateRange(start, end, limit = CHART_DAYS) {
  const dates = [];
  const current = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (current <= last && dates.length < limit) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates.length ? dates : [end];
}

function dateKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function maxDateKey(left, right) {
  return left > right ? left : right;
}

function axisLabels(startDate, endDate) {
  if (!startDate) return [];
  return startDate === endDate ? [startDate] : [startDate, endDate];
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
  const max = Math.max(1, ...series.flat().filter((value) => value !== null && value !== undefined).map(numberValue));
  return roundPoint(max * 1.1);
}

function maxValue(values) {
  return Math.max(0, ...values.filter((value) => value !== null && value !== undefined).map(numberValue));
}

function hasTrendData(dailySeries) {
  return dailySeries.filter((row) => row.hasData).length >= TREND_MIN_DAYS;
}

function hasTrendValues(values) {
  const present = values.filter((value) => value !== null && value !== undefined);
  return present.length >= TREND_MIN_DAYS && present.some((value) => numberValue(value) > 0);
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

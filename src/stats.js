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
// Events still tracked and summed, but not given their own card. The example
// (sample_report_analyzed) total is folded into report_analyzed, so showing it
// as a peer card double-counts; dropping it also keeps an even eight cards.
const CARD_EVENT_KEYS = EVENT_KEYS.filter((eventName) => eventName !== "sample_report_analyzed");
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
  const cards = CARD_EVENT_KEYS.map((eventName) => statCard(
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
  // Day one: the per-event totals already live in the cards above, so restating
  // them here is pure duplication. Show a designed empty state instead and let
  // the chart unlock once a second day gives the trend lines something to draw.
  const latest = dailySeries.findLast((row) => row.hasData) ?? dailySeries.at(-1);
  return `
    <article class="daily-chart-card daily-chart-card--empty">
      <div class="chart-empty">
        <span class="chart-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M4 5v14h16"></path>
            <path d="m7 14 3-3 3 2 4-5"></path>
          </svg>
        </span>
        <h3>${escapeHtml(t("stats.charts.dailyActivity.title"))}</h3>
        <p>${escapeHtml(t("stats.charts.dailyActivity.notEnoughHistory", { date: latest?.label ?? "" }))}</p>
      </div>
    </article>
  `;
}

const CHART_SERIES = [
  { key: "page_view", tone: "accent" },
  { key: "report_analyzed", tone: "success" },
  { key: "parse_error", tone: "danger" },
];

function renderDailyChart(dailySeries) {
  const valuesByKey = Object.fromEntries(
    CHART_SERIES.map((series) => [series.key, seriesValues(dailySeries, series.key)]),
  );
  const dataMax = maxValue(CHART_SERIES.flatMap((series) => valuesByKey[series.key]));
  const ticks = yTicks(dataMax, 4);
  const xTickIndexes = axisTickIndexes(dailySeries.length);

  // Plot is drawn in a normalized 0..100 box and stretched to fill its column;
  // non-scaling strokes keep line weight uniform, and axis labels live in HTML
  // so they stay crisp and correctly sized at every viewport width.
  const gridlines = ticks.values
    .map((value) => {
      const y = roundPoint(100 - (value / ticks.max) * 100);
      return `<path class="chart-gridline${value === 0 ? " chart-gridline--base" : ""}" vector-effect="non-scaling-stroke" d="M 0 ${y} H 100"></path>`;
    })
    .join("");
  const lines = CHART_SERIES
    .map((series) => {
      const points = plotPoints(valuesByKey[series.key], ticks.max);
      return `<path class="daily-line ${series.tone}" vector-effect="non-scaling-stroke" d="${escapeAttr(linePath(points))}"></path>`;
    })
    .join("");
  const yLabels = ticks.values
    .map((value) => {
      const top = roundPoint((1 - value / ticks.max) * 100);
      return `<span style="top:${top}%">${escapeHtml(formatNumber(value))}</span>`;
    })
    .join("");
  const count = dailySeries.length;
  const xLabels = xTickIndexes
    .map((index) => {
      const left = count <= 1 ? 50 : roundPoint((index / (count - 1)) * 100);
      return `<span style="left:${left}%">${escapeHtml(dailySeries[index]?.label ?? "")}</span>`;
    })
    .join("");

  return `
    <article class="daily-chart-card">
      <div class="stats-chart-head">
        <h3>${escapeHtml(t("stats.charts.dailyActivity.title"))}</h3>
        <p>${escapeHtml(t("stats.charts.dailyActivity.description"))}</p>
      </div>
      <div class="chart-legend chart-legend--top">
        ${CHART_SERIES.map((series) => legendItem(
          series.tone,
          t(`stats.events.${series.key}`),
          latestValue(valuesByKey[series.key]),
          maxValue(valuesByKey[series.key]),
        )).join("")}
      </div>
      <div class="daily-chart-frame">
        <div class="chart-y-axis" aria-hidden="true">${yLabels}</div>
        <div class="chart-plot">
          <svg class="daily-chart" viewBox="0 0 100 100" role="img" aria-label="${escapeAttr(t("stats.charts.dailyActivity.ariaLabel"))}" preserveAspectRatio="none">
            ${gridlines}
            ${lines}
          </svg>
        </div>
        <div class="chart-x-axis" aria-hidden="true">${xLabels}</div>
      </div>
    </article>
  `;
}

function plotPoints(values, max) {
  const count = values.length;
  return values.map((value, index) => {
    if (value === null || value === undefined) return null;
    const x = count <= 1 ? 50 : (index / (count - 1)) * 100;
    const y = 100 - (numberValue(value) / max) * 100;
    return [roundPoint(x), roundPoint(y)];
  });
}

function yTicks(dataMax, count = 4) {
  const step = niceStep(Math.max(1, dataMax) / count);
  const max = step * count;
  const values = Array.from({ length: count + 1 }, (_, index) => index * step);
  return { max, step, values };
}

function niceStep(value) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  // 2.5 is only allowed once the magnitude keeps ticks integer (>= 10), so small
  // count axes never show fractional labels like "2.5 visits".
  let niceNormalized;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 2.5 && magnitude >= 10) niceNormalized = 2.5;
  else if (normalized <= 5) niceNormalized = 5;
  else niceNormalized = 10;
  return niceNormalized * magnitude;
}

function axisTickIndexes(count) {
  if (count <= 1) return [0];
  if (count <= 4) return Array.from({ length: count }, (_, index) => index);
  const ticks = 4;
  return Array.from({ length: ticks }, (_, index) => Math.round((index * (count - 1)) / (ticks - 1)));
}

function latestValue(values) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] !== null && values[index] !== undefined) return numberValue(values[index]);
  }
  return 0;
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

function legendItem(tone, label, latest, peak) {
  // Peak is only worth showing when it differs from the latest value; otherwise
  // "75  75 peak" reads as a duplicated typo.
  const peakNote = peak > latest
    ? `<span class="chart-legend-peak">${escapeHtml(t("stats.peak", { value: formatNumber(peak) }))}</span>`
    : "";
  return `
    <span class="chart-legend-item">
      <span class="chart-legend-dot ${escapeAttr(tone)}" aria-hidden="true"></span>
      <span class="chart-legend-name">${escapeHtml(label)}</span>
      <span class="chart-legend-value">${escapeHtml(formatNumber(latest))}</span>
      ${peakNote}
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

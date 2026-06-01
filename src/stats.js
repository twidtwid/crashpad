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
  const cards = EVENT_KEYS.map((eventName) => statCard(
    eventName,
    t(`stats.events.${eventName}`),
    formatNumber(totals[eventName]),
    t(`stats.eventDescriptions.${eventName}`),
  ));
  cards.push(statCard(
    "analysis_success_rate",
    t("stats.successRate"),
    formatPercent(successRate(totals)),
    t("stats.eventDescriptions.analysis_success_rate"),
  ));

  els.grid.innerHTML = cards.join("");
  renderCharts(totals);
  els.status.textContent = stats?.updatedAt
    ? t("stats.lastUpdated", { timestamp: formatDate(stats.updatedAt) })
    : t("stats.notRecorded");
}

function renderCharts(totals) {
  const localActions = numberValue(totals.summary_copied) + numberValue(totals.json_export) + numberValue(totals.print_opened);
  const charts = [
    {
      title: t("stats.charts.activityMix.title"),
      description: t("stats.charts.activityMix.description"),
      bars: [
        chartBar(t("stats.events.page_view"), totals.page_view, "accent"),
        chartBar(t("stats.events.report_analyzed"), totals.report_analyzed, "success"),
        chartBar(t("stats.events.parse_error"), totals.parse_error, "danger"),
        chartBar(t("stats.localActions"), localActions, "warn"),
      ],
    },
    {
      title: t("stats.charts.analysisOutcome.title"),
      description: t("stats.charts.analysisOutcome.description"),
      bars: [
        chartBar(t("stats.events.report_analyzed"), totals.report_analyzed, "success"),
        chartBar(t("stats.events.parse_error"), totals.parse_error, "danger"),
      ],
    },
    {
      title: t("stats.charts.sourceMix.title"),
      description: t("stats.charts.sourceMix.description"),
      bars: [
        chartBar(t("stats.events.browser_report_analyzed"), totals.browser_report_analyzed, "success"),
        chartBar(t("stats.events.sample_report_analyzed"), totals.sample_report_analyzed, "accent"),
      ],
    },
  ];

  els.charts.innerHTML = charts.map(renderChart).join("");
}

function renderChart(chart) {
  const max = Math.max(1, ...chart.bars.map((bar) => bar.value));
  const ariaLabel = chart.bars.map((bar) => `${bar.label}: ${formatNumber(bar.value)}`).join(", ");

  return `
    <article class="stats-chart-card">
      <div class="stats-chart-head">
        <h3>${escapeHtml(chart.title)}</h3>
        <p>${escapeHtml(chart.description)}</p>
      </div>
      <div class="bar-chart" role="img" aria-label="${escapeAttr(ariaLabel)}">
        ${chart.bars.map((bar) => renderBar(bar, max)).join("")}
      </div>
    </article>
  `;
}

function chartBar(label, value, tone) {
  return {
    label,
    value: numberValue(value),
    tone,
  };
}

function renderBar(bar, max) {
  const width = max ? Math.max(2, Math.round((bar.value / max) * 100)) : 2;
  return `
    <div class="bar-row">
      <div class="bar-row-meta">
        <span>${escapeHtml(bar.label)}</span>
        <strong>${escapeHtml(formatNumber(bar.value))}</strong>
      </div>
      <div class="bar-track" aria-hidden="true">
        <span class="bar-fill ${escapeAttr(bar.tone)}" style="width: ${width}%"></span>
      </div>
    </div>
  `;
}

function statCard(eventName, label, value, description) {
  return `
    <article class="stat-card" data-event="${escapeAttr(eventName)}">
      <div class="stat-card-head">
        <span class="stat-label">${escapeHtml(label)}</span>
        <span class="stat-card-icon" aria-hidden="true"></span>
      </div>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(description)}</p>
    </article>
  `;
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

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
  els.status.textContent = stats?.updatedAt
    ? t("stats.lastUpdated", { timestamp: formatDate(stats.updatedAt) })
    : t("stats.notRecorded");
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

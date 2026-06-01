import { applyStaticTranslations } from "./dom.js";

applyStaticTranslations();
trackStatEvent("page_view");

function trackStatEvent(eventName) {
  return fetch("/api/stats/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: eventName }),
    keepalive: true,
  }).catch(() => {});
}

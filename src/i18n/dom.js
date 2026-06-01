import { t } from "./en.js";

const ATTRIBUTE_BINDINGS = [
  ["data-i18n-aria-label", "aria-label"],
  ["data-i18n-content", "content"],
  ["data-i18n-placeholder", "placeholder"],
  ["data-i18n-title", "title"],
];

export function applyStaticTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });

  root.querySelectorAll("[data-i18n-html]").forEach((element) => {
    element.innerHTML = t(element.dataset.i18nHtml);
  });

  for (const [dataName, attributeName] of ATTRIBUTE_BINDINGS) {
    root.querySelectorAll(`[${dataName}]`).forEach((element) => {
      element.setAttribute(attributeName, t(element.getAttribute(dataName)));
    });
  }
}

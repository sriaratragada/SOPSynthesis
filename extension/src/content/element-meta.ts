// Element metadata extraction. The quality of everything downstream — step
// descriptions, selector-based dedup, future Guide Me re-finding — depends on
// what gets captured here.

import type { BBox, ElementMeta } from "../shared/types";

const MAX_TEXT = 80;
const SAFE_TOKEN = /^[A-Za-z][\w-]*$/;

function visibleText(el: Element): string | null {
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

function attr(el: Element, name: string): string | null {
  const value = el.getAttribute(name);
  return value && value.trim() ? value.trim() : null;
}

/** Short, best-effort CSS path: stop at a safe #id, max 5 segments. */
function cssPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
    if (node.id && SAFE_TOKEN.test(node.id)) {
      parts.unshift(`#${node.id}`);
      break;
    }
    let part = node.tagName.toLowerCase();
    const stableClass = [...node.classList].find((c) => SAFE_TOKEN.test(c));
    if (stableClass) part += `.${stableClass}`;
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = [...parent.children].filter((s) => s.tagName === node!.tagName);
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(" > ");
}

/** Ancestor landmark hint, enabling phrasing like "in the top navigation". */
function regionHint(el: Element): string | null {
  let node: Element | null = el;
  while (node) {
    const tag = node.tagName.toLowerCase();
    const role = node.getAttribute("role");
    if (tag === "nav" || role === "navigation") {
      const top = node.getBoundingClientRect().top + window.scrollY;
      return top < 200 ? "top navigation" : "navigation";
    }
    if (tag === "dialog" || role === "dialog" || role === "alertdialog") return "dialog";
    if (tag === "header" || role === "banner") return "header";
    if (tag === "footer" || role === "contentinfo") return "footer";
    if (tag === "aside" || role === "complementary") return "sidebar";
    node = node.parentElement;
  }
  return null;
}

export function extractElementMeta(el: Element): ElementMeta {
  return {
    tag: el.tagName.toLowerCase(),
    text: visibleText(el),
    ariaLabel: attr(el, "aria-label"),
    placeholder: attr(el, "placeholder"),
    name: attr(el, "name"),
    id: el.id || null,
    role: attr(el, "role"),
    type: attr(el, "type"),
    href: attr(el, "href"),
    alt: attr(el, "alt"),
    selector: cssPath(el),
    region: regionHint(el),
  };
}

export function normalizedBBox(el: Element): BBox | null {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    nx: rect.left / window.innerWidth,
    ny: rect.top / window.innerHeight,
    nw: rect.width / window.innerWidth,
    nh: rect.height / window.innerHeight,
  };
}

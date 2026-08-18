// Page-capture function injected into the active tab via chrome.scripting.
//
// IMPORTANT: this function is serialized (func.toString()) and runs in the page,
// so it must be fully self-contained: reference only DOM globals, never module
// scope, imports, or closures.

export interface PageContext {
  title: string;
  url: string;
  selection: string;
  description: string;
}

export function capturePageContext(): PageContext {
  const pick = (sel: string): string => {
    const el = document.querySelector(sel);
    const content = el?.getAttribute("content");
    return content ? content.trim() : "";
  };

  let description =
    pick('meta[name="description"]') ||
    pick('meta[property="og:description"]') ||
    pick('meta[name="twitter:description"]');

  if (!description) {
    const paras = Array.from(document.querySelectorAll("article p, main p, p"));
    for (const p of paras) {
      const text = (p.textContent || "").trim();
      if (text.length >= 80) {
        description = text;
        break;
      }
    }
  }

  const selection = (window.getSelection?.()?.toString() || "").trim();

  return {
    title: (document.title || "").trim(),
    url: location.href,
    selection,
    description: description.slice(0, 2000),
  };
}

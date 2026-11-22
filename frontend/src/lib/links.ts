// Клиентское зеркало backend/app/url_context.py: те же правила поиска и
// нормализации ссылок, чтобы чипы совпадали с серверным списком по URL.

const TRAILING_PUNCT = ")]}.,;:!?…«»\"'–—-";

const LINK_RE =
  /(?:https?:\/\/[^\s<>[\]()"']+|www\.[^\s<>[\]()"']+\.[^\s<>[\]()"']*|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\.[a-z]{2,}\/[^\s<>[\]()"']*)/gi;

export function normalizeUrl(raw: string): string {
  let candidate = (raw || "").trim();
  while (candidate && TRAILING_PUNCT.includes(candidate[candidate.length - 1])) {
    candidate = candidate.slice(0, -1);
  }
  if (!candidate) return "";
  if (!/^https?:\/\//i.test(candidate)) candidate = "https://" + candidate;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return "";
  }
  if (!parsed.hostname || !parsed.hostname.includes(".")) return "";
  const path = parsed.pathname || "/";
  return `https://${parsed.hostname.toLowerCase()}${path}${parsed.search}`;
}

export function extractUrls(text: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  for (const match of text?.match(LINK_RE) || []) {
    const normalized = normalizeUrl(match);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      found.push(normalized);
    }
  }
  return found;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

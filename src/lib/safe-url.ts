/**
 * Turns a callback URL into a same-origin relative path (prevents open redirects).
 * Absolute URLs are reduced to their path + query, so they can never leave the app.
 */
export function safeCallbackUrl(url: string | undefined | null, fallback = "/dashboard"): string {
  if (!url) return fallback;
  let path: string;
  try {
    const parsed = new URL(url, "http://local.invalid");
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallback;
  }
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  if (path.startsWith("/login") || path.startsWith("/api")) return fallback;
  return path;
}

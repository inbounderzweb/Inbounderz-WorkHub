/** Browser-side API client for the Route Handlers. */

export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors?: Record<string, string>
  ) {
    super(message);
  }
}

type Options = { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown; signal?: AbortSignal };

export async function api<T = unknown>(url: string, opts: Options = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    cache: "no-store",
  });

  if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/account")) {
    // Full reload on purpose: drop all client state when the session is gone.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?reason=session&callbackUrl=${encodeURIComponent(window.location.pathname)}`;
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiClientError(
      res.status,
      data?.error ?? `Request failed (${res.status})`,
      data?.fieldErrors ?? undefined
    );
  }
  return data as T;
}

/** SWR fetcher */
export const fetcher = <T,>(url: string) => api<T>(url);

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Multipart file upload to an attachment endpoint. */
export async function uploadFile<T = unknown>(url: string, file: File): Promise<T> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(url, { method: "POST", body, cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiClientError(res.status, data?.error ?? `Upload failed (${res.status})`, data?.fieldErrors);
  return data as T;
}

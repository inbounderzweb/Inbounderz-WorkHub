import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import mongoose from "mongoose";
import { ZodError, type ZodType, z } from "zod";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { hasPermission, type Permission } from "@/lib/permissions";
import { connectDB } from "@/lib/db";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors?: Record<string, string>
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, fieldErrors?: Record<string, string>) =>
  new ApiError(400, msg, fieldErrors);
export const forbidden = (msg = "You do not have permission to perform this action") =>
  new ApiError(403, msg);
export const notFound = (msg = "Not found") => new ApiError(404, msg);
export const conflict = (msg: string, fieldErrors?: Record<string, string>) =>
  new ApiError(409, msg, fieldErrors);
export const unprocessable = (msg: string, fieldErrors?: Record<string, string>) =>
  new ApiError(422, msg, fieldErrors);

const DUPLICATE_FIELD_LABELS: Record<string, string> = {
  email: "This email is already registered",
  employeeId: "This employee ID is already in use",
  name: "This name is already in use",
  code: "This code is already in use",
};

function zodFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message, fieldErrors: err.fieldErrors }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: "Please correct the highlighted fields", fieldErrors: zodFieldErrors(err) },
      { status: 422 }
    );
  }
  if (err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === 11000) {
    const keys = Object.keys((err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {});
    const fieldErrors = Object.fromEntries(keys.map((k) => [k, DUPLICATE_FIELD_LABELS[k] ?? "Already exists"]));
    return NextResponse.json(
      { error: Object.values(fieldErrors)[0] ?? "Duplicate record", fieldErrors },
      { status: 409 }
    );
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const fieldErrors = Object.fromEntries(
      Object.entries(err.errors).map(([k, v]) => [k, v.message])
    );
    return NextResponse.json({ error: "Validation failed", fieldErrors }, { status: 422 });
  }
  if (err instanceof mongoose.Error.CastError) {
    return NextResponse.json({ error: `Invalid ${err.path}` }, { status: 400 });
  }
  console.error("[api] unhandled error", err);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

type HandlerOptions = { permission?: Permission };

/**
 * Wraps a Route Handler with: DB connection, authentication (from the database,
 * not just the JWT), optional coarse permission check, and uniform error JSON.
 * Fine-grained scope checks belong in the service layer.
 */
export function withAuth<Ctx>(
  handler: (req: NextRequest, ctx: Ctx, user: CurrentUser) => Promise<unknown>,
  options: HandlerOptions = {}
) {
  return async (req: NextRequest, ctx: Ctx): Promise<Response> => {
    try {
      await connectDB();
      const user = await getCurrentUser();
      if (!user) {
        return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
      }
      if (options.permission && !hasPermission(user.role, options.permission)) throw forbidden();
      const result = await handler(req, ctx, user);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/**
 * Parses a JSON body. Requiring `application/json` also blocks cross-site form
 * posts (they cannot set this content type without a CORS preflight).
 */
export async function parseBody<S extends ZodType>(req: NextRequest, schema: S): Promise<z.output<S>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw new ApiError(415, "Expected application/json");
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Malformed JSON body");
  }
  return schema.parse(raw);
}

export function parseQuery<S extends ZodType>(req: NextRequest, schema: S): z.output<S> {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
}

export function assertObjectId(id: string, label = "id"): void {
  if (!mongoose.isValidObjectId(id) || !/^[a-f\d]{24}$/i.test(id)) throw badRequest(`Invalid ${label}`);
}

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Escapes user input for safe use inside a RegExp. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** For unauthenticated endpoints (password reset): DB connection + uniform errors. */
export function withPublic<Ctx>(handler: (req: NextRequest, ctx: Ctx) => Promise<unknown>) {
  return async (req: NextRequest, ctx: Ctx): Promise<Response> => {
    try {
      await connectDB();
      const result = await handler(req, ctx);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/**
 * For multipart uploads (which browsers can send cross-site without a preflight):
 * require the Origin header to match this app.
 */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw forbidden("Cross-origin request blocked");
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw forbidden("Cross-origin request blocked");
  }
}

/** Reads a single uploaded file from multipart form data. */
export async function readUpload(req: NextRequest): Promise<File> {
  assertSameOrigin(req);
  if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    throw new ApiError(415, "Expected multipart/form-data");
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw badRequest("Attach a file in the 'file' field");
  return file;
}

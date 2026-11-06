import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * File storage for attachments. The default driver writes to the local disk
 * (STORAGE_DIR, default ./storage/uploads) — fine for a single server. For
 * serverless or multi-instance deployments, implement the same interface on
 * S3/R2/GCS and switch drivers here.
 */
export interface StorageDriver {
  put(data: Buffer, originalName: string): Promise<string>; // returns storageKey
  get(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

// Runtime data directory: excluded from build-time file tracing.
const ROOT = path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage", "uploads"));

function safeKeyPath(key: string): string {
  const full = path.resolve(/*turbopackIgnore: true*/ ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Invalid storage key");
  return full;
}

const localDriver: StorageDriver = {
  async put(data, originalName) {
    const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10);
    const now = new Date();
    const key = path.join(
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      `${crypto.randomUUID()}${ext}`
    );
    const full = safeKeyPath(key);
    await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(full), { recursive: true });
    await fs.writeFile(/*turbopackIgnore: true*/ full, data, { flag: "wx" });
    return key;
  },
  async get(key) {
    return fs.readFile(/*turbopackIgnore: true*/ safeKeyPath(key));
  },
  async remove(key) {
    await fs.rm(/*turbopackIgnore: true*/ safeKeyPath(key), { force: true });
  },
};

export const storage: StorageDriver = localDriver;

/** Strips path components and control characters from a client file name. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 200) || "file";
}

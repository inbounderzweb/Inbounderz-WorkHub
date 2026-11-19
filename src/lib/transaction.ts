import "server-only";
import mongoose, { type ClientSession } from "mongoose";
import { connectDB } from "./db";

declare global {
  var __txSupport: Promise<boolean> | undefined;
}

/** True when the deployment is a replica set / sharded cluster (the only topologies with transactions). */
export function transactionsSupported(): Promise<boolean> {
  globalThis.__txSupport ??= (async () => {
    await connectDB();
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    return Boolean(hello.setName) || hello.msg === "isdbgrid";
  })().catch((err) => {
    globalThis.__txSupport = undefined;
    throw err;
  });
  return globalThis.__txSupport;
}

/**
 * Runs `work` in a transaction; every write inside must pass the given session.
 * On a standalone server (local dev only) it runs without atomicity and warns once; in production an
 * unsupported deployment is an error, so multi-entity writes are never silently non-atomic.
 */
export async function withTransaction<T>(work: (session: ClientSession | undefined) => Promise<T>): Promise<T> {
  if (!(await transactionsSupported())) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MongoDB deployment does not support transactions (replica set required).");
    }
    if (!globalThis.__txWarned) {
      globalThis.__txWarned = true;
      console.warn("[db] Standalone MongoDB: transactions unavailable, running without atomicity. Use `npm run db:dev`.");
    }
    return work(undefined);
  }
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => work(session));
  } finally {
    await session.endSession();
  }
}

declare global {
  var __txWarned: boolean | undefined;
}

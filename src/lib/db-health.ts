import "server-only";
import mongoose from "mongoose";
import { connectDB } from "./db";

export type DbHealth = {
  ok: boolean;
  /** replicaSet and sharded clusters support transactions; standalone does not. */
  topology: "replicaSet" | "sharded" | "standalone";
  transactionsSupported: boolean;
  serverVersion: string;
  latencyMs: number;
  /** Database name only. Never hosts, users or the connection string. */
  database: string;
};

/** Deliberately returns nothing that could identify or authenticate against the deployment. */
export async function dbHealth(): Promise<DbHealth> {
  const started = Date.now();
  await connectDB();
  const admin = mongoose.connection.db!.admin();
  const [hello, build] = await Promise.all([admin.command({ hello: 1 }), admin.command({ buildInfo: 1 })]);
  const topology = hello.msg === "isdbgrid" ? "sharded" : hello.setName ? "replicaSet" : "standalone";
  return {
    ok: true,
    topology,
    transactionsSupported: topology !== "standalone",
    serverVersion: String(build.version),
    latencyMs: Date.now() - started,
    database: mongoose.connection.name,
  };
}

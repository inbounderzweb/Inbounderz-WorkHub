/**
 * Verifies a MongoDB deployment can run the transaction-dependent features, without printing anything
 * that identifies or authenticates against it (no host, user or connection string).
 *
 *   MONGODB_URI=<target> npm run db:health
 *   npm run db:health -- --require-transactions     exit code 1 when transactions are unavailable (CI / deploy gate)
 *
 * Runs a real transaction that is always aborted, so it leaves no data behind.
 */
import "./_env";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { dbHealth } from "@/lib/db-health";

async function main() {
  await connectDB();
  const health = await dbHealth();
  let probe: "ok" | "failed" | "skipped" = "skipped";
  let probeError = "";
  if (health.transactionsSupported) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await mongoose.connection.db!.collection("_health_probe").insertOne({ at: new Date() }, { session });
        await session.abortTransaction();
      });
      probe = "ok";
    } catch (err) {
      probe = "failed";
      probeError = err instanceof Error ? err.message.slice(0, 160) : "unknown error";
    } finally {
      await session.endSession();
    }
  }
  const result = { ...health, transactionProbe: probe, ...(probeError ? { probeError } : {}) };
  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
  if (process.argv.includes("--require-transactions") && probe !== "ok") process.exit(1);
}

main().catch((err) => {
  console.error("Health check failed:", err instanceof Error ? err.message.replace(/mongodb(\+srv)?:\/\/\S+/g, "<uri>") : "unknown error");
  process.exit(1);
});

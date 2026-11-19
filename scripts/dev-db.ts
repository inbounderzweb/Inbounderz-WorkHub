/**
 * Local MongoDB for development without Atlas. Runs a real `mongod` binary (downloaded once by
 * mongodb-memory-server) as a SINGLE-NODE REPLICA SET, so multi-document transactions work exactly
 * as they do in production. Data persists in ./.data/mongo.
 *
 *   npm run db:dev
 *   MONGODB_URI=mongodb://127.0.0.1:27017/hr_portal?replicaSet=rs0&directConnection=true
 *
 * An existing standalone data directory is converted in place on first start; no data is lost.
 * Override with DEV_DB_PORT / DEV_DB_PATH.
 */
import fs from "node:fs";
import path from "node:path";
import { MongoMemoryReplSet } from "mongodb-memory-server";

async function main() {
  const dbPath = process.env.DEV_DB_PATH ?? path.join(process.cwd(), ".data", "mongo");
  fs.mkdirSync(dbPath, { recursive: true });
  const port = Number(process.env.DEV_DB_PORT ?? 27017);

  const server = await MongoMemoryReplSet.create({
    replSet: { name: "rs0", count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port, dbPath }],
  });
  console.log(`✓ Local MongoDB (replica set rs0) running at mongodb://127.0.0.1:${port}`);
  console.log(`  Use: MONGODB_URI="mongodb://127.0.0.1:${port}/hr_portal?replicaSet=rs0&directConnection=true"`);
  console.log(`  Data directory: ${dbPath}`);
  console.log("  Press Ctrl+C to stop.");

  const stop = async () => {
    await server.stop({ doCleanup: false });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

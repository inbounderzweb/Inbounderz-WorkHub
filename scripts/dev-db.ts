/**
 * Local MongoDB for development without Atlas. Runs a real `mongod` binary
 * (downloaded once by mongodb-memory-server) with data persisted in ./.data/mongo.
 *
 *   npm run db:dev        # then use MONGODB_URI=mongodb://127.0.0.1:27017/inbounderz_workhub
 */
import fs from "node:fs";
import path from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";

async function main() {
  const dbPath = path.join(process.cwd(), ".data", "mongo");
  fs.mkdirSync(dbPath, { recursive: true });
  const port = Number(process.env.DEV_DB_PORT ?? 27017);

  const server = await MongoMemoryServer.create({
    instance: { port, dbPath, storageEngine: "wiredTiger" },
  });
  console.log(`✓ Local MongoDB running at ${server.getUri()}`);
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

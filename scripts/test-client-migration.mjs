/** Executes the existing migration in a disposable replica set and verifies real legacy records. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const run = promisify(execFile);
const server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
const uri = server.getUri("migration_verification");
let count = 0;
const check = async (label, fn) => { await fn(); count++; console.log(`PASS ${label}`); };
const migrate = async (...args) => {
  const { stdout } = await run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--conditions=react-server", "scripts/migrate-clients.ts", "--json", ...args], { env: { ...process.env, MONGODB_URI: uri }, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
};
try {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const original = ["Acme Pvt Ltd", "ACME PVT LTD", "Acme Private Limited", "", "N/A"].map((client, i) => ({ _id: new mongoose.Types.ObjectId(), code: `LEGACY-${i}`, name: `Legacy ${i}`, client, status: "ACTIVE", updatedAt: new Date("2025-01-01T00:00:00Z") }));
  await db.collection("projects").insertMany(original);
  await check("dry run leaves legacy documents and client collections untouched", async () => {
    const result = await migrate();
    assert.equal(result.plan.create, 2);
    assert.equal(await db.collection("clients").countDocuments(), 0);
    assert.deepEqual(await db.collection("projects").find().toArray(), original);
  });
  await check("apply links exact names, keeps similar companies separate, and preserves legacy text and timestamps", async () => {
    const result = await migrate("--apply", "--confirm-backup");
    assert.equal(result.applied.clientsCreated, 2); assert.equal(result.applied.projectsLinked, 3);
    const rows = await db.collection("projects").find().toArray();
    assert.equal(String(rows[0].clientRef), String(rows[1].clientRef));
    assert.notEqual(String(rows[0].clientRef), String(rows[2].clientRef));
    rows.forEach((r, i) => { assert.equal(r.client, original[i].client); assert.equal(+r.updatedAt, +original[i].updatedAt); });
    assert.equal(await db.collection("duplicatereviews").countDocuments({ status: "OPEN" }), 1);
  });
  await check("reapplying the migration is idempotent", async () => {
    const result = await migrate("--apply", "--confirm-backup");
    assert.equal(result.applied.clientsCreated, 0); assert.equal(result.applied.projectsLinked, 0);
    assert.equal(await db.collection("clients").countDocuments(), 2);
  });
  await check("revert restores original project documents without deleting projects", async () => {
    await migrate("--revert", "--apply");
    assert.deepEqual(await db.collection("projects").find().toArray(), original);
    assert.equal(await db.collection("clients").countDocuments(), 0);
  });
  await check("revert preserves imported clients that were subsequently edited", async () => {
    await migrate("--apply", "--confirm-backup");
    const client = await db.collection("clients").findOne();
    await db.collection("clients").updateOne({ _id: client._id }, { $set: { updatedBy: new mongoose.Types.ObjectId(), notes: "Edited after import" } });
    const result = await migrate("--revert", "--apply");
    assert.equal(result.skipped.length, 1);
    assert.ok(await db.collection("clients").findOne({ _id: client._id }));
    assert.equal(await db.collection("projects").countDocuments(), original.length);
  });
  console.log(`${count} client migration checks passed.`);
} finally { await mongoose.disconnect(); await server.stop(); }

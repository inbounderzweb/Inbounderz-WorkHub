/**
 * Turns the free-text `Project.client` values into proper Client records and links the projects.
 *
 *   npm run migrate:clients                         dry run (default): prints the plan, writes nothing
 *   npm run migrate:clients -- --apply --confirm-backup
 *   npm run migrate:clients -- --revert             dry run of the revert
 *   npm run migrate:clients -- --revert --apply
 *   add --json for machine-readable output
 *
 * Safe by design:
 *  - Idempotent: projects that already have a client are skipped, existing clients are reused, review
 *    pairs are keyed. Running it twice changes nothing the second time.
 *  - Nothing is merged. Only names that are strictly equal (case/punctuation/spacing) share a record.
 *    Similar names (same name apart from "Pvt Ltd", or a high similarity) become separate clients plus
 *    an OPEN duplicate-review pair for an Admin.
 *  - Projects keep their original `client` text.
 *  - Reversible: every link is recorded in the client history, so --revert removes only what this
 *    script created, and skips any client someone has edited since.
 */
import "./_env";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { dbHealth } from "@/lib/db-health";
import { withTransaction } from "@/lib/transaction";
import { MIGRATION_SOURCE_PROJECT_CLIENT } from "@/lib/constants";
import { looseName, nameKey, normalizeEmail, normalizeName, normalizePhone, pairKey } from "@/lib/clients/normalize";
import { planClientMigration, type MigrationPlan } from "@/lib/clients/migration-plan";
import { AuditLog, Client, ClientContact, ClientHistory, DuplicateReview, nextSequence, Project } from "@/models";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const REVERT = args.has("--revert");
const JSON_OUT = args.has("--json");
const SOURCE = MIGRATION_SOURCE_PROJECT_CLIENT;
const log = (...a: unknown[]) => { if (!JSON_OUT) console.log(...a); };

type Report = Record<string, unknown>;

async function loadInputs() {
  const [projects, clients] = await Promise.all([
    Project.collection.find({}, { projection: { name: 1, code: 1, client: 1, clientRef: 1 } }).toArray(),
    Client.find().select("name migration.source").lean(),
  ]);
  return {
    projects,
    plan: planClientMigration(
      projects.map((p) => ({ id: String(p._id), client: p.client as string | undefined, clientRef: p.clientRef ? String(p.clientRef) : null })),
      clients.map((c) => ({ id: String(c._id), name: c.name, migrated: c.migration?.source === SOURCE }))
    ),
  };
}

function printPlan(plan: MigrationPlan, projectCodes: Map<string, string>) {
  log(`\nProjects already linked to a client : ${plan.alreadyLinked}`);
  log(`Projects with no client text         : ${plan.skippedEmpty}`);
  log(`Projects with a placeholder client   : ${plan.skippedPlaceholder.length}${plan.skippedPlaceholder.length ? "  (" + plan.skippedPlaceholder.map((p) => `${projectCodes.get(p.projectId)}="${p.value}"`).join(", ") + ")" : ""}`);
  log(`Clients to create                    : ${plan.create.length}`);
  for (const c of plan.create) log(`   + ${c.name}  ->  ${c.projectIds.map((i) => projectCodes.get(i)).join(", ")}${c.spellings.length > 1 ? `   (spellings: ${c.spellings.join(" | ")})` : ""}`);
  log(`Projects to link to existing clients : ${plan.linkExisting.reduce((n, l) => n + l.projectIds.length, 0)}`);
  log(`Duplicate-review pairs (OPEN)        : ${plan.review.length}`);
  for (const r of plan.review) log(`   ? "${r.a.name}"  ~  "${r.b.name}"   ${r.reasons.join("; ")}`);
}

async function applyPlan(plan: MigrationPlan): Promise<Report> {
  const now = new Date();
  const created = new Map<string, string>(); // key -> client id
  let linked = 0;

  for (const c of plan.create) {
    const code = `CLT-${String(await nextSequence("clientCode")).padStart(5, "0")}`;
    const id = await withTransaction(async (session) => {
      const [client] = await Client.create(
        [{
          clientCode: code,
          name: c.name,
          status: "ACTIVE",
          // No contact data exists in project records, so none is invented; there is no dedupeKey either.
          normName: normalizeName(c.name),
          looseName: looseName(c.name),
          nameKey: nameKey(c.name),
          normEmail: normalizeEmail(""),
          normPhone: normalizePhone(""),
          migration: { source: SOURCE, migratedAt: now },
          createdBy: null,
        }],
        { session }
      );
      const res = await Project.updateMany({ _id: { $in: c.projectIds.map((i) => new mongoose.Types.ObjectId(i)) }, clientRef: null }, { $set: { clientRef: client._id } }, { session, timestamps: false });
      linked += res.modifiedCount;
      await ClientHistory.create(
        [{ client: client._id, actor: null, action: "MIGRATED", summary: `Imported from ${c.projectIds.length} project record(s)`, changes: { name: { from: null, to: c.name }, linkedProjects: { from: null, to: c.projectIds } } }],
        { session }
      );
      return client._id.toString();
    });
    created.set(c.key, id);
  }

  for (const l of plan.linkExisting) {
    await withTransaction(async (session) => {
      const res = await Project.updateMany({ _id: { $in: l.projectIds.map((i) => new mongoose.Types.ObjectId(i)) }, clientRef: null }, { $set: { clientRef: new mongoose.Types.ObjectId(l.existingClientId) } }, { session, timestamps: false });
      linked += res.modifiedCount;
      if (res.modifiedCount) {
        await ClientHistory.create([{ client: new mongoose.Types.ObjectId(l.existingClientId), actor: null, action: "MIGRATED", summary: `Linked ${res.modifiedCount} existing project record(s) by exact name`, changes: { linkedProjects: { from: null, to: l.projectIds } } }], { session });
      }
    });
  }

  let reviews = 0;
  const idOf = (x: { key?: string; existingClientId?: string }) => (x.existingClientId ?? (x.key ? created.get(x.key) : undefined));
  for (const r of plan.review) {
    const a = idOf(r.a);
    const b = idOf(r.b);
    if (!a || !b) continue;
    const res = await DuplicateReview.updateOne(
      { pairKey: pairKey(a, b) },
      { $setOnInsert: { clientA: new mongoose.Types.ObjectId(a), clientB: new mongoose.Types.ObjectId(b), pairKey: pairKey(a, b), source: "MIGRATION", score: r.score, reasons: r.reasons, status: "OPEN" } },
      { upsert: true }
    );
    reviews += res.upsertedCount;
  }
  await AuditLog.create({ actor: null, action: "client.migrate", entityType: "Client", summary: `Client migration: ${created.size} created, ${linked} project(s) linked, ${reviews} review pair(s) queued`.slice(0, 480) });
  return { clientsCreated: created.size, projectsLinked: linked, reviewPairsQueued: reviews };
}

async function revert(): Promise<Report> {
  // Everything the migration did is recorded as MIGRATED history rows.
  const rows = await ClientHistory.find({ action: "MIGRATED" }).lean();
  const byClient = new Map<string, { rows: number; projects: Set<string> }>();
  for (const r of rows) {
    const e = byClient.get(String(r.client)) ?? { rows: 0, projects: new Set<string>() };
    e.rows++;
    for (const p of ((r.changes as { linkedProjects?: { to?: string[] } } | null)?.linkedProjects?.to ?? [])) e.projects.add(p);
    byClient.set(String(r.client), e);
  }
  const out = { clientsRemoved: [] as string[], projectsUnlinked: 0, reviewsRemoved: 0, skipped: [] as { client: string; reason: string }[] };
  for (const [clientId, info] of byClient) {
    const client = await Client.findById(clientId).lean();
    if (!client) continue;
    const oid = new mongoose.Types.ObjectId(clientId);
    const projectIds = [...info.projects].map((p) => new mongoose.Types.ObjectId(p));
    const isMigrated = client.migration?.source === SOURCE;
    if (isMigrated) {
      const problems: string[] = [];
      if (client.updatedBy) problems.push("edited since import");
      if ((await ClientHistory.countDocuments({ client: oid })) !== info.rows) problems.push("has later history");
      if (await ClientContact.exists({ client: oid })) problems.push("has contacts");
      if (await Project.exists({ clientRef: oid, _id: { $nin: projectIds } })) problems.push("has projects linked after the import");
      if (problems.length) { out.skipped.push({ client: `${client.clientCode} ${client.name}`, reason: problems.join(", ") }); continue; }
    }
    const count = await Project.countDocuments({ _id: { $in: projectIds }, clientRef: oid });
    out.projectsUnlinked += count;
    if (!APPLY) { if (isMigrated) out.clientsRemoved.push(`${client.clientCode} ${client.name}`); continue; }
    await withTransaction(async (session) => {
      // $unset, not null: restores the documents exactly as they were before the link.
      await Project.collection.updateMany({ _id: { $in: projectIds }, clientRef: oid }, { $unset: { clientRef: "" } }, { session });
      if (isMigrated) {
        const rv = await DuplicateReview.deleteMany({ $or: [{ clientA: oid }, { clientB: oid }] }, { session });
        out.reviewsRemoved += rv.deletedCount;
        // Raw collection on purpose: this removes the history of a client that no longer exists.
        await ClientHistory.collection.deleteMany({ client: oid }, { session });
        await Client.deleteOne({ _id: oid }, { session });
      }
    });
    if (isMigrated) out.clientsRemoved.push(`${client.clientCode} ${client.name}`);
  }
  if (APPLY) await AuditLog.create({ actor: null, action: "client.migrate_revert", entityType: "Client", summary: `Client migration reverted: ${out.clientsRemoved.length} removed, ${out.projectsUnlinked} project(s) unlinked`.slice(0, 480) });
  return out;
}

async function main() {
  await connectDB();
  const health = await dbHealth();
  log(`Database "${health.database}" (${health.topology}, MongoDB ${health.serverVersion}, transactions ${health.transactionsSupported ? "supported" : "NOT supported"})`);
  log(`Mode: ${REVERT ? "REVERT" : "MIGRATE"} ${APPLY ? "(APPLY)" : "(dry run, nothing will be written)"}`);

  if (APPLY && !REVERT && !args.has("--confirm-backup")) {
    throw new Error("Refusing to write without --confirm-backup. Take a backup first (mongodump) and pass --confirm-backup.");
  }
  if (APPLY && process.env.NODE_ENV === "production" && !health.transactionsSupported) {
    throw new Error("Production database does not support transactions; refusing to apply.");
  }

  let report: Report;
  if (REVERT) {
    report = await revert();
    log("\nRevert", APPLY ? "applied:" : "would do:", report);
  } else {
    const { projects, plan } = await loadInputs();
    const codes = new Map(projects.map((p) => [String(p._id), String(p.code ?? p._id)]));
    printPlan(plan, codes);
    report = { plan: { create: plan.create.length, linkExisting: plan.linkExisting.length, review: plan.review.length, alreadyLinked: plan.alreadyLinked, placeholders: plan.skippedPlaceholder.length, empty: plan.skippedEmpty } };
    if (APPLY) {
      report.applied = await applyPlan(plan);
      log("\nApplied:", report.applied);
    } else log("\nDry run only. Re-run with --apply --confirm-backup to write.");
  }
  if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

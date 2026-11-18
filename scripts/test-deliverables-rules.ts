/** Pure unit checks for ticket deliverable rules. No app, database or network needed. */
import assert from "node:assert/strict";
import {
  applyProgress,
  applyVerification,
  deliverableStatus,
  deliverableSummary,
  describeDeliverableChanges,
  mergeDeliverables,
  unfinishedDeliverables,
  verifyAll,
  type DeliverableRecord,
} from "../src/lib/deliverables";

let n = 0;
const t = (label: string, fn: () => void) => { fn(); n++; console.log(`PASS ${label}`); };
const row = (id: string, type: string, quantity: number, completedQuantity = 0, verifiedQuantity = 0): DeliverableRecord =>
  ({ id, type, quantity, specifications: "", completedQuantity, verifiedQuantity });
const sample = () => [row("v", "Video", 2, 1, 0), row("p", "Photo", 1, 1, 1), row("s", "Social Media Post", 3, 2, 0)];

t("status follows the quantities", () => {
  assert.equal(deliverableStatus(row("a", "X", 2)), "NOT_STARTED");
  assert.equal(deliverableStatus(row("a", "X", 2, 1)), "IN_PROGRESS");
  assert.equal(deliverableStatus(row("a", "X", 2, 2)), "AWAITING_VERIFICATION");
  assert.equal(deliverableStatus(row("a", "X", 2, 2, 1)), "AWAITING_VERIFICATION");
  assert.equal(deliverableStatus(row("a", "X", 2, 2, 2)), "COMPLETED");
});
t("not complete until the full quantity is verified", () => {
  assert.notEqual(deliverableStatus(row("a", "X", 3, 3, 2)), "COMPLETED");
});
t("summary counts items and bases percent on verified only", () => {
  assert.deepEqual(deliverableSummary(sample()), { count: 3, requested: 6, completed: 4, verified: 1, percent: 17 });
  assert.deepEqual(deliverableSummary([]), { count: 0, requested: 0, completed: 0, verified: 0, percent: 0 });
});
t("unfinished lists rows below the requested quantity", () => {
  assert.deepEqual(unfinishedDeliverables(sample()).map((d) => d.id), ["v", "s"]);
});
t("new rows start at zero progress", () => {
  const { next, errors } = mergeDeliverables([], [{ type: " Reel ", quantity: 2, specifications: " 9:16 " }]);
  assert.deepEqual(errors, {});
  assert.deepEqual(next, [{ type: "Reel", quantity: 2, specifications: "9:16", completedQuantity: 0, verifiedQuantity: 0 }]);
});
t("existing rows keep their id and progress", () => {
  const { next } = mergeDeliverables(sample(), [{ id: "v", type: "Video", quantity: 3 }]);
  assert.equal(next[0].id, "v");
  assert.equal(next[0].completedQuantity, 1);
});
t("quantity can't drop below completed work", () => {
  const { errors } = mergeDeliverables(sample(), [{ id: "s", type: "Social Media Post", quantity: 1 }]);
  assert.match(errors["deliverables.0.quantity"], /2 already completed/);
});
t("rows with completed work can't be removed", () => {
  const { errors } = mergeDeliverables(sample(), [{ id: "v", type: "Video", quantity: 2 }]);
  assert.match(errors.deliverables, /Photo, Social Media Post/);
});
t("rows without progress can be removed", () => {
  const { errors } = mergeDeliverables([row("a", "Logo", 1)], []);
  assert.deepEqual(errors, {});
});
t("unknown or duplicated ids are rejected (no forged rows, no double association)", () => {
  assert.ok(mergeDeliverables(sample(), [{ id: "zzz", type: "Video", quantity: 1 }]).errors["deliverables.0.type"]);
  const dup = mergeDeliverables([row("a", "Logo", 1)], [{ id: "a", type: "Logo", quantity: 1 }, { id: "a", type: "Logo", quantity: 1 }]);
  assert.ok(dup.errors["deliverables.1.type"]);
});
t("change description lists additions, quantity changes, renames and removals", () => {
  const before = [row("a", "Video", 2), row("b", "Logo", 1)];
  const { next } = mergeDeliverables(before, [{ id: "a", type: "Reel", quantity: 3 }, { type: "Banner", quantity: 1 }]);
  assert.deepEqual(describeDeliverableChanges(before, next), ["Renamed Video to Reel", "Reel: 2 → 3", "Added Banner × 1", "Removed Logo"]);
  assert.deepEqual(describeDeliverableChanges(before, before), []);
});
t("progress can't exceed the request or drop below verified", () => {
  assert.ok(applyProgress(sample(), [{ id: "v", completedQuantity: 3 }]).errors["items.0"]);
  assert.ok(applyProgress(sample(), [{ id: "p", completedQuantity: 0 }]).errors["items.0"]);
  assert.ok(applyProgress(sample(), [{ id: "v", completedQuantity: 1.5 }]).errors["items.0"]);
  const ok = applyProgress(sample(), [{ id: "v", completedQuantity: 2 }]);
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.next[0].completedQuantity, 2);
  assert.deepEqual(ok.changes, ["Video: 1 → 2 of 2"]);
});
t("failed progress update leaves everything unchanged", () => {
  const current = sample();
  const r = applyProgress(current, [{ id: "v", completedQuantity: 2 }, { id: "s", completedQuantity: 9 }]);
  assert.equal(r.next, current);
  assert.equal(current[0].completedQuantity, 1);
});
t("verification can't exceed what is completed", () => {
  assert.ok(applyVerification(sample(), [{ id: "s", verifiedQuantity: 3 }]).errors["items.0"]);
  assert.equal(applyVerification(sample(), [{ id: "s", verifiedQuantity: 2 }]).next[2].verifiedQuantity, 2);
});
t("approval verifies the full quantity of every deliverable", () => {
  const all = verifyAll([row("a", "Video", 2, 2, 1)]);
  assert.equal(all[0].verifiedQuantity, 2);
  assert.equal(deliverableStatus(all[0]), "COMPLETED");
});
console.log(`\n${n} checks passed`);

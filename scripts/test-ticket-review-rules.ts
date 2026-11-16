/** Pure unit checks for the reviewer routing rules. No app, database or network needed. */
import assert from "node:assert/strict";
import { canReviewDeliverable, isReviewOverdue, reviewRoutedTo, reviewerProblem, reviewAlreadyStarted, REVIEWER_CHANGE_STATUSES } from "../src/lib/ticket-review";
import { REVIEW_OVERDUE_HOURS } from "../src/lib/constants";

let n = 0;
const t = (label: string, fn: () => void) => { fn(); n++; console.log(`PASS ${label}`); };
const base = { status: "SUBMITTED_FOR_REVIEW", createdBy: "req", assignee: "worker", assignedReviewer: "rev" };

t("routes to the assigned reviewer, not the requester", () => assert.deepEqual(reviewRoutedTo(base), { id: "rev", legacy: false }));
t("legacy tickets without a reviewer route to the requester", () => assert.deepEqual(reviewRoutedTo({ ...base, assignedReviewer: null }), { id: "req", legacy: true }));
t("assigned reviewer can review", () => assert.equal(canReviewDeliverable({ userId: "rev", isAdmin: false, ticket: base }), true));
t("requester cannot review when a reviewer is assigned", () => assert.equal(canReviewDeliverable({ userId: "req", isAdmin: false, ticket: base }), false));
t("assignee cannot review own work", () => assert.equal(canReviewDeliverable({ userId: "worker", isAdmin: false, ticket: base }), false));
t("assignee cannot review even as legacy requester", () => assert.equal(canReviewDeliverable({ userId: "same", isAdmin: false, ticket: { ...base, createdBy: "same", assignee: "same", assignedReviewer: null } }), false));
t("previous reviewer loses access after reassignment", () => assert.equal(canReviewDeliverable({ userId: "rev", isAdmin: false, ticket: { ...base, assignedReviewer: "rev2" } }), false));
t("legacy requester can review", () => assert.equal(canReviewDeliverable({ userId: "req", isAdmin: false, ticket: { ...base, assignedReviewer: null } }), true));
t("populated user documents are treated like ids", () => {
  const pop = { ...base, createdBy: { _id: "req" }, assignee: { _id: "worker" }, assignedReviewer: null };
  assert.equal(canReviewDeliverable({ userId: "req", isAdmin: false, ticket: pop }), true);
  assert.equal(canReviewDeliverable({ userId: "worker", isAdmin: false, ticket: pop }), false);
});
t("admin override works", () => assert.equal(canReviewDeliverable({ userId: "admin", isAdmin: true, ticket: base }), true));
t("nobody reviews outside SUBMITTED_FOR_REVIEW (duplicate decision)", () => {
  for (const status of ["IN_PROGRESS", "COMPLETED", "ASSIGNED"]) {
    assert.equal(canReviewDeliverable({ userId: "rev", isAdmin: false, ticket: { ...base, status } }), false);
    assert.equal(canReviewDeliverable({ userId: "admin", isAdmin: true, ticket: { ...base, status } }), false);
  }
});
t("reviewer must differ from assignee", () => {
  assert.ok(reviewerProblem("a", "a"));
  assert.equal(reviewerProblem("a", "b"), null);
  assert.equal(reviewerProblem("a", null), null);
});
t("reviewer can change before and during review, not after completion", () => {
  assert.ok(REVIEWER_CHANGE_STATUSES.includes("SUBMITTED_FOR_REVIEW") && REVIEWER_CHANGE_STATUSES.includes("ASSIGNED"));
  assert.ok(!REVIEWER_CHANGE_STATUSES.includes("COMPLETED") && !REVIEWER_CHANGE_STATUSES.includes("CANCELLED"));
  assert.equal(reviewAlreadyStarted("SUBMITTED_FOR_REVIEW"), true);
  assert.equal(reviewAlreadyStarted("IN_PROGRESS"), false);
});
t("overdue only when pending beyond the threshold", () => {
  const now = Date.now();
  const ago = (h: number) => new Date(now - h * 3_600_000);
  assert.equal(isReviewOverdue({ reviewStatus: "PENDING", submittedAt: ago(REVIEW_OVERDUE_HOURS + 1) }, now), true);
  assert.equal(isReviewOverdue({ reviewStatus: "PENDING", submittedAt: ago(1) }, now), false);
  assert.equal(isReviewOverdue({ reviewStatus: "APPROVED", submittedAt: ago(500) }, now), false);
  assert.equal(isReviewOverdue({ reviewStatus: "PENDING", submittedAt: null }, now), false);
});
console.log(`\n${n} checks passed`);

# Sales onboarding continuation audit

Verification date: 18 November 2026 (Asia/Kolkata).

## Original implementation status

The existing working tree was inspected before implementation. Its tracked modifications and untracked client, requirement, conversion, assignment, migration, and test files were retained. The implementation was extended in place. Installed Next.js route-handler, client-component, ESLint, and deployment documentation was consulted.

| Feature | Status | Frontend | Backend/API | Database | Tests |
| --- | --- | --- | --- | --- | --- |
| Client onboarding | PARTIAL | Existing create/edit dialog lacked new contact fields and services | Create/read/update present | Client/history persisted | Typecheck failed; 29 client integration checks subsequently passed |
| Service requirements | PARTIAL | Existing editor was disconnected | CRUD and bulk sync present | Separate pre-sales records | Rule and integration checks passed; gaps in bulk locking |
| SMM configuration | PARTIAL | Fields existed but were inaccessible | Stage validation present | Config/budget supported | Rules/API covered; browser unverified |
| SEM configuration | PARTIAL | Fields existed but were inaccessible | Ad spend and agency fee separated | Separate amounts supported | Rules/API covered; browser unverified |
| SEO configuration | PARTIAL | Fields existed but were inaccessible | Scope validation present | Config supported | Rules/add/edit covered; browser unverified |
| Website configuration | PARTIAL | Fields existed but were inaccessible | Type/pages validation present | Config supported | Rules/bulk-save covered; browser unverified |
| Video configuration | PARTIAL | Fields existed but were inaccessible | Type/quantity/language validation present | Config supported | Rules covered; browser unverified |
| Quick Work configuration | PARTIAL | Fields existed but were inaccessible | Title/entry date/deadline validation present | Entry date persisted | Rules/API covered; browser unverified |
| Client detail tabs | PARTIAL | Overview, Contacts, Projects, History; no requirements tab | Read APIs present | Data available | Existing page checks passed |
| Add/edit requirements | PARTIAL | No reachable controls | CRUD/bulk present; bulk edits bypassed linked lock | Soft removal/history present | Existing checks missed linked bulk changes |
| Project creation | PARTIAL | No conversion form | Conversion API present | Transactional project/service/assignment creation | Existing creation checks passed |
| Service conversion | PARTIAL | No selection/confirmed-scope UI | Approved-only conversion/snapshots present | Active requirement unique index | Existing checks passed; currency/race gaps remained |
| Primary PM assignment | PARTIAL | No nomination controls | Draft/pending nomination present | Assignment history retained | Role/nomination API checks passed |
| Supporting PM assignment | PARTIAL | No team picker | Nomination present | Membership writes outside acceptance transaction | Existing happy path passed; rollback untested |
| PM acceptance/rejection | PARTIAL | No response controls | Explicit actions/state machine present | State changes transactional | 34 handover integration checks passed overall |
| Notifications | PARTIAL | Inbox present; destination had no response controls | Nomination/response notifications present | In-app records persisted | Notification API/database checks passed |
| Permissions | PARTIAL | Basic gating present | Row/field scope present; coordinator/aggregate-budget/creation gaps | Visibility queries present | Existing permission tests passed; missing cases found |
| Audit history | PARTIAL | Client history present; no assignment history UI | Client/assignment events present | Append-only client history | Existing audit checks passed; client outcome history incomplete |

Baseline results: TypeScript reported one error identifying five missing form defaults. The full baseline ESLint process failed with 730 errors and 19,532 warnings, largely from generated `.next-*` output; an early progress message incorrectly described the still-running lint process as passed. Existing rule suites passed 27 client, 14 requirement/handover, 14 reviewer, and 15 deliverable checks (70 total). The initial client and handover integration suites passed 29 and 34 checks.

## Continuation changes

- Connected the existing six-service editor to client creation and editing. Restored designation, contact email/phone, and alternate business phone fields.
- Added the Service Requirements tab, requirement save/reload, multiple entries per service, linked project links, and server-controlled read-only behavior.
- Made client field edits and requirement add/update/removal use the same transaction, including optimistic concurrency and rollback on invalid service data.
- Added project creation from explicitly selected approved requirements, confirmed scope, deliverables, budgets/fees/ad spend, currency, estimates, dates, notes, and draft/submission controls.
- Added primary/supporting PM and coordinator pickers using the existing restricted options API.
- Added project-side nomination, submission, explicit acceptance, rejection with reason, re-nomination, confirmed-service display, and assignment history.
- Moved manager/supporting/coordinator membership writes into the acceptance transaction. A failed membership write rolls back acceptance and ownership.
- Blocked linked requirement edits through bulk and client-edit APIs; allowed unchanged linked rows to remain when adding another service.
- Serialized conversion with requirement changes and reloaded approved source records inside the transaction before freezing snapshots.
- Rejected currency mismatches instead of relabeling amounts. Currency conversion is not performed.
- Enforced coordinator delivery roles on the server, disallowed overlapping team roles, blocked actions on archived projects, and masked aggregate client-project budgets for delivery staff without financial access.
- Prevented legacy project creation from manufacturing handover states; ordinary project forms offer allowed transitions.
- Added client history for submission, nomination, acceptance, and rejection alongside assignment events and existing shared audit entries.
- Fixed duplicate input IDs between the requirements tab and edit dialog; browser testing found the label association failure.
- Excluded generated `.next-*` directories from ESLint and replaced affected React Hook Form `watch()` subscriptions with `useWatch()`. Dialog sessions now mount afresh on opening, and requirement drafts are derived without cascading reset effects.
- Updated a stale ticket-routing assertion from “Assigned tickets” to the existing “Active tickets” label, retaining the selected-tab assertion and adding a completed-tab assertion. Ticket product behavior was unchanged.
- Replaced the deprecated Mongoose counter return option with `returnDocument: "after"`.

## APIs

No duplicate endpoints or models were introduced.

| Endpoint | Continuation |
| --- | --- |
| `POST /api/clients` | Existing API now used by onboarding UI with requirements and contact fields |
| `PATCH /api/clients/:id` | Optional requirements saved atomically with client fields; restricted to owner/Admin |
| `GET/POST/PUT /api/clients/:id/requirements` | Existing UI integration; PUT accepts optional client `expectedUpdatedAt`; locking/transactions strengthened |
| `PATCH/DELETE /api/clients/:id/requirements/:requirementId` | Existing APIs retained; linked-record and transaction protection strengthened |
| `POST /api/clients/:id/handover` | Existing API connected to UI; source revalidation and currency/coordinator guards added |
| `GET /api/handover/pm-options` | Existing restricted API reused by team pickers |
| `GET/POST /api/projects/:id/handover` | Existing API connected to UI; acceptance memberships atomic; archived guard and client history added |
| `GET /api/projects`, `GET /api/projects/:id` | Aggregate budget masking for client-linked projects added |
| `POST /api/projects` | Rejects handover-only creation states |

## Database and migration compatibility

The continuation adds no schema or destructive migration. It reuses the existing `Client`, `ClientContact`, `ClientServiceRequirement`, `Project`, `ProjectService`, `PMAssignment`, `ProjectMember`, `ClientHistory`, `Notification`, and `AuditLog` models. Pre-sales requirements remain distinct from confirmed services and their deliverables; conversion retains the source record and a snapshot.

Existing legacy projects still support a free-text client, optional `clientRef`, and no handover/services. The pre-existing client migration was exercised in disposable replica sets: dry run makes no writes, exact names link, similar companies stay separate with review rows, repeated apply is idempotent, revert preserves original project text/timestamps, and edited imported clients survive revert.

The running app at port 3000 and its database at port 27017 were not used for mutations. Integration/browser fixtures used a separate database named `workhub_onboarding_audit` on a test replica set at port 27018 and an app at port 3001. Transaction and migration suites create their own disposable replica sets. Fixture cleanup is scoped to test-created records.

## Final verification

The requested workflows are implemented and verified in the local replica-set environment. “COMPLETE” below refers to this tested scope; it does not assert production deployment verification.

Evidence suites: **C** = client API/persistence tests; **H** = handover API/persistence/permission/concurrency tests; **R** = requirement rules; **T** = new transaction/rollback tests; **B** = Chromium browser workflows; **M** = real migration tests.

| Feature | Status | Evidence of working behavior |
| --- | --- | --- |
| Client onboarding | COMPLETE | C creates/reads/edits clients with ownership/history; B creates a client with all six services and new contact data |
| Service requirements | COMPLETE | H checks raw MongoDB persistence and reload; B reloads the page and edits retained data |
| SMM configuration | COMPLETE | R validates quantities/platforms/billing/budget; B saves 12 posters, refreshes, edits to 18, and converts the approved record |
| SEM configuration | COMPLETE | H checks separate ad spend/agency fee in stored/read data; B enters SEM campaign configuration during onboarding |
| SEO configuration | COMPLETE | H adds SEO after creation and merges config updates; B persists/reloads 25 target keywords |
| Website configuration | COMPLETE | R enforces type/pages; H bulk-saves website data; B includes website configuration in six-service creation |
| Video configuration | COMPLETE | R validates type/quantity/language; B persists/reloads English-language video configuration |
| Quick Work configuration | COMPLETE | R checks title/date rules; H verifies automatic persisted entry date; B creates and later adds another Quick Work record |
| Client detail tabs | COMPLETE | B opens Contacts, Projects, History, Overview and Service Requirements and waits for their data/content |
| Add/edit requirements | COMPLETE | B edits requirements inside client edit and adds a post-creation service; T verifies rollback, linked locks and stale bulk rejection |
| Project creation | COMPLETE | B creates an ownerless draft with confirmed scope/deliverable; H verifies submitted projects and legacy project compatibility |
| Service conversion | COMPLETE | H verifies approved-only selection, source preservation, snapshots, deliverables and one live conversion; T rejects mismatched currencies |
| Primary PM assignment | COMPLETE | B nominates and submits, confirms no owner before acceptance, then verifies the accepted PM in MongoDB |
| Supporting PM assignment | COMPLETE | B selects a supporting PM and verifies team count; T verifies persisted LEAD membership and atomic rollback |
| PM acceptance/rejection | COMPLETE | B rejects with reason, re-nominates, explicitly accepts, and verifies PM_ACCEPTED/owner; H checks races/late responses; T preserves a 2,000-character rejection reason |
| Notifications | COMPLETE | H checks persisted primary/support/coordinator nomination notices and Sales/Admin acceptance/rejection notices; B verifies the nominated PM's notification record |
| Permissions | COMPLETE | C/H test Sales ownership, Admin, PM, leader, employee and unrelated-user boundaries; B denies unrelated project access/actions; T checks coordinator financial redaction and legacy-state bypass |
| Audit history | COMPLETE | C/H assert history/audit/event records; B renders client history; T verifies transactional history rollback and full rejection-reason preservation |

| Check | Passed | Failed |
| --- | ---: | ---: |
| Client rules | 27 | 0 |
| Requirement/handover rules | 14 | 0 |
| Ticket reviewer rules | 14 | 0 |
| Deliverable rules | 15 | 0 |
| Client API/persistence/permissions | 29 | 0 |
| Handover API/persistence/permissions/concurrency | 34 | 0 |
| Existing project workflow integration | 26 | 0 |
| Existing ticket routing integration | 19 | 0 |
| Existing ticket reviewer integration | 8 | 0 |
| Existing ticket deliverables integration | 12 | 0 |
| New transaction/rollback/persistence checks | 13 | 0 |
| New migration compatibility checks | 5 | 0 |
| New Chromium browser checks | 11 | 0 |
| **Total assertions grouped as named checks** | **227** | **0** |

TypeScript: exit 0. ESLint: exit 0, zero errors and zero warnings. Production Next.js build: exit 0. `git diff --check`: passed.

The ticket-routing suite first stopped after 10 passed checks at an obsolete screen-label assertion. After correcting the label to the actual existing UI, all 19 checks passed. Browser test development also exposed and fixed the duplicate-ID product issue; transient selector/auth-fixture problems were corrected in the harness. Final counts above are the successful final executions, without adding repeated runs to totals.

### Browser and visual verification

A real headless Chromium session exercised client creation with all service types, refresh, client edit, later service addition, conversion to draft, primary/supporting PM nomination, submission, persisted notification, rejection with reason, re-nomination, explicit acceptance, database ownership/status/membership checks, and unauthorized read/action denial. It also loaded all client detail tabs and checked for uncaught browser errors.

The accepted-project screenshot was visually inspected at `/tmp/workhub-onboarding-accepted.png`: accepted status, primary/supporting PM names, project owner, confirmed scope, budget and deliverable are visible. This is automated browser verification plus screenshot inspection, not a claim that a human completed UAT or that every browser/mobile layout was tested.

### Remaining limitations

- No missing item remains in the requested **local** acceptance workflow.
- Production verification remains **PARTIAL**: only local MongoDB targets were available/configured. No production topology, index inventory, migration execution, deployment, or production user workflow was tested. No production migration was applied.
- The test database health probe reports MongoDB 8.2.6, replica-set topology, transaction support, and a successful aborted transaction probe. This is evidence for the isolated test database only.
- The existing development fallback for standalone MongoDB remains non-atomic and warns; production requires transaction support. Rollback guarantees were tested on replica sets.
- Notifications are existing in-app notifications. The existing notification/shared-audit helpers log delivery failures without an outbox/retry guarantee; durable client/assignment history is recorded within the transaction. Email/SMS delivery was not added.
- Broader human UAT, mobile layouts, and other browsers remain unverified.

## Files changed during this continuation

New files:

- `src/components/clients/client-requirements.tsx`
- `src/components/clients/create-handover-dialog.tsx`
- `src/components/clients/handover-team-fields.tsx`
- `src/components/projects/project-handover.tsx`
- `scripts/test-onboarding-transactions.ts`
- `scripts/test-onboarding-ui.mjs`
- `scripts/test-client-migration.mjs`
- `docs/sales-onboarding-continuation.md`

Existing partial implementation files extended:

- `src/components/clients/client-form-dialog.tsx`
- `src/components/clients/client-detail.tsx`
- `src/components/clients/requirement-form.tsx`
- `src/components/projects/project-detail.tsx`
- `src/components/projects/project-form-dialog.tsx`
- `src/services/client-core.ts`
- `src/services/client.service.ts`
- `src/services/requirement.service.ts`
- `src/services/project-core.ts`
- `src/services/project.service.ts`
- `src/services/handover.service.ts`
- `src/lib/handover.ts`
- `src/lib/validations/client.ts`
- `src/lib/validations/handover.ts`
- `src/app/api/clients/[id]/requirements/route.ts`
- `src/models/Counter.ts`
- `scripts/test-ticket-routing.mjs`
- `eslint.config.mjs`
- `package.json`
- `README.md`
- `tsconfig.json` (Next-generated type directories for isolated verification builds)

Other original modified/untracked implementation files remain in the working tree. Nothing was committed, reset, discarded, or reverted.

## Reproducing new checks

`npm run test:onboarding-transactions` and `npm run test:client-migration` provision disposable MongoDB replica sets. MongoDB binaries must be installed or downloadable by `mongodb-memory-server`.

`npm run test:onboarding-ui` requires a running local app/database and Playwright. Set `TEST_APP_URL` and `MONGODB_URI` to the same local test instance. Optional `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_EXECUTABLE_PATH` let the script use an existing installation; no browser dependency was added to the application. This session used an installed Playwright cache and headless Chromium.

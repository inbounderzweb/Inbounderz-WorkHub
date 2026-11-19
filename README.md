# Inbounderz WorkHub

Internal company platform for managing employees, departments, projects, tasks and work progress with role-based access.

**Status: Day 1 complete.**

- **Part 1:** authentication, roles and permissions, employee and department management, role-specific dashboards.
- **Part 2:** project management with department allocation, task management (My Tasks list / board / calendar), subtasks, dependencies, checklists, comments, attachments, and the review workflow.

**Next (Day 2):** internal department tickets, then Daily Updates.

## Tech stack

Next.js 16 (App Router, Route Handlers) · TypeScript · MongoDB + Mongoose 9 · Auth.js v5 (credentials, JWT) · Tailwind CSS v4 · shadcn/ui (Radix) · Lucide · React Hook Form + Zod 4 · SWR · Recharts · date-fns · sonner

## Getting started

```bash
npm install
cp .env.example .env.local      # then fill in the values (see below)
npm run seed                    # creates the 5 roles + the initial Super Admin
npm run dev                     # http://localhost:3000
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB Atlas connection string. Include the database name, e.g. `…mongodb.net/inbounderz_workhub` |
| `AUTH_SECRET` | Session encryption secret. Generate it with `openssl rand -base64 33` |
| `AUTH_URL` | Public base URL of the app (used in password-reset links) |
| `STORAGE_DIR` | *(optional)* Where uploaded files are stored. Default: `./storage/uploads` |
| `SUPER_ADMIN_NAME` / `_EMAIL` / `_PASSWORD` / `_EMPLOYEE_ID` | Used **only** by `npm run seed` to create the first Super Admin |

### Upgrading an existing database

After pulling new code, run `npm run seed` again. It is idempotent: it syncs roles and indexes and applies data migrations (for example, the old *Blocked* task status becomes *On Hold* with a blocker flag, and every task gets a task number).

### Using MongoDB Atlas

1. Create a cluster, then a database user with read/write access.
2. Under **Network Access**, allow your server's IP address (or `0.0.0.0/0` for development only).
3. Copy the `mongodb+srv://…` string into `MONGODB_URI` and add `/inbounderz_workhub` before the `?`.
4. Run `npm run seed`. It also builds every collection index.

### Local MongoDB (no Atlas account needed)

```bash
npm run db:dev     # runs a real mongod on 127.0.0.1:27017, data kept in ./.data/mongo
# MONGODB_URI="mongodb://127.0.0.1:27017/inbounderz_workhub"
```

### Demo data (optional)

```bash
npm run seed:demo
```

This inserts real records into MongoDB: 4 departments, 16 employees covering every role, 3 projects with team members, 20 tasks and milestones. Nothing in the app is hard-coded. The script refuses to run when `NODE_ENV=production`.

All demo accounts use the password `Demo@12345`:

| Role | Email |
| --- | --- |
| Project Manager | `pm@inbounderz.com` |
| Department Head (Development) | `head.dev@inbounderz.com` |
| Team Leader (Development) | `lead.dev@inbounderz.com` |
| Employee | `employee@inbounderz.com` |

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` / `typecheck` | ESLint / TypeScript |
| `npm run test:project-workflow` | Local integration checks for work requests, assignment, approval and project access (requires the dev app and MongoDB; temporary records are removed) |
| `npm run test:ticket-routing` | Local integration checks for selecting ticket reviewers, notifications, queues and approval (temporary records are removed) |
| `npm run seed` | Syncs roles and indexes, creates the Super Admin. Safe to re-run. Add `-- --reset-admin-password` to rotate the bootstrap admin's password |
| `npm run seed:demo` | Optional demo data |
| `npm run db:dev` | Local MongoDB for development |

## Architecture

```
src/
  auth.ts, auth.config.ts   Auth.js: credentials provider (bcrypt, lockout) + proxy-safe config
  proxy.ts                  Optimistic route protection (redirect to /login, or 401 for /api)
  app/
    (auth)/                 login, forgot-password, reset-password
    (dashboard)/            protected app: dashboard, employees, departments, profile, notifications, settings
    api/                    Route Handlers (all business operations go through these)
  services/                 Business logic and role scoping (employee, department, dashboard, search, …)
  models/                   Mongoose models (13 domain collections + Counter)
  lib/
    permissions.ts          Permission matrix (single source of truth)
    auth/current-user.ts    Loads the signed-in user from MongoDB on every request
    api.ts                  withAuth wrapper, body/query parsing, uniform error JSON
    validations/            Zod schemas shared by forms and Route Handlers
  components/               layout, shared UI, feature components
  types/dto.ts              API response shapes
```

**Request flow:**

1. The browser calls a Route Handler.
2. `withAuth` connects to the database, loads the user *from MongoDB*, and checks the coarse permission.
3. The service applies scope rules (e.g. "only departments I head").
4. Mongoose runs the query.
5. A typed DTO is returned.

Every mutation writes an `AuditLog` entry, and relevant users receive in-app `Notification`s.

### Data model

`User`, `Role`, `Department`, `Project`, `ProjectMember`, `Task`, `Milestone`, `TaskComment`, `TaskActivity`, `DailyUpdate`, `Attachment`, `Notification`, `AuditLog`

- Each employee has exactly one **primary department** (`User.department`). A department lists its members by query rather than storing an embedded array.
- Project teams live in the separate **`ProjectMember`** collection (unique per `project + user`), never embedded in `Project`.
- A task has **one accountable `owner`** plus `collaborators[]`, and subtasks point to their parent via `parentTask`.
- Indexes cover unique email/employee ID, case-insensitive unique department names, and the common dashboard filters.

## Projects and tasks

### Allocating a project team

1. A Project Manager (or Super Admin) creates the project. The Project ID (`PRJ-0001`) is generated automatically.
2. They choose the participating departments.
3. Each selected department's active employees load, and the manager ticks the specific people to include. Nobody is added automatically.
4. Each allocation is stored as a `ProjectMember` record. The server checks that every employee really belongs to the department they're allocated under.

Removing someone from a project ends their allocation (`isActive: false`, `leftAt`) without deleting anything. Their tasks, comments and history stay, but they lose access to the project and can't be assigned new work.

### Assigning a task

1. Pick a project.
2. Only that project's departments are offered, limited to the ones you may assign in.
3. Only employees allocated to the project under the chosen department can be the owner.
4. Collaborators can be anyone on the active project team.

The server re-checks every selection, including reassignments. Task numbers (`TSK-00001`) are generated automatically. Department Heads and Team Leaders allocated to a project can request and assign work within the department they represent. They can choose themselves or an active department employee; assigning someone also allocates them to the project.

### Requesting Project Manager approval before work starts

1. A Department Head or Team Leader opens **Create task**, selects the project and department, and describes the work.
2. Keep **Request Project Manager approval before work starts** enabled. Choose a proposed assignee, use **Assign to me**, or leave the assignee empty for the manager to decide.
3. **Send to Project Manager** places the request on every project manager's dashboard under **Work requests awaiting approval**, in the project's task list, and in **All Tasks → Awaiting PM approval**. The project managers receive a notification.
4. A project manager opens the request and approves the proposed assignee, or uses **Assign → Approve and assign** to choose someone else. They can also request changes to the description; the requester edits it and requests approval again.
5. Pending requests and requests needing changes cannot start work, track time, log hours, or complete checklist items. After approval, the normal task workflow applies.

The **Assign** dialog also offers **Request Project Manager approval** for a new proposed assignment. This approval is separate from **Requires approval to complete**, which controls review of finished work. Existing tasks keep their current workflow unless approval is requested.

### Who can assign tasks

| | Assign tasks |
| --- | --- |
| Project Manager | Any department of projects they manage |
| Department Head / Team Leader | Their own department only |
| Employee | Can't create or assign tasks |

### What employees can do

Employees see only the tasks they own or collaborate on. On those tasks they can:

- move them through the permitted statuses
- tick checklist items
- comment and upload files
- report blockers
- log actual hours
- submit work for review

### Status workflow

The allowed status changes are defined in `src/lib/task-workflow.ts`. The server enforces them and the UI only shows the actions that are valid.

- **Owner:** Backlog → To Do → In Progress ⇄ On Hold → **In Review** (submit). They can withdraw a submission back to In Progress. From Changes Requested they go back to In Progress and resubmit.
- **Manager** (project manager, department head or team leader of the task's department): can also move tasks to Backlog/To Do, cancel them, restore cancelled tasks, and reopen completed ones.
- **Completing a task:** when approval is required (the default), nobody can simply mark it Completed. A reviewer has to **Approve** it, and that records who approved it and when. **Request changes** needs a comment, notifies the owner and sets the status to Changes Requested.
- **Approval setting:** chosen per task, defaulting to the project's setting. Either *Department Head or Team Leader* of the task's department (Project Managers may also review), or *Project Manager* only. Nobody can approve their own task.
- **Dependencies:** a task can't start, be submitted or be completed until all its dependencies are completed or cancelled. Circular dependencies are rejected.
- **Subtasks:** subtasks are one level deep. A parent task can't be completed or approved while any of its subtasks are still open. Submitting a subtask never completes its parent.
- **Activity history:** every assignment, status change, review decision, blocker, checklist edit, comment and attachment is recorded in `TaskActivity`. Project-level changes go to `AuditLog`.

### Progress calculation

Every task counts as one unit, subtasks included.

- **Completion %** = completed ÷ (total − cancelled). Cancelled tasks are never in the denominator.
- **In progress** = In Progress + In Review + Changes Requested.
- **Pending** = Backlog + To Do + On Hold.
- **Overdue** = any task that isn't completed or cancelled and whose due date has passed.

This is implemented once, in `services/progress.service.ts`, and used everywhere.

### Archiving

An archived project and its tasks become read-only, and the project is hidden from default lists (filter "Archived only" to see it). It can be unarchived at any time.

### Attachments

- **Who can upload:** project documents are uploaded by the project's managers. Task files can be uploaded by the task's owner, collaborators and managers.
- **Limits:** up to 10 MB per file. Allowed types are images, PDF, Office documents, text, CSV and ZIP.
- **Downloads:** go through `/api/attachments/:id`, which checks the viewer's access to the task or project first.
- **Storage:** files are stored on local disk by default (`src/lib/storage.ts`). For serverless or multi-server hosting, implement the same small interface on S3/R2.

## Choosing a Project Manager for a ticket

**My Tasks** includes **Project tasks** and **Assigned tickets** tabs. If you have tickets assigned to you and no project tasks, the ticket tab opens automatically. Tickets on hold remain visible there; open the ticket to resume work or use its other permitted actions.

In **Raise a ticket** or **Edit ticket**, use **Project Manager (optional)** to choose an active Project Manager to review the request. They receive the notification and see the ticket in their **Approval queue**, even if they are not configured as a manager of the target department. Leave the field empty to use the department's default reviewers.

The dropdown lists active Project Managers by name. The requester can change the selection while the ticket is a draft, awaiting approval, or waiting for clarification. Changing the manager on a submitted ticket clears the previous review and sends it for approval again. Selecting a manager routes the review request; an employee is assigned only when the manager approves and assigns the work.

## Roles and permissions

The matrix is defined in `src/lib/permissions.ts`, synced to the `roles` collection, and **enforced on the server** on every request. The sidebar only reflects it. Super Admins can view the matrix under **Settings → Roles & permissions**.

| | Super Admin | Project Manager | Department Head | Team Leader | Employee |
| --- | --- | --- | --- | --- | --- |
| Employees | Full | Read directory; create **Department Heads, Team Leaders and Employees in any active department** | Create/edit/activate **Employees and Team Leaders in departments they head** | Read own team | Own profile |
| Departments | Full | Read all | Read; manage team leaders of departments they head | Read own | Read own |
| Dashboard | Company | Managed projects | Department | Team | Personal |
| Settings / audit log | ✓ | — | — | — | — |

**Clients** (Sales Executive is a sixth role, created by Super Admins; it owns clients and can read their linked projects):

| | Super Admin | Sales Executive | Project Manager | Dept Head / Team Leader | Employee |
| --- | --- | --- | --- | --- | --- |
| Which clients | All | Own | Of projects they manage / sit on | Of projects visible to them | Of projects they work on |
| Detail | Full | Full | Full (incl. GST, billing, history) | Name, category, website, contact person | Name, category, website |
| Edit | All, incl. owner, archive, duplicate override | All of own, incl. GST/billing; not owner or archive | Contacts, addresses, notes; **not** GST, billing, currency, owner, status | — | — |

Safeguards:

- Nobody can change their own role or status.
- The last active Super Admin can't be demoted or deactivated.
- Circular reporting lines are rejected.
- A department head must have the Department Head role. A team leader must have the Team Leader role and belong to that department.
- A department with employees, active projects or open tasks can't be deleted. Archive it instead.

## Security notes

- Passwords are hashed with bcrypt (cost 12).
- An account locks for 15 minutes after 5 failed sign-ins.
- Unknown emails take the same time to reject, so accounts can't be enumerated.
- There is no public sign-up. The first Super Admin comes only from `npm run seed`.
- **Deactivating a user, resetting a password or changing a password revokes existing sessions immediately.** The session token carries a version number, and the server checks the user's status and version in MongoDB on every request.
- Password-reset tokens are random 256-bit values. Only their SHA-256 hash is stored, they are single-use, and they expire after 30 minutes. The response is the same whether or not the email exists.
- State-changing API calls require `application/json`, which blocks cross-site form posts. Auth cookies are `SameSite=Lax`.
- Callback URLs are reduced to same-origin paths, so they can't be used for open redirects.

## Known limitations

- **Password-reset email delivery is not wired up yet.** The reset link is written to the server log. Plug a mail provider into `src/app/api/account/forgot-password/route.ts`. In the meantime, a Super Admin can reset any employee's password from that employee's profile.
- Internal tickets (Day 2) and Daily Updates have no screens yet. The dashboards' ticket panels say so instead of showing numbers.
- Attachments use local-disk storage. Switch the storage driver before deploying to serverless hosting.

## Database requirements and verification

Multi-document writes (client + history + duplicate review, project hand-over and so on) run in MongoDB
**transactions**, which need a **replica set** (Atlas clusters always are one). A standalone `mongod` has no
transactions: in development the app warns once and runs without atomicity; in production
`withTransaction()` ([src/lib/transaction.ts](src/lib/transaction.ts)) throws instead of silently running
non-atomically.

Verify any deployment without exposing credentials:

```bash
MONGODB_URI="<target>" npm run db:health                          # prints topology, version and a transaction probe
MONGODB_URI="<target>" npm run db:health -- --require-transactions   # exit code 1 if unsupported (deploy gate)
```

The probe's output never contains hosts, users or the connection string. A signed-in Admin can also call
`GET /api/health/db`. Record the production result here when verified:

| Environment | Verified | Topology | Transactions | Date |
|---|---|---|---|---|
| Production | not yet verified | | | |

Local development with transactions: `npm run db:dev` starts a single-node replica set (`rs0`) on port 27017,
using `MONGODB_URI=mongodb://127.0.0.1:27017/hr_portal?replicaSet=rs0&directConnection=true`. **Back up first**
(`mongodump --uri=... --out ~/mongo-backups/<name>`); an existing standalone data directory is converted in place.

## Client migration

`npm run migrate:clients` turns the free-text `Project.client` values into Client records. It is a dry run unless
`--apply --confirm-backup` is passed, is idempotent, never merges clients (similar names go to the Admin's
duplicate-review queue) and is reversible with `--revert --apply`. See the header of
[scripts/migrate-clients.ts](scripts/migrate-clients.ts).

## Sales onboarding verification

The [continuation audit](docs/sales-onboarding-continuation.md) records the original implementation,
changes, test evidence, API behavior, and deployment limitations. Requirements are pre-sales records;
only selected approved requirements become confirmed project services. Nomination does not assign
ownership: the primary Project Manager must explicitly accept the handover.

Additional verification commands:

```bash
npm run test:onboarding-transactions  # disposable MongoDB replica set; includes rollback injection
npm run test:client-migration         # disposable replica set; dry-run/apply/idempotency/revert
npm run test:onboarding-ui            # local running app + matching test DB + Playwright required
```

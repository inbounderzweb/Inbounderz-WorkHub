# Inbounderz WorkHub

Internal company platform for managing employees, departments, projects, tasks and work progress with role-based access.

**Status: Day 2 complete (all planned modules).**

- **Day 1 · Part 1:** authentication, roles and permissions, employee and department management, role-specific dashboards.
- **Day 1 · Part 2:** project management with department allocation, task management (My Tasks list / board / calendar), subtasks, dependencies, checklists, comments, attachments, and the review workflow.
- **Day 2 · Part 1:** internal department tickets (My Tickets, Ticket Management, assignment, ticket ⇄ task integration, resolution review, activity history).
- **Day 2 · Part 2:** notification system (triggers, preferences, deadline reminders), Daily Work Updates with review, work calendar, reports & analytics with CSV export, audit log, system settings.

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
| `AUTH_TRUST_HOST` | Set to `true` behind a proxy / on hosting platforms |
| `CRON_SECRET` | *(optional)* Enables `GET /api/cron/reminders` for an external scheduler (`Authorization: Bearer <secret>`). Without it, reminders still run automatically while people use the app |
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

## Deployment

1. **Database:** create a MongoDB Atlas cluster, a database user, and network access for your host. Use a `MONGODB_URI` that includes the database name.
2. **Environment:** set `MONGODB_URI`, `AUTH_SECRET`, `AUTH_URL` (the public https URL), `AUTH_TRUST_HOST=true` and optionally `CRON_SECRET`. Set the `SUPER_ADMIN_*` values for the first seed only.
3. **Build and seed:**
   ```bash
   npm ci
   npm run build
   npm run seed        # roles, indexes (incl. the one-task-per-ticket and one-report-per-day indexes), migrations, Super Admin
   npm run start       # or your platform's start command
   ```
   Re-run `npm run seed` after every upgrade. It's idempotent.
4. **File storage:** attachments are written to local disk (`STORAGE_DIR`). That works on a single VM or container with a persistent volume. For serverless or multiple instances (e.g. Vercel), implement the `StorageDriver` interface in `src/lib/storage.ts` for S3, R2 or GCS first.
5. **Reminders (optional):** schedule `GET /api/cron/reminders` with `Authorization: Bearer $CRON_SECRET` every 15 minutes, e.g. Vercel Cron or any uptime pinger that can send headers.
6. **First sign-in:** sign in as the seeded Super Admin, change the password, fill in **Settings → Company**, then create departments and users.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` / `typecheck` | ESLint / TypeScript |
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

`User`, `Role`, `Department`, `Project`, `ProjectMember`, `Task`, `Milestone`, `TaskComment`, `TaskActivity`, `DailyUpdate`, `Attachment`, `Notification`, `AuditLog`, `Ticket`, `TicketCategory`, `TicketComment`, `TicketActivity`, `SystemSetting`

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

The server re-checks every one of these selections, including reassignments. Task numbers (`TSK-00001`) are generated automatically.

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

## Internal tickets

Employees request help from another department (e.g. Web Development asks Design for a banner). A Project Manager reviews the request and assigns someone, and that person gets the work in **My Tasks**.

### Workflow

1. An employee raises a ticket from **My Tickets**. The ticket number (`TKT-0001`) is generated, and the requester and requesting department are taken from the signed-in user's profile. Anything sent by the client for those fields is ignored.
2. The ticket starts as **New**. The managing Project Manager(s) and the target department's head are notified.
3. The Project Manager opens it in **Ticket Management**, reviews it, picks the department (only its active employees are offered, each with their open-task count), picks the employee, and confirms. The ticket becomes **Assigned**.
4. The assignee is notified and a linked work item appears in their My Tasks, labelled **Internal Request · TKT-0001**.
5. The assignee starts work, uploads deliverables and submits the ticket as **Resolved**.
6. The requester reviews the deliverables, then either **confirms completion** (ticket **Closed**, task **Completed**, closure details stored) or **requests changes** (ticket **Changes Requested**, task back to an actionable status, assignee notified).

Either side can ask for more information (**Waiting for Information**). Work resumes where it left off once the requester answers. Project Managers can reject a ticket, reassign it (the full assignment history is kept), close a resolved ticket on the requester's behalf, and reopen a ticket. A requester can reopen their own closed ticket within 14 days.

The allowed transitions are defined in `src/lib/ticket-workflow.ts`. The server enforces them and the UI only shows valid actions.

### Ticket ⇄ task integration (no duplicate records)

- The **ticket is the single source of truth**. On first assignment one `Task` is created with `sourceType: "internal_ticket"` and `linkedTicket`, and the ticket stores `linkedTask`. A unique partial index on `Task.linkedTicket` makes a second task for the same ticket impossible. Reassignment, and assigning a ticket again after it was rejected and reopened, update that same task.
- `syncLinkedTask()` in `services/ticket.service.ts` is the only code that writes a linked task's status, owner, department, deadline and priority. It derives them from the ticket: Assigned → To Do, In Progress → In Progress, Waiting → On Hold, Resolved → In Review, Changes Requested → Changes Requested, Closed → Completed, Rejected → Cancelled. It runs after every ticket change and also when a ticket is opened, so a request that was interrupted repairs itself.
- Task endpoints don't bypass the ticket. *Start work* from My Tasks calls the ticket workflow. Editing, reassigning, reviewing or moving the status of a linked task any other way is refused with a pointer to the ticket. `/tasks/:id` for a linked task redirects to its ticket.
- Linked tasks have no project, so they never affect project progress. Normal project tasks work exactly as before.

### Who can do what

| | Ticket access |
| --- | --- |
| Employee (any role) | Raise tickets. See only the tickets they raised, plus tickets assigned to them. Reply to info requests, confirm or request changes |
| Assignee | Start work, ask for information, upload deliverables, submit as resolved. Former assignees keep read-only access |
| Project Manager | Manage tickets with no related project, and tickets related to projects they manage: review, assign, reassign, reject, edit priority/date/category, intervene |
| Department Head | Monitor (read and comment on) tickets sent to or raised by departments they head |
| Super Admin | Everything. Also configures ticket categories under **Settings → Ticket categories** |

Categories are deactivated, never deleted, and each ticket stores the category name at creation, so history doesn't change. The six default categories are created automatically the first time categories are needed.

## Notifications

All notifications are stored in MongoDB (`notifications`). The bell shows the unread count and the latest items and refreshes every minute. The **Notifications** page lists the full history, with type filters, mark-as-read, mark-all-read and delete. Clicking a notification opens the related project, task, ticket or daily report.

- **Triggers:**
  - **Project:** project created (manager), employee added, employee removed, deadline approaching.
  - **Task:** assigned, reassigned, status changed (to the owner, or to whoever assigned it), review requested, changes requested, approved, due soon, overdue.
  - **Ticket:** submitted, assigned, reassigned, started, more information requested, resolved, changes requested, closed (plus rejected, reopened and comments).
  - **Daily reports:** submitted, resubmitted, approved, changes requested.
- **Who receives them:** only people who already have access to the record are notified. Actors never notify themselves.
- **Preferences:** each user can switch categories off under Notifications → Preferences. New work assigned to them, review decisions on their work and requests that need their answer are always delivered.
- **Deadline reminders:** reminders are created by a sweep with a unique `dedupeKey`, so each one is delivered exactly once. The sweep runs automatically at most every 10 minutes, triggered by the bell's normal polling, so no scheduler is required. For reminders when nobody is signed in, call `GET /api/cron/reminders` with `Authorization: Bearer $CRON_SECRET`, for example from Vercel Cron every 15 minutes. Lead times are set under Settings → Notifications.
- **Real-time delivery:** there's no push (e.g. Socket.IO) yet; the app polls the database instead.

## Daily work updates

- **One report per item per day:** an employee files one report per **day + project + (optional) task**: work completed, pending work, blockers, hours and attachments. A unique index (`one_report_per_work_item_per_day`) refuses duplicates. The form then offers to open the existing report so it can be edited instead.
- **Validation:** reports can't be future-dated, can't go back further than the configured number of days (default 7), and can't push the day's total over the daily hour limit (default 16). Employees can only report on projects they're allocated to, and on tasks they own or collaborate on.
- **Review:** the author's **Department Head** approves or requests changes. A comment is required when requesting changes. A Department Head's own reports go to the Super Admin. Team Leaders can be given review rights in Settings.
  - **Editing after changes are requested** resubmits the report as a new revision and notifies the reviewer.
  - **Approved reports are locked,** including their attachments.
  - **Deleting** is only possible before the first review.
- **Overview:** Project Managers see reports on their projects read-only. Team Leaders see their team's reports.
- **Summaries:** daily and weekly (Mon–Sun) hours per employee, review status, blockers, and team members who haven't reported.

## Calendar

Shows project deadlines, task due dates, ticket due dates and milestones, in month or week view (week by default on phones). Filters cover event type, "only mine", "overdue only" and jump to month. Clicking an event shows its details and a link, and an **Overdue** panel lists late tasks and tickets. Events use exactly the same visibility rules as the project, task and ticket lists.

## Reports & analytics

All figures are aggregated live from MongoDB. Nothing is hard-coded. What you see depends on your report permissions:

| Section | Who | Contents |
| --- | --- | --- |
| Company | Super Admin (`report:company`) | project statistics, average progress, task totals (completed / pending / overdue), project completion, task status distribution, department workload, employee task distribution, monthly trend, internal ticket statistics (incl. average time to assign / close), department performance table, filter by department |
| My projects | Project Manager (`report:project`) | managed-project progress, department task performance, project & milestone deadlines, ticket assignment performance per assignee, completion rate, trend |
| My department | Department Head (`report:department`) | department task statistics, employee workload, completed / overdue, internal requests received, daily-report activity |
| My work | everyone | personal task statistics, status distribution, trend, daily work history (hours per day, 30 days) |

Every chart has a **Table** view with the exact numbers. **Export CSV** covers tasks, projects, tickets, daily updates, department performance and employee workload. Exports are UTF-8 with a BOM so they open correctly in Excel, are protected against formula injection, include only rows you can access, and are recorded in the audit log.

## Audit log

The **Audit Log** page (`audit:read`, Super Admin by default) lists who did what and when. Entries can be filtered by entity and date, and expanded to show field-level changes. It covers:

- user creation, update, role change, activation and deactivation;
- department leadership;
- project creation, updates and team changes;
- task creation, assignment and status changes, approvals and change requests;
- ticket creation, assignment and every workflow step, rejection, closure and reopening;
- daily-report review decisions;
- ticket categories;
- settings and permission changes;
- report exports.

## System settings (Super Admin)

| Tab | What it does | Safeguards |
| --- | --- | --- |
| Company | name, legal name, contacts, address, timezone ("today" for reports and reminders) | timezone is validated |
| Users & roles | user counts per role, link to user management, **permission settings** | only a whitelist of non-structural permissions (reports, audit, daily-update review/submit, ticket create/monitor, directory read) can be granted or revoked; structural permissions and Super Admin are locked |
| Workflow | task status labels, optional statuses, priority labels and default ticket response times, default priority, daily-update rules | core statuses can't be disabled; an optional status (Backlog) can only be switched off when no task is in it; labels must be unique |
| Ticket categories | add, rename, deactivate | categories are never deleted; tickets keep the name they were created with |
| Notifications | reminder lead times | each user's own preferences are on the Notifications page |
| Audit log | same as the Audit Log page | read-only |

Settings are cached for 15 seconds per server instance and applied to every permission check, so changes take effect without a restart.

## Roles and permissions

The matrix is defined in `src/lib/permissions.ts`, synced to the `roles` collection, and **enforced on the server** on every request. The sidebar only reflects it. Super Admins can view the matrix under **Settings → Roles & permissions**.

| | Super Admin | Project Manager | Department Head | Team Leader | Employee |
| --- | --- | --- | --- | --- | --- |
| Employees | Full | Read directory | Create/edit/activate **Employees and Team Leaders in departments they head** | Read own team | Own profile |
| Departments | Full | Read all | Read; manage team leaders of departments they head | Read own | Read own |
| Dashboard | Company | Managed projects | Department | Team | Personal |
| Settings / audit log | ✓ | — | — | — | — |

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
- There is no email delivery. All notifications are in-app only. Real-time push (Socket.IO) isn't implemented; the bell polls every 60 s.
- CSV is the only export format. PDF and Excel export aren't implemented.
- Task status *labels* can be renamed, but the workflow states themselves are fixed in code (`src/lib/task-workflow.ts`), so existing records can't be invalidated.
- The calendar has month and week views, but no day/agenda view and no drag-to-reschedule.
- Attachments use local-disk storage. Switch the storage driver before deploying to serverless hosting.

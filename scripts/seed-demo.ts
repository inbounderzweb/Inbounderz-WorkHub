/**
 * OPTIONAL demo data for testing roles and dashboards. Inserts real records into
 * MongoDB (nothing in the app is hard-coded). Idempotent: skips if already seeded.
 * Refuses to run when NODE_ENV=production unless --force is passed.
 *
 *   npm run seed:demo
 *
 * Every demo account uses the password: Demo@12345
 */
import "./_env";
import bcrypt from "bcryptjs";
import mongoose, { type Types } from "mongoose";
import { addDays, subDays } from "date-fns";
import { connectDB } from "@/lib/db";
import { getRoleByKey, syncRoles } from "@/lib/roles";
import type { RoleKey, TaskPriority, TaskStatus } from "@/lib/constants";
import { AuditLog, Department, Milestone, Notification, Project, ProjectMember, Task, TaskActivity, User } from "@/models";

const PASSWORD = "Demo@12345";

type SeedUser = {
  key: string;
  name: string;
  email: string;
  employeeId: string;
  role: RoleKey;
  dept?: string;
  manager?: string;
  designation: string;
};

const DEPARTMENTS = [
  { code: "DEV", name: "Development", color: "#16a34a", description: "Web & app engineering" },
  { code: "SEO", name: "SEO & Performance", color: "#0891b2", description: "Search, analytics and growth" },
  { code: "DSN", name: "Design", color: "#9333ea", description: "Brand, UI and creative" },
  { code: "CNT", name: "Content", color: "#ea580c", description: "Copywriting and content strategy" },
];

const USERS: SeedUser[] = [
  { key: "pm1", name: "Aisha Rahman", email: "pm@inbounderz.com", employeeId: "IBZ-1001", role: "PROJECT_MANAGER", designation: "Senior Project Manager" },
  { key: "pm2", name: "Rohan Mehta", email: "pm2@inbounderz.com", employeeId: "IBZ-1002", role: "PROJECT_MANAGER", designation: "Project Manager" },
  { key: "dhDev", name: "Fahad Khan", email: "head.dev@inbounderz.com", employeeId: "IBZ-2001", role: "DEPARTMENT_HEAD", dept: "DEV", designation: "Head of Engineering" },
  { key: "dhSeo", name: "Neha Iyer", email: "head.seo@inbounderz.com", employeeId: "IBZ-2002", role: "DEPARTMENT_HEAD", dept: "SEO", designation: "Head of SEO" },
  { key: "dhDsn", name: "Omar Siddiqui", email: "head.design@inbounderz.com", employeeId: "IBZ-2003", role: "DEPARTMENT_HEAD", dept: "DSN", designation: "Creative Director" },
  { key: "tlDev", name: "Priya Nair", email: "lead.dev@inbounderz.com", employeeId: "IBZ-3001", role: "TEAM_LEADER", dept: "DEV", manager: "dhDev", designation: "Frontend Team Lead" },
  { key: "tlSeo", name: "Arjun Das", email: "lead.seo@inbounderz.com", employeeId: "IBZ-3002", role: "TEAM_LEADER", dept: "SEO", manager: "dhSeo", designation: "SEO Team Lead" },
  { key: "tlDsn", name: "Sara Thomas", email: "lead.design@inbounderz.com", employeeId: "IBZ-3003", role: "TEAM_LEADER", dept: "DSN", manager: "dhDsn", designation: "UI Team Lead" },
  { key: "e1", name: "Vikram Joshi", email: "employee@inbounderz.com", employeeId: "IBZ-4001", role: "EMPLOYEE", dept: "DEV", manager: "tlDev", designation: "Frontend Developer" },
  { key: "e2", name: "Meera Pillai", email: "meera@inbounderz.com", employeeId: "IBZ-4002", role: "EMPLOYEE", dept: "DEV", manager: "tlDev", designation: "Backend Developer" },
  { key: "e3", name: "Kabir Ali", email: "kabir@inbounderz.com", employeeId: "IBZ-4003", role: "EMPLOYEE", dept: "DEV", manager: "tlDev", designation: "QA Engineer" },
  { key: "e4", name: "Divya Menon", email: "divya@inbounderz.com", employeeId: "IBZ-4004", role: "EMPLOYEE", dept: "SEO", manager: "tlSeo", designation: "SEO Analyst" },
  { key: "e5", name: "Imran Sheikh", email: "imran@inbounderz.com", employeeId: "IBZ-4005", role: "EMPLOYEE", dept: "SEO", manager: "tlSeo", designation: "Performance Marketer" },
  { key: "e6", name: "Ananya Rao", email: "ananya@inbounderz.com", employeeId: "IBZ-4006", role: "EMPLOYEE", dept: "DSN", manager: "tlDsn", designation: "UI Designer" },
  { key: "e7", name: "Zoya Mirza", email: "zoya@inbounderz.com", employeeId: "IBZ-4007", role: "EMPLOYEE", dept: "CNT", designation: "Content Writer" },
  { key: "e8", name: "Nikhil Bose", email: "nikhil@inbounderz.com", employeeId: "IBZ-4008", role: "EMPLOYEE", dept: "CNT", designation: "Copy Editor" },
];

async function main() {
  if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
    throw new Error("Refusing to seed demo data in production. Pass --force if you really mean it.");
  }
  await connectDB();
  await syncRoles();

  if (await Department.exists({ code: "DEV" })) {
    console.log("• Demo data already present — nothing to do.");
    return;
  }
  const admin = await User.findOne({ email: process.env.SUPER_ADMIN_EMAIL?.toLowerCase() }).select("_id");
  if (!admin) throw new Error("Run `npm run seed` first to create the Super Admin.");

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const now = new Date();

  // Departments
  const depts = new Map<string, Types.ObjectId>();
  for (const d of DEPARTMENTS) {
    const doc = await Department.create({ ...d, createdBy: admin._id });
    depts.set(d.code, doc._id);
  }

  // Users (managers first so references resolve)
  const users = new Map<string, Types.ObjectId>();
  const uid = (key: string): Types.ObjectId => {
    const id = users.get(key);
    if (!id) throw new Error(`Unknown demo user ${key}`);
    return id;
  };
  const did = (code: string): Types.ObjectId => depts.get(code)!;
  for (const u of USERS) {
    const role = await getRoleByKey(u.role);
    const doc = await User.create({
      name: u.name,
      email: u.email,
      employeeId: u.employeeId,
      designation: u.designation,
      phone: `+91 98${u.employeeId.replace(/\D/g, "").padStart(8, "0")}`,
      passwordHash,
      role: role.id,
      department: u.dept ? did(u.dept) : null,
      reportingManager: u.manager ? uid(u.manager) : null,
      joiningDate: subDays(now, 90 + Math.floor(Math.random() * 600)),
      status: "ACTIVE",
      createdBy: admin._id,
    });
    users.set(u.key, doc._id);
  }

  // Leadership
  await Department.updateOne({ _id: did("DEV") }, { head: uid("dhDev"), teamLeaders: [uid("tlDev")] });
  await Department.updateOne({ _id: did("SEO") }, { head: uid("dhSeo"), teamLeaders: [uid("tlSeo")] });
  await Department.updateOne({ _id: did("DSN") }, { head: uid("dhDsn"), teamLeaders: [uid("tlDsn")] });

  // Projects + members (separate collection)
  const projects = [
    { code: "WEB-ACME", name: "Acme Corp Website Revamp", client: "Acme Corp", manager: "pm1", status: "ACTIVE", depts: ["DEV", "DSN", "CNT"], team: ["tlDev", "e1", "e2", "e3", "tlDsn", "e6", "e7"], start: -45, end: 30 },
    { code: "SEO-NOVA", name: "Nova Retail SEO Growth", client: "Nova Retail", manager: "pm1", status: "ACTIVE", depts: ["SEO", "CNT"], team: ["tlSeo", "e4", "e5", "e8"], start: -20, end: 70 },
    { code: "APP-ZEN", name: "ZenFit Mobile App", client: "ZenFit", manager: "pm2", status: "PLANNING", depts: ["DEV", "DSN"], team: ["e2", "e6"], start: 5, end: 120 },
  ] as const;

  const projectIds = new Map<string, Types.ObjectId>();
  for (const p of projects) {
    const doc = await Project.create({
      code: p.code,
      name: p.name,
      client: p.client,
      description: `${p.name} for ${p.client}.`,
      status: p.status,
      priority: "HIGH",
      manager: uid(p.manager),
      departments: p.depts.map((d) => did(d)),
      startDate: addDays(now, p.start),
      endDate: addDays(now, p.end),
      createdBy: admin._id,
    });
    projectIds.set(p.code, doc._id);
    await ProjectMember.create({ project: doc._id, user: uid(p.manager), projectRole: "MANAGER", addedBy: admin._id });
    for (const key of p.team) {
      const u = USERS.find((x) => x.key === key)!;
      await ProjectMember.create({
        project: doc._id,
        user: uid(key),
        department: u.dept ? did(u.dept) : null,
        projectRole: u.role === "TEAM_LEADER" ? "LEAD" : "MEMBER",
        addedBy: uid(p.manager),
      });
    }
    await Milestone.create([
      { project: doc._id, title: "Discovery & planning", dueDate: addDays(now, p.start + 10), status: p.start + 10 < 0 ? "COMPLETED" : "PENDING", order: 1 },
      { project: doc._id, title: "Launch", dueDate: addDays(now, p.end), status: "PENDING", order: 2 },
    ]);
  }

  // Tasks with a realistic spread of statuses and due dates
  type T = [string, string, string, TaskStatus, TaskPriority, number | null, string?];
  const tasks: T[] = [
    ["WEB-ACME", "Set up Next.js project & CI", "e2", "COMPLETED", "HIGH", -30],
    ["WEB-ACME", "Build homepage hero section", "e1", "IN_PROGRESS", "HIGH", 0],
    ["WEB-ACME", "Implement navigation & footer", "e1", "IN_REVIEW", "MEDIUM", 2],
    ["WEB-ACME", "Contact form with CRM integration", "e2", "TODO", "MEDIUM", 6],
    ["WEB-ACME", "Cross-browser QA pass", "e3", "TODO", "MEDIUM", 12],
    ["WEB-ACME", "Fix Lighthouse accessibility issues", "e3", "IN_PROGRESS", "URGENT", -2],
    ["WEB-ACME", "Design system tokens", "e6", "COMPLETED", "HIGH", -20],
    ["WEB-ACME", "Service page mockups", "e6", "IN_REVIEW", "HIGH", 1],
    ["WEB-ACME", "Homepage copy", "e7", "COMPLETED", "MEDIUM", -10],
    ["WEB-ACME", "Case study copy (3 pages)", "e7", "IN_PROGRESS", "MEDIUM", -1],
    ["WEB-ACME", "Code review: component library", "tlDev", "IN_REVIEW", "MEDIUM", 0],
    ["SEO-NOVA", "Technical SEO audit", "e4", "COMPLETED", "HIGH", -12],
    ["SEO-NOVA", "Keyword research — category pages", "e4", "IN_PROGRESS", "HIGH", 0],
    ["SEO-NOVA", "Fix crawl errors in Search Console", "e5", "BLOCKED", "URGENT", -3],
    ["SEO-NOVA", "Monthly performance report", "tlSeo", "TODO", "MEDIUM", 5],
    ["SEO-NOVA", "Blog content calendar", "e8", "IN_REVIEW", "LOW", 3],
    ["SEO-NOVA", "Backlink outreach batch 1", "e5", "TODO", "MEDIUM", 9],
    ["APP-ZEN", "Wireframes: onboarding", "e6", "TODO", "MEDIUM", 15],
    ["APP-ZEN", "API architecture proposal", "e2", "TODO", "HIGH", 10],
  ];

  for (const [code, title, ownerKey, status, priority, due] of tasks) {
    const ownerDef = USERS.find((u) => u.key === ownerKey)!;
    const created = await Task.create({
      title,
      project: projectIds.get(code),
      department: ownerDef.dept ? did(ownerDef.dept) : null,
      owner: uid(ownerKey),
      collaborators: ownerDef.manager ? [uid(ownerDef.manager)] : [],
      reviewer: ownerDef.manager ? uid(ownerDef.manager) : null,
      status,
      priority,
      startDate: subDays(now, 14),
      dueDate: due === null ? null : due === 0 ? new Date(new Date().setHours(18, 0, 0, 0)) : addDays(now, due),
      completedAt: status === "COMPLETED" ? subDays(now, Math.max(1, -(due ?? -1))) : null,
      estimatedHours: 8,
      createdBy: uid(projects.find((p) => p.code === code)!.manager),
    });
    await TaskActivity.create({
      task: created._id,
      project: created.project,
      actor: created.createdBy,
      action: "CREATED",
      message: `Created task "${title}"`,
    });
  }

  // A subtask to exercise the parent/child relation
  const parent = await Task.findOne({ title: "Build homepage hero section" });
  if (parent) {
    await Task.create({
      title: "Hero animation polish",
      parentTask: parent._id,
      project: parent.project,
      department: parent.department,
      owner: parent.owner,
      status: "TODO",
      priority: "LOW",
      dueDate: addDays(now, 4),
      createdBy: uid("tlDev"),
    });
  }

  // Welcome notifications
  await Notification.insertMany(
    [...users.values()].map((id) => ({
      recipient: id,
      actor: admin._id,
      type: "ACCOUNT",
      title: "Welcome to Inbounderz WorkHub",
      message: "Your account is ready. Review your profile and assigned tasks.",
      link: "/profile",
    }))
  );

  await AuditLog.create({
    actor: admin._id,
    action: "system.demo_seed",
    entityType: "System",
    summary: `Seeded demo data: ${DEPARTMENTS.length} departments, ${USERS.length} employees, ${projects.length} projects, ${tasks.length + 1} tasks`,
  });

  console.log("✓ Demo data created. All demo accounts use password:", PASSWORD);
  console.table(USERS.map((u) => ({ role: u.role, email: u.email })));
}

main()
  .catch((err) => {
    console.error("✗ Demo seed failed:", err.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

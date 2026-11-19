import "server-only";
import type { ClientSession, Types } from "mongoose";
import { ApiError } from "@/lib/api";
import { nextSequence, Project, ProjectMember, User } from "@/models";
import { oid } from "./scope";

/** Helpers shared by the project and handover services. A leaf module: it imports neither of them. */

export async function generateProjectCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = `PRJ-${String(await nextSequence("projectCode")).padStart(4, "0")}`;
    if (!(await Project.exists({ code }))) return code;
  }
  throw new ApiError(500, "Could not generate a project ID");
}

/** Keeps exactly one active MANAGER membership in sync with Project.manager. */
export async function syncManagerMembership(projectId: Types.ObjectId, managerId: Types.ObjectId, actorId: string, session?: ClientSession) {
  await ProjectMember.updateMany(
    { project: projectId, projectRole: "MANAGER", user: { $ne: managerId }, isActive: true },
    { $set: { isActive: false, leftAt: new Date() } },
    { session }
  );
  const mgr = await User.findById(managerId).select("department").session(session ?? null).lean();
  await ProjectMember.updateOne(
    { project: projectId, user: managerId },
    {
      $set: { projectRole: "MANAGER", isActive: true, leftAt: null, department: mgr?.department ?? null },
      $setOnInsert: { joinedAt: new Date(), addedBy: oid(actorId) },
    },
    { upsert: true, session }
  );
}

import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { departmentMembersSchema } from "@/lib/validations/department";
import { manageDepartmentMembers } from "@/services/department.service";

export const POST = withAuth<RouteContext<"/api/departments/[id]/members">>(
  async (req, ctx, user) => {
    const { id } = await ctx.params;
    assertObjectId(id);
    return manageDepartmentMembers(user, id, await parseBody(req, departmentMembersSchema));
  },
  { permission: "department:manage-members" }
);

import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { updateDepartmentSchema } from "@/lib/validations/department";
import { deleteDepartment, getDepartment, updateDepartment } from "@/services/department.service";

type Ctx = RouteContext<"/api/departments/[id]">;

export const GET = withAuth<Ctx>(
  async (_req, ctx, user) => {
    const { id } = await ctx.params;
    assertObjectId(id);
    return getDepartment(user, id);
  },
  { permission: "department:read" }
);

// Field-level permissions (edit vs. assign head vs. assign leaders) are enforced in the service.
export const PATCH = withAuth<Ctx>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return updateDepartment(user, id, await parseBody(req, updateDepartmentSchema));
});

export const DELETE = withAuth<Ctx>(
  async (_req, ctx, user) => {
    const { id } = await ctx.params;
    assertObjectId(id);
    await deleteDepartment(user, id);
    return { ok: true };
  },
  { permission: "department:delete" }
);

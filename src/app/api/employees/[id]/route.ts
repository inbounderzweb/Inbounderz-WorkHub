import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { updateEmployeeSchema } from "@/lib/validations/employee";
import { getEmployee, updateEmployee } from "@/services/employee.service";

type Ctx = RouteContext<"/api/employees/[id]">;

// Read access (incl. "self") is resolved inside the service.
export const GET = withAuth<Ctx>(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return getEmployee(user, id);
});

export const PATCH = withAuth<Ctx>(
  async (req, ctx, user) => {
    const { id } = await ctx.params;
    assertObjectId(id);
    return updateEmployee(user, id, await parseBody(req, updateEmployeeSchema));
  },
  { permission: "employee:update" }
);

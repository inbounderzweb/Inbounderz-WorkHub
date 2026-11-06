import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { employeeStatusSchema } from "@/lib/validations/employee";
import { setEmployeeStatus } from "@/services/employee.service";

export const PATCH = withAuth<RouteContext<"/api/employees/[id]/status">>(
  async (req, ctx, user) => {
    const { id } = await ctx.params;
    assertObjectId(id);
    const { status } = await parseBody(req, employeeStatusSchema);
    return setEmployeeStatus(user, id, status);
  },
  { permission: "employee:status" }
);

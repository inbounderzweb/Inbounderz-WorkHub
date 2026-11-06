import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { adminResetPasswordSchema } from "@/lib/validations/employee";
import { adminResetPassword } from "@/services/employee.service";

export const POST = withAuth<RouteContext<"/api/employees/[id]/password">>(
  async (req, ctx, user) => {
    const { id } = await ctx.params;
    assertObjectId(id);
    const { password } = await parseBody(req, adminResetPasswordSchema);
    await adminResetPassword(user, id, password);
    return { ok: true };
  },
  { permission: "employee:reset-password" }
);

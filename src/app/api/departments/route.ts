import { parseBody, parseQuery, withAuth } from "@/lib/api";
import { createDepartmentSchema, departmentListQuerySchema } from "@/lib/validations/department";
import { createDepartment, listDepartments } from "@/services/department.service";

export const GET = withAuth(
  async (req, _ctx, user) => listDepartments(user, parseQuery(req, departmentListQuerySchema)),
  { permission: "department:read" }
);

export const POST = withAuth(
  async (req, _ctx, user) => {
    const input = await parseBody(req, createDepartmentSchema);
    return Response.json(await createDepartment(user, input), { status: 201 });
  },
  { permission: "department:create" }
);

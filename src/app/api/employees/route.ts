import { parseBody, parseQuery, withAuth } from "@/lib/api";
import { createEmployeeSchema, employeeListQuerySchema } from "@/lib/validations/employee";
import { createEmployee, listEmployees } from "@/services/employee.service";

export const GET = withAuth(
  async (req, _ctx, user) => listEmployees(user, parseQuery(req, employeeListQuerySchema)),
  { permission: "employee:read" }
);

export const POST = withAuth(
  async (req, _ctx, user) => {
    const input = await parseBody(req, createEmployeeSchema);
    return Response.json(await createEmployee(user, input), { status: 201 });
  },
  { permission: "employee:create" }
);

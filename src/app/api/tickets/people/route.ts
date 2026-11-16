import { assertObjectId, badRequest, withAuth } from "@/lib/api";
import { departmentPeople } from "@/services/ticket.service";

export const GET = withAuth(async (req) => {
  const department = req.nextUrl.searchParams.get("department") ?? "";
  if (!department) throw badRequest("department is required");
  assertObjectId(department, "department");
  return departmentPeople(department);
}, { permission: "ticket:create" });

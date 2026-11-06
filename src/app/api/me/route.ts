import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getEmployee } from "@/services/employee.service";
import { updateOwnProfile } from "@/services/account.service";

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => v === "" || /^[+()\-\s\d]{6,30}$/.test(v), "Enter a valid phone number")
    .optional(),
});

export const GET = withAuth(async (_req, _ctx, user) => getEmployee(user, user.id));

export const PATCH = withAuth(async (req, _ctx, user) => {
  await updateOwnProfile(user, await parseBody(req, profileSchema));
  return getEmployee(user, user.id);
});

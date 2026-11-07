import "server-only";
import { DEFAULT_TICKET_CATEGORIES } from "@/lib/constants";
import { Department, TicketCategory } from "@/models";

/* Kept free of request/auth imports so `npm run seed` can use it. */

let ensured = false;

/**
 * Creates the initial categories the first time any are needed (idempotent, so
 * existing databases get them without re-running the seed). Matches suggested
 * target departments by department code when those departments exist.
 */
export async function ensureDefaultTicketCategories(): Promise<void> {
  if (ensured) return;
  if (await TicketCategory.estimatedDocumentCount()) {
    ensured = true;
    return;
  }
  const codes = DEFAULT_TICKET_CATEGORIES.map((c) => c.departmentCode).filter(Boolean) as string[];
  const depts = await Department.find({ code: { $in: codes } }).select("code").lean();
  const byCode = new Map(depts.map((d) => [d.code, d._id]));
  await TicketCategory.bulkWrite(
    DEFAULT_TICKET_CATEGORIES.map((c, i) => ({
      updateOne: {
        filter: { name: c.name },
        update: {
          $setOnInsert: {
            name: c.name,
            description: c.description,
            defaultDepartment: (c.departmentCode && byCode.get(c.departmentCode)) || null,
            isActive: true,
            order: i,
          },
        },
        upsert: true,
        collation: { locale: "en", strength: 2 },
      },
    }))
  );
  ensured = true;
}

import { z } from "zod";
import { forbidden, parseQuery, withAuth } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { EXPORT_DATASETS, exportDataset } from "@/services/report.service";

const schema = z.object({ dataset: z.enum(EXPORT_DATASETS) });

/** CSV export of the data the user is allowed to see. */
export const GET = withAuth(async (req, _ctx, user) => {
  const { dataset } = parseQuery(req, schema);
  const out = await exportDataset(user, dataset);
  if (!out) throw forbidden("You don't have access to this report");
  await recordAudit({ actorId: user.id, action: "report.export", entityType: "Report", summary: `Exported ${dataset} (CSV)` });
  return new Response(out.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${out.filename}"`,
      "Cache-Control": "no-store",
    },
  });
});

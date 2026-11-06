import { z } from "zod";
import { parseQuery, withAuth } from "@/lib/api";
import { globalSearch } from "@/services/search.service";

const schema = z.object({ q: z.string().trim().max(100).optional().default("") });

export const GET = withAuth(async (req, _ctx, user) => globalSearch(user, parseQuery(req, schema).q));

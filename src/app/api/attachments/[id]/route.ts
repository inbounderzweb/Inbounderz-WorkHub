import { assertObjectId, withAuth } from "@/lib/api";
import { deleteAttachment, readAttachment } from "@/services/attachment.service";

type Ctx = RouteContext<"/api/attachments/[id]">;

/** Authorized download. Access is checked against the owning task/project. */
export const GET = withAuth<Ctx>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  const file = await readAttachment(user, id);
  const inline = req.nextUrl.searchParams.get("inline") === "1" && /^image\/|^application\/pdf$/.test(file.mimeType);
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
});

export const DELETE = withAuth<Ctx>(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  await deleteAttachment(user, id);
  return { ok: true };
});

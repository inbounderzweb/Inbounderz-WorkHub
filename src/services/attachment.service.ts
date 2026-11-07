import "server-only";
import { Types } from "mongoose";
import type { CurrentUser } from "@/lib/auth/current-user";
import { ApiError, badRequest, forbidden, notFound, unprocessable } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES, sanitizeFileName, storage } from "@/lib/storage";
import { Attachment, Project, Task, TaskActivity, Ticket, TicketActivity } from "@/models";
import type { AttachmentDTO } from "@/types/dto";
import {
  accessContext,
  canManageProject,
  canManageTask,
  canViewProject,
  canViewTask,
  isCollaborator,
  isOwner,
  type AccessContext,
} from "./access";
import { iso, toUserRef, USER_REF_FIELDS } from "./mappers";
import { oid } from "./scope";
import { dailyUpdateAttachmentAccess } from "./daily-update-access";
import {
  canManageTicket,
  canMonitorTicket,
  canViewTicket,
  fromAccessContext,
  isTicketAssignee,
  isTicketRequester,
} from "./ticket-access";

/* eslint-disable @typescript-eslint/no-explicit-any */

type EntityType = "Task" | "Project" | "Ticket" | "DailyUpdate";
export type AttachmentKind = "FILE" | "DELIVERABLE";

export function toAttachmentDTO(a: any, userId: string, canManage: boolean): AttachmentDTO {
  return {
    id: a._id.toString(),
    fileName: a.fileName,
    mimeType: a.mimeType,
    size: a.size,
    url: `/api/attachments/${a._id}`,
    uploadedBy: toUserRef(a.uploadedBy),
    createdAt: iso(a.createdAt)!,
    canDelete: canManage || a.uploadedBy?._id?.toString() === userId || a.uploadedBy?.toString?.() === userId,
  };
}

export async function listAttachments(
  user: CurrentUser,
  entityType: EntityType,
  entityId: Types.ObjectId,
  canManage: boolean
): Promise<AttachmentDTO[]> {
  const rows = await Attachment.find({ entityType, entityId }).sort({ createdAt: -1 }).populate("uploadedBy", USER_REF_FIELDS).lean();
  return rows.map((a) => toAttachmentDTO(a, user.id, canManage));
}

/** Resolves the entity and the viewer's rights over its attachments. */
type EntityAccess = {
  view: boolean;
  upload: boolean;
  manage: boolean;
  task: any | null;
  ticket?: any;
  uploadDeliverable?: boolean;
  /** Ticket deliverables already submitted in a resolution (immutable). */
  submitted?: Set<string>;
  report?: any;
};

async function entityAccess(ctx: AccessContext, entityType: string, entityId: Types.ObjectId): Promise<EntityAccess | null> {
  if (entityType === "Task") {
    const task = await Task.findById(entityId).select("owner collaborators project department createdBy").lean();
    if (!task || !canViewTask(ctx, task)) return null;
    const project = task.project ? await Project.findById(task.project).select("isArchived").lean() : null;
    const manage = canManageTask(ctx, task);
    return {
      view: true,
      upload: !project?.isArchived && (manage || isOwner(ctx, task) || isCollaborator(ctx, task)),
      manage,
      task,
    };
  }
  if (entityType === "Project") {
    const project = await Project.findById(entityId).select("departments isArchived").lean();
    if (!project || !canViewProject(ctx, project)) return null;
    const manage = canManageProject(ctx, project._id);
    return { view: true, upload: manage && !project.isArchived, manage, task: null };
  }
  if (entityType === "DailyUpdate") {
    const a = await dailyUpdateAttachmentAccess(ctx, entityId);
    if (!a) return null;
    // The author manages files until the report is approved; approved reports are a record.
    return { view: true, upload: a.upload, manage: a.editable, task: null, report: a.report };
  }
  if (entityType === "Ticket") {
    const ticket = await Ticket.findById(entityId)
      .select("ticketNumber status requester assignee project targetDepartment requestingDepartment assignments resolutions")
      .lean();
    const tctx = fromAccessContext(ctx);
    if (!ticket || !canViewTicket(tctx, ticket)) return null;
    const open = !["CLOSED", "REJECTED"].includes(ticket.status);
    const manage = canManageTicket(tctx, ticket);
    const participant = isTicketRequester(tctx, ticket) || isTicketAssignee(tctx, ticket) || canMonitorTicket(tctx, ticket);
    return {
      view: true,
      upload: open && participant,
      // Deliverables: only the current assignee, once work has started.
      uploadDeliverable: isTicketAssignee(tctx, ticket) && ["IN_PROGRESS", "CHANGES_REQUESTED"].includes(ticket.status),
      manage,
      task: null,
      ticket,
      submitted: new Set((ticket.resolutions ?? []).flatMap((r: any) => (r.deliverables ?? []).map(String))),
    };
  }
  return null;
}

export async function uploadAttachment(
  user: CurrentUser,
  entityType: EntityType,
  entityId: string,
  file: File,
  kind: AttachmentKind = "FILE"
): Promise<AttachmentDTO> {
  const ctx = await accessContext(user);
  const access = await entityAccess(ctx, entityType, oid(entityId));
  if (!access) throw notFound(`${entityType} not found`);
  if (kind === "DELIVERABLE") {
    if (entityType !== "Ticket") throw forbidden("Deliverables can only be attached to tickets");
    if (!access.uploadDeliverable) throw forbidden("Only the assignee can upload deliverables, after starting work on the ticket");
  } else if (!access.upload) {
    throw forbidden("You can't upload files here");
  }

  if (file.size === 0) throw badRequest("The file is empty");
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "Files must be 10 MB or smaller");
  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw unprocessable("This file type isn't allowed. Use images, PDF, Office documents, text, CSV or ZIP.");
  }

  const fileName = sanitizeFileName(file.name);
  const storageKey = await storage.put(Buffer.from(await file.arrayBuffer()), fileName);
  const _id = new Types.ObjectId();
  const doc = await Attachment.create({
    _id,
    fileName,
    url: `/api/attachments/${_id}`,
    storageKey,
    mimeType,
    size: file.size,
    entityType,
    entityId: oid(entityId),
    uploadedBy: oid(user.id),
    kind,
  });

  if (access.ticket) {
    await TicketActivity.create({
      ticket: access.ticket._id,
      actor: oid(user.id),
      action: kind === "DELIVERABLE" ? "DELIVERABLE_UPLOADED" : "ATTACHMENT_ADDED",
      to: fileName,
      message: kind === "DELIVERABLE" ? `Uploaded deliverable ${fileName}` : `Attached ${fileName}`,
      meta: { attachment: _id },
    });
  } else if (access.report) {
    // Report attachments are listed on the report itself; no separate history needed.
  } else if (access.task) {
    await TaskActivity.create({
      task: access.task._id,
      project: access.task.project ?? null,
      actor: oid(user.id),
      action: "ATTACHMENT_ADDED",
      to: fileName,
      message: `Attached ${fileName}`,
    });
  } else {
    await recordAudit({
      actorId: user.id,
      action: "project.document_upload",
      entityType: "Project",
      entityId: oid(entityId),
      summary: `Uploaded document ${fileName}`,
    });
  }

  const populated = await Attachment.findById(doc._id).populate("uploadedBy", USER_REF_FIELDS).lean();
  return toAttachmentDTO(populated, user.id, access.manage);
}

export async function deleteAttachment(user: CurrentUser, id: string): Promise<void> {
  const ctx = await accessContext(user);
  const a = await Attachment.findById(id);
  if (!a) throw notFound("File not found");
  const access = await entityAccess(ctx, a.entityType, a.entityId);
  if (!access) throw notFound("File not found");
  if (!access.manage && a.uploadedBy.toString() !== user.id) throw forbidden("Only the uploader or a manager can delete this file");
  if (access.report && !access.manage) throw unprocessable("Files on an approved report are kept as a record");
  if (access.ticket) {
    if (["CLOSED", "REJECTED"].includes(access.ticket.status)) throw unprocessable("Files on a closed ticket are kept as a record");
    if (access.submitted?.has(a._id.toString())) throw unprocessable("Submitted deliverables are kept as a record and can't be deleted");
  }
  await Attachment.deleteOne({ _id: a._id });
  await storage.remove(a.storageKey).catch(() => null);
  if (access.ticket) {
    await TicketActivity.create({
      ticket: access.ticket._id,
      actor: oid(user.id),
      action: "ATTACHMENT_REMOVED",
      from: a.fileName,
      message: `Removed ${a.kind === "DELIVERABLE" ? "deliverable" : "attachment"} ${a.fileName}`,
    });
  } else if (a.entityType === "Project") {
    await recordAudit({
      actorId: user.id,
      action: "project.document_delete",
      entityType: "Project",
      entityId: a.entityId,
      summary: `Deleted document ${a.fileName}`,
    });
  } else if (access.task) {
    await TaskActivity.create({
      task: access.task._id,
      project: access.task.project ?? null,
      actor: oid(user.id),
      action: "UPDATED",
      message: `Removed attachment ${a.fileName}`,
    });
  }
}

export async function readAttachment(user: CurrentUser, id: string) {
  const ctx = await accessContext(user);
  const a = await Attachment.findById(id).lean();
  if (!a) throw notFound("File not found");
  const access = await entityAccess(ctx, a.entityType, a.entityId);
  if (!access?.view) throw notFound("File not found");
  const data = await storage.get(a.storageKey).catch(() => {
    throw notFound("The file is no longer available");
  });
  return { data, fileName: a.fileName, mimeType: a.mimeType };
}

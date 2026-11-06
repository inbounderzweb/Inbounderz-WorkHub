import "server-only";
import { Types } from "mongoose";
import type { CurrentUser } from "@/lib/auth/current-user";
import { ApiError, badRequest, forbidden, notFound, unprocessable } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES, sanitizeFileName, storage } from "@/lib/storage";
import { Attachment, Project, Task, TaskActivity } from "@/models";
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

/* eslint-disable @typescript-eslint/no-explicit-any */

type EntityType = "Task" | "Project";

function toAttachmentDTO(a: any, userId: string, canManage: boolean): AttachmentDTO {
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
async function entityAccess(ctx: AccessContext, entityType: string, entityId: Types.ObjectId) {
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
  return null;
}

export async function uploadAttachment(
  user: CurrentUser,
  entityType: EntityType,
  entityId: string,
  file: File
): Promise<AttachmentDTO> {
  const ctx = await accessContext(user);
  const access = await entityAccess(ctx, entityType, oid(entityId));
  if (!access) throw notFound(`${entityType} not found`);
  if (!access.upload) throw forbidden("You can't upload files here");

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
  });

  if (access.task) {
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
  await Attachment.deleteOne({ _id: a._id });
  await storage.remove(a.storageKey).catch(() => null);
  if (a.entityType === "Project") {
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

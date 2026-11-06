"use client";

import { useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Download, File as FileIcon, FileImage, FileSpreadsheet, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "./confirm-dialog";
import { EmptyState } from "./states";
import { api, ApiClientError, uploadFile } from "@/lib/http";
import type { AttachmentDTO } from "@/types/dto";

const MAX = 10 * 1024 * 1024;
const ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return FileImage;
  if (mime.includes("sheet") || mime.includes("excel") || mime === "text/csv") return FileSpreadsheet;
  if (mime === "application/pdf" || mime.startsWith("text/") || mime.includes("word")) return FileText;
  return FileIcon;
}

export function AttachmentsPanel({
  items,
  uploadUrl,
  canUpload,
  onChanged,
  emptyText = "No files yet",
}: {
  items: AttachmentDTO[];
  uploadUrl: string;
  canUpload: boolean;
  onChanged: () => void;
  emptyText?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<AttachmentDTO | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    let ok = 0;
    for (const file of Array.from(files)) {
      if (file.size > MAX) {
        toast.error(`${file.name} is larger than 10 MB`);
        continue;
      }
      try {
        await uploadFile(uploadUrl, file);
        ok++;
      } catch (err) {
        toast.error(err instanceof ApiClientError ? `${file.name}: ${err.message}` : `${file.name} failed to upload`);
      }
    }
    setUploading(false);
    if (input.current) input.current.value = "";
    if (ok) {
      toast.success(`${ok} file${ok === 1 ? "" : "s"} uploaded`);
      onChanged();
    }
  }

  return (
    <div>
      {canUpload ? (
        <div
          className="m-4 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFiles(e.dataTransfer.files);
          }}
        >
          <Upload className="size-5" />
          <p>Drag files here or</p>
          <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={uploading}>
            {uploading ? <Spinner /> : <Paperclip />} Choose files
          </Button>
          <p className="text-xs">Images, PDF, Office, text, CSV or ZIP · up to 10 MB</p>
          <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => onFiles(e.target.files)} />
        </div>
      ) : null}
      {!items.length ? (
        <EmptyState icon={Paperclip} title={emptyText} className="py-6" />
      ) : (
        <ul className="divide-y border-t">
          {items.map((a) => {
            const Icon = iconFor(a.mimeType);
            return (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <Icon className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <a href={a.url} className="block truncate text-sm font-medium hover:text-primary" download>{a.fileName}</a>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatBytes(a.size)} · {a.uploadedBy?.name ?? "Unknown"} · {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                  </p>
                </div>
                <Button variant="ghost" size="icon-sm" asChild aria-label={`Download ${a.fileName}`}>
                  <a href={a.url} download><Download /></a>
                </Button>
                {a.canDelete ? (
                  <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(a)} aria-label={`Delete ${a.fileName}`}>
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.fileName}?`}
        description="The file is removed permanently."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await api(`/api/attachments/${deleting.id}`, { method: "DELETE" });
            toast.success("File deleted");
            onChanged();
          } catch (err) {
            toast.error(err instanceof ApiClientError ? err.message : "Couldn't delete the file");
            return false;
          }
        }}
      />
    </div>
  );
}

"use client";

import useSWR from "swr";
import { fetcher, qs } from "@/lib/http";
import type { Paginated, ProjectDetailDTO, ProjectOptionDTO, TaskListItemDTO, TeamMemberOptionDTO } from "@/types/dto";

export function useProjectOptions(enabled = true) {
  return useSWR<ProjectOptionDTO[]>(enabled ? "/api/projects?minimal=1" : null, fetcher);
}

export function useProjectTeam(projectId: string | null | undefined, department?: string | null) {
  return useSWR<TeamMemberOptionDTO[]>(
    projectId ? `/api/projects/${projectId}/team${qs({ department: department ?? undefined })}` : null,
    fetcher
  );
}

export function useProjectDetail(projectId: string | null | undefined) {
  return useSWR<ProjectDetailDTO>(projectId ? `/api/projects/${projectId}` : null, fetcher);
}

/** Tasks in a project (for dependency / parent pickers). */
export function useProjectTasks(projectId: string | null | undefined, enabled = true) {
  return useSWR<Paginated<TaskListItemDTO>>(
    projectId && enabled ? `/api/tasks${qs({ scope: "all", project: projectId, pageSize: 300, sort: "-createdAt" })}` : null,
    fetcher
  );
}

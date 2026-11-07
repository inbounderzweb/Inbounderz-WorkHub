"use client";

import useSWR from "swr";
import { fetcher, qs } from "@/lib/http";
import type { DepartmentRef, EligibleAssigneeDTO, TicketCategoryDTO } from "@/types/dto";

export function useTicketCategories(all = false, enabled = true) {
  return useSWR<TicketCategoryDTO[]>(enabled ? `/api/ticket-categories${qs({ all: all ? 1 : undefined })}` : null, fetcher);
}

/** Every active department a ticket can be sent to. */
export function useTicketDepartments(enabled = true) {
  return useSWR<DepartmentRef[]>(enabled ? "/api/tickets/departments" : null, fetcher);
}

export function useEligibleAssignees(ticketId: string | null, department: string | null | undefined) {
  return useSWR<EligibleAssigneeDTO[]>(ticketId && department ? `/api/tickets/${ticketId}/assignees${qs({ department })}` : null, fetcher);
}

"use client";

import useSWR from "swr";
import { fetcher, qs } from "@/lib/http";
import type { DepartmentOptionDTO, EmployeeOptionDTO } from "@/types/dto";

export function useDepartmentOptions(enabled = true) {
  return useSWR<DepartmentOptionDTO[]>(enabled ? "/api/departments?all=1" : null, fetcher);
}

export function useEmployeeOptions(
  params: { status?: string; role?: string; department?: string } = {},
  enabled = true
) {
  return useSWR<EmployeeOptionDTO[]>(enabled ? `/api/employees${qs({ minimal: 1, ...params })}` : null, fetcher);
}

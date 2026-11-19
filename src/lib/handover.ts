/**
 * Rules of the Sales-to-delivery handover. Pure functions (no I/O) shared by the services, the UI
 * and the tests.
 *
 * Project: DRAFT -> HANDOVER_PENDING -> PM_ACCEPTED -> PLANNING -> ACTIVE
 *                      |
 *                      v (the Project Manager rejects: the project is cancelled, no department is told)
 *                  CANCELLED
 * `revise` (the Project Manager edits the scope and gives a reason) changes nothing about the status.
 * Only the handover actions (submit / nominate / accept / reject) move a project in or out of the
 * handover statuses. A plain project edit can never make someone the manager.
 */
import type { PmAssignmentStatus, ProjectStatus } from "./constants";
import { HANDOVER_PROJECT_STATUSES } from "./constants";

export type HandoverAction = "submit" | "nominate" | "accept" | "reject" | "revise";

/** Why a plain status edit (PATCH /projects/:id) is not allowed, or null when it is. */
export function statusEditError(from: ProjectStatus, to: ProjectStatus): string | null {
  if (from === to) return null;
  if (HANDOVER_PROJECT_STATUSES.includes(from)) return "This project is still in the Sales handover. Use the handover actions to move it forward.";
  if (HANDOVER_PROJECT_STATUSES.includes(to) || to === "PM_ACCEPTED") return "Handover statuses are set only by the handover workflow.";
  if (from === "PM_ACCEPTED" && to !== "PLANNING" && to !== "CANCELLED") return "An accepted project moves to Planning first.";
  return null;
}

/** The status a project and its current assignment move to for an action, or why it can't happen. */
export function handoverTransition(
  action: HandoverAction,
  project: ProjectStatus,
  assignment: PmAssignmentStatus | null
): { project: ProjectStatus; assignment: PmAssignmentStatus } | { error: string } {
  switch (action) {
    case "submit":
      if (project !== "DRAFT" || assignment !== "DRAFT") return { error: "Only a draft handover can be submitted" };
      return { project: "HANDOVER_PENDING", assignment: "PENDING" };
    case "nominate":
      if (project === "PM_REJECTED") return { project: "HANDOVER_PENDING", assignment: "PENDING" };
      if (project === "HANDOVER_PENDING" && assignment === "PENDING") return { project: "HANDOVER_PENDING", assignment: "PENDING" };
      if (project === "DRAFT") return { project: "DRAFT", assignment: "DRAFT" };
      return { error: "A Project Manager can only be nominated before the handover is accepted" };
    case "accept":
      if (project !== "HANDOVER_PENDING" || assignment !== "PENDING") return { error: "This handover is not waiting for a response" };
      return { project: "PM_ACCEPTED", assignment: "ACCEPTED" };
    case "reject":
      if (project !== "HANDOVER_PENDING" || assignment !== "PENDING") return { error: "This handover is not waiting for a response" };
      return { project: "CANCELLED", assignment: "REJECTED" };
    case "revise":
      if (project !== "HANDOVER_PENDING" || assignment !== "PENDING") return { error: "The scope can only be edited while the handover is waiting for the Project Manager" };
      return { project: "HANDOVER_PENDING", assignment: "PENDING" };
  }
}

/** Distinct, non-empty ids; the primary PM is never also listed as supporting or coordinator. */
export function teamConflicts(team: { primaryPm?: string | null; supportingPms?: string[]; coordinator?: string | null }): string | null {
  const supporting = team.supportingPms ?? [];
  if (new Set(supporting).size !== supporting.length) return "A supporting Project Manager was listed twice";
  if (team.primaryPm && supporting.includes(team.primaryPm)) return "The primary Project Manager cannot also be a supporting Project Manager";
  if (team.coordinator && supporting.includes(team.coordinator)) return "A supporting Project Manager cannot also be the coordinator";
  if (team.primaryPm && team.coordinator && team.primaryPm === team.coordinator) return "The primary Project Manager cannot also be the coordinator";
  return null;
}

import type {
  ApprovalMode,
  MilestoneStatus,
  ProjectMemberRole,
  DepartmentStatus,
  NotificationType,
  ProjectStatus,
  ReviewStatus,
  RoleKey,
  TaskPriority,
  TaskStatus,
  TicketStatus,
  UserStatus,
} from "@/lib/constants";

/** JSON shapes returned by the API. Dates are ISO strings. */

export type UserRef = { id: string; name: string; email: string; avatarUrl?: string; designation?: string };
export type DepartmentRef = { id: string; name: string; code: string; color: string };
export type RoleRef = { key: RoleKey; name: string };

export type EmployeeDTO = {
  id: string;
  name: string;
  email: string;
  phone: string;
  employeeId: string;
  designation: string;
  avatarUrl: string;
  role: RoleRef | null;
  department: DepartmentRef | null;
  reportingManager: UserRef | null;
  joiningDate: string | null;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeDetailDTO = EmployeeDTO & {
  directReports: (UserRef & { role: RoleRef | null; status: UserStatus })[];
  stats: {
    openTasks: number;
    inProgress: number;
    completedTasks: number;
    overdueTasks: number;
    projects: number;
  };
  recentTasks: TaskSummaryDTO[];
  /** What the viewer may do with this employee. */
  can: {
    edit: boolean;
    changeRole: boolean;
    changeStatus: boolean;
    resetPassword: boolean;
  };
};

export type EmployeeOptionDTO = {
  id: string;
  name: string;
  email: string;
  employeeId: string;
  role: RoleKey | null;
  departmentId: string | null;
  status: UserStatus;
};

export type DepartmentDTO = {
  id: string;
  name: string;
  code: string;
  description: string;
  color: string;
  status: DepartmentStatus;
  head: UserRef | null;
  teamLeaders: UserRef[];
  projectManagers: UserRef[];
  employeeCount: number;
  activeProjects: number;
  openTasks: number;
  createdAt: string;
  updatedAt: string;
};

export type DepartmentDetailDTO = DepartmentDTO & {
  stats: {
    employees: number;
    activeEmployees: number;
    activeProjects: number;
    openTasks: number;
    overdueTasks: number;
    inReview: number;
    completedTasks: number;
  };
  tasksByStatus: { status: TaskStatus; count: number }[];
  recentTasks: TaskSummaryDTO[];
  projects: { id: string; name: string; code: string; status: ProjectStatus; progress: number }[];
  can: {
    edit: boolean;
    assignHead: boolean;
    assignLeaders: boolean;
    manageMembers: boolean;
    delete: boolean;
  };
};

export type DepartmentOptionDTO = DepartmentRef & { status: DepartmentStatus };

export type TaskSummaryDTO = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  owner: UserRef | null;
  project: { id: string; name: string; code: string } | null;
  isOverdue: boolean;
};

export type NotificationDTO = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string;
  isRead: boolean;
  createdAt: string;
  actor: UserRef | null;
};

export type ActivityDTO = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  actor: UserRef | null;
  createdAt: string;
};

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type SearchResultDTO = {
  employees: { id: string; name: string; email: string; employeeId: string; department: string | null }[];
  departments: { id: string; name: string; code: string; color: string }[];
  projects: { id: string; name: string; code: string; status: ProjectStatus }[];
  tasks: { id: string; taskNumber: string; title: string; status: TaskStatus }[];
};

/* ------------------------------------------------------------------ */
/* Projects & tasks                                                    */
/* ------------------------------------------------------------------ */

export type ProgressDTO = {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  cancelled: number;
  overdue: number;
  percent: number;
};

export type ProjectDTO = {
  id: string;
  code: string;
  name: string;
  client: string;
  description: string;
  status: ProjectStatus;
  priority: TaskPriority;
  manager: UserRef | null;
  departments: DepartmentRef[];
  startDate: string | null;
  endDate: string | null;
  budget: number | null;
  approvalMode: ApprovalMode;
  isArchived: boolean;
  memberCount: number;
  progress: ProgressDTO;
  createdAt: string;
  updatedAt: string;
};

export type ProjectMemberDTO = {
  id: string;
  user: UserRef & { status: UserStatus; employeeId: string };
  department: DepartmentRef | null;
  projectRole: ProjectMemberRole;
  allocationPercent: number;
  isActive: boolean;
  joinedAt: string;
  leftAt: string | null;
  openTasks: number;
};

export type MilestoneDTO = {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  status: MilestoneStatus;
  completedAt: string | null;
  taskCount: number;
  completedTaskCount: number;
};

export type AttachmentDTO = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
  uploadedBy: UserRef | null;
  createdAt: string;
  canDelete: boolean;
};

export type ProjectDetailDTO = ProjectDTO & {
  notes: string;
  members: ProjectMemberDTO[];
  formerMembers: ProjectMemberDTO[];
  milestones: MilestoneDTO[];
  documents: AttachmentDTO[];
  timeline: { id: string; taskNumber: string; title: string; status: TaskStatus; startDate: string | null; dueDate: string | null; owner: string | null }[];
  can: { edit: boolean; manageTeam: boolean; archive: boolean; createTask: boolean; taskDepartments: string[] };
};

export type ProjectOptionDTO = {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  isArchived: boolean;
  departments: DepartmentRef[];
  approvalMode: ApprovalMode;
  /** Departments where the viewer may create tasks. */
  taskDepartments: string[];
  /** Whether the viewer can raise a task here (own department directly, other project departments as a request). */
  canRequestTasks: boolean;
  /** Project managers may add another active department while creating work. */
  canAddDepartments: boolean;
};

export type TeamMemberOptionDTO = {
  id: string;
  name: string;
  email: string;
  employeeId: string;
  designation: string;
  departmentId: string | null;
  projectRole: ProjectMemberRole;
};

export type TaskListItemDTO = {
  workApprovalStatus: import("@/lib/constants").WorkApprovalStatus;
  id: string;
  taskNumber: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  project: { id: string; name: string; code: string } | null;
  department: DepartmentRef | null;
  owner: UserRef | null;
  assignedBy: UserRef | null;
  startDate: string | null;
  dueDate: string | null;
  isOverdue: boolean;
  isBlocked: boolean;
  parentTask: { id: string; taskNumber: string; title: string } | null;
  subtaskCount: number;
  checklist: { total: number; done: number };
  approvalRequired: boolean;
  allowedStatuses: TaskStatus[];
  canReassign: boolean;
  /** Compact timer state for list rows. */
  liveTimer: { running: boolean; startedAt: string | null; totalSeconds: number; serverNow: string; canTrack: boolean; pauseNote: string };
  updatedAt: string;
};

export type TaskRefDTO = { id: string; taskNumber: string; title: string; status: TaskStatus };

export type TaskCommentDTO = {
  id: string;
  body: string;
  kind: "COMMENT" | "REVIEW" | "BLOCKER";
  author: UserRef | null;
  createdAt: string;
  attachments: AttachmentDTO[];
};

export type TaskActivityDTO = {
  id: string;
  action: string;
  message: string;
  from: unknown;
  to: unknown;
  actor: UserRef | null;
  createdAt: string;
};

export type TaskTimeLogDTO = {
  id: string;
  user: UserRef | null;
  startedAt: string;
  endedAt: string;
  seconds: number;
  pauseReason: string;
  endKind: "PAUSED" | "AUTO";
};

export type TaskTimerDTO = {
  running: boolean;
  startedAt: string | null;
  by: UserRef | null;
  /** Seconds in closed sessions (excludes the running one). */
  totalSeconds: number;
  /** Server clock at response time, so the client can correct for clock skew. */
  serverNow: string;
  log: TaskTimeLogDTO[];
};

export type TaskDetailDTO = TaskListItemDTO & {
  workApproval: {
    requestedBy: UserRef | null;
    requestedAt: string | null;
    reviewedBy: UserRef | null;
    reviewedAt: string | null;
    comment: string;
  };
  description: string;
  collaborators: UserRef[];
  createdBy: UserRef | null;
  milestone: { id: string; title: string } | null;
  estimatedHours: number | null;
  actualHours: number | null;
  completedAt: string | null;
  approvalMode: ApprovalMode;
  submittedAt: string | null;
  approvedBy: UserRef | null;
  approvedAt: string | null;
  blocker: { isBlocked: boolean; reason: string; reportedBy: UserRef | null; reportedAt: string | null };
  timer: TaskTimerDTO;
  checklistItems: { id: string; text: string; done: boolean; doneBy: UserRef | null; doneAt: string | null }[];
  dependencies: TaskRefDTO[];
  dependents: TaskRefDTO[];
  subtasks: (TaskRefDTO & { owner: UserRef | null; dueDate: string | null })[];
  unresolvedDependencies: number;
  openSubtasks: number;
  attachments: AttachmentDTO[];
  comments: TaskCommentDTO[];
  activity: TaskActivityDTO[];
  can: {
    edit: boolean;
    reassign: boolean;
    requestWorkApproval: boolean;
    reviewWorkRequest: boolean;
    review: boolean;
    comment: boolean;
    updateChecklist: boolean;
    upload: boolean;
    reportBlocker: boolean;
    logHours: boolean;
    trackTime: boolean;
    addSubtask: boolean;
  };
};

/* ------------------------------------------------------------------ */
/* Tickets                                                             */
/* ------------------------------------------------------------------ */

export type TicketDTO = {
  projectManager: UserRef | null;
  id: string;
  ticketNumber: string;
  title: string;
  category: string;
  priority: TaskPriority;
  status: TicketStatus;
  requestingDepartment: DepartmentRef | null;
  targetDepartment: DepartmentRef | null;
  /** Reviewer chosen by the Project Manager; null on legacy tickets (the requester reviews). */
  assignedReviewer: UserRef | null;
  reviewStatus: ReviewStatus;
  /** Other departments involved in this ticket. */
  additionalDepartments: DepartmentRef[];
  createdBy: UserRef | null;
  assignee: UserRef | null;
  /** 1-based place in the assignee's manager-defined queue; null when the ticket isn't in an open queue. */
  queuePosition: number | null;
  queueSize: number;
  /** Whether the viewer may move this ticket within the assignee's queue. */
  canReorder: boolean;
  dueDate: string | null;
  expectedCompletion: string | null;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TicketActivityDTO = {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  from: string | null;
  to: string | null;
  message: string;
  actor: UserRef | null;
  createdAt: string;
};

export type TicketDetailDTO = TicketDTO & {
  description: string;
  referenceLinks: string[];
  /** Hidden from the assignee and everyone outside the requester / triage side. */
  suggestedEmployee: UserRef | null;
  approvedBy: UserRef | null;
  approvedAt: string | null;
  assignedBy: UserRef | null;
  assignedAt: string | null;
  estimatedHours: number | null;
  decisionReason: string;
  clarificationRequest: string;
  submissionNote: string;
  startedAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  attachments: AttachmentDTO[];
  activity: TicketActivityDTO[];
  /** Who the submitted work goes to. `legacy` = no reviewer assigned, so the requester reviews. */
  reviewRoutedTo: { user: UserRef | null; legacy: boolean };
  reviewComments: { id: string; author: UserRef | null; decision: "APPROVED" | "CHANGES_REQUESTED"; comment: string; createdAt: string }[];
  reviewHistory: { id: string; previousReviewer: UserRef | null; newReviewer: UserRef | null; changedBy: UserRef | null; reason: string; createdAt: string }[];
  reviewDecidedBy: UserRef | null;
  reviewDecidedAt: string | null;
  timer: TaskTimerDTO;
  can: {
    edit: boolean;
    setReviewer: boolean;
    changeProjectManager: boolean;
    submit: boolean;
    triage: boolean;
    approve: boolean;
    assign: boolean;
    reassign: boolean;
    setDates: boolean;
    setPriority: boolean;
    respond: boolean;
    start: boolean;
    hold: boolean;
    resume: boolean;
    submitWork: boolean;
    trackTime: boolean;
    review: boolean;
    cancel: boolean;
    escalate: boolean;
    comment: boolean;
    upload: boolean;
  };
};

export type WorkloadRowDTO = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  designation: string;
  employeeId: string;
  activeItems: number;
  /** Breakdown of activeItems. */
  ticketItems: number;
  taskItems: number;
  /** Items still waiting to be started. */
  pendingItems: number;
  openHours: number;
  category: WorkloadCategory;
  /** Active items with no estimate (counted at the configured fallback hours). */
  unestimatedItems: number;
  capacityHours: number;
  overdue: number;
  nextDue: string | null;
  loadPercent: number;
  availability: "AVAILABLE" | "LIMITED" | "FULL";
  suggested: boolean;
};

export type TicketSummaryDTO = {
  raised: { total: number; draft: number; pending: number; clarification: number; inProgress: number; review: number; completed: number; closed: number };
  assigned: { total: number; pending: number; inProgress: number; onHold: number; review: number; completed: number; closed: number };
  queue: { pendingApproval: number; underReview: number; clarification: number; unassigned: number; overdue: number } | null;
  department: { open: number; overdue: number } | null;
};

/** One employee in a manager's team workload overview. */
export type TeamWorkloadDTO = WorkloadRowDTO & { department: string };

/* ---------------- Workload analytics ---------------- */

export type WorkloadCategory = "NONE" | "LOW" | "MODERATE" | "HIGH" | "OVERLOADED";
export type WorkloadPeriod = "week" | "month";

export type WorkloadSettingsDTO = {
  hoursPerDay: number;
  daysPerWeek: number;
  moderateFrom: number;
  highFrom: number;
  overloadedAbove: number;
  onHoldWeight: number;
  reviewWeight: number;
  fallbackHours: number;
};

export type EmployeeWorkloadDTO = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  employeeId: string;
  designation: string;
  department: { id: string; name: string; color: string } | null;
  activeItems: number;
  ticketItems: number;
  taskItems: number;
  pending: number;
  inProgress: number;
  onHold: number;
  review: number;
  overdue: number;
  /** Hours counted against capacity (on-hold / review weighted per settings). */
  workloadHours: number;
  unestimatedItems: number;
  capacityHours: number;
  availableHours: number;
  utilization: number;
  /** True when some active items had no estimate and were counted at the fallback hours. */
  estimated: boolean;
  category: WorkloadCategory;
  nextDue: string | null;
};

export type WorkloadDepartmentDTO = {
  id: string;
  name: string;
  employees: number;
  none: number;
  occupied: number;
  overloaded: number;
  avgUtilization: number;
  counts: Record<WorkloadCategory, number>;
};

export type WorkloadTrendPointDTO = { label: string; active: number; assigned: number; completed: number; overdue: number };

export type WorkloadOverviewDTO = {
  period: WorkloadPeriod;
  capacityHours: number;
  settings: WorkloadSettingsDTO;
  canConfigure: boolean;
  total: number;
  counts: Record<WorkloadCategory, number>;
  /** Same counts one period ago, rebuilt from assignment history (status weights can't be replayed). Null when there is nobody to compare. */
  previous: Record<WorkloadCategory, number> | null;
  previousTotal: number;
  departments: WorkloadDepartmentDTO[];
  trend: WorkloadTrendPointDTO[];
  filters: { departments: { id: string; name: string }[]; projects: { id: string; name: string }[] };
};

export type WorkloadEmployeesDTO = Paginated<EmployeeWorkloadDTO> & { chart: EmployeeWorkloadDTO[] };

export type WorkloadItemDTO = {
  type: "TICKET" | "TASK";
  id: string;
  number: string;
  title: string;
  priority: TaskPriority;
  status: string;
  estimatedHours: number | null;
  /** Hours this item currently counts against capacity. */
  countedHours: number;
  share: number;
  dueDate: string | null;
  overdue: boolean;
  project: string | null;
  link: string;
};

export type WorkloadDetailDTO = {
  employee: EmployeeWorkloadDTO;
  items: WorkloadItemDTO[];
  priorities: Record<TaskPriority, number>;
  upcoming: WorkloadItemDTO[];
  completedLast30Days: number;
};

/** One row of the review queue. `canReview` is true only for the assigned reviewer and administrators. */
export type ReviewQueueRowDTO = {
  id: string;
  ticketNumber: string;
  title: string;
  targetDepartment: DepartmentRef | null;
  status: TicketStatus;
  reviewStatus: ReviewStatus;
  assignee: UserRef | null;
  assignedReviewer: UserRef | null;
  /** True when no reviewer is assigned and the requester reviews (legacy ticket). */
  legacyReviewer: boolean;
  reviewerName: string | null;
  submittedAt: string | null;
  isOverdue: boolean;
  canReview: boolean;
};

export type ReviewerOptionDTO = {
  id: string;
  name: string;
  email: string;
  employeeId: string;
  avatarUrl: string;
  designation: string;
  department: string;
};

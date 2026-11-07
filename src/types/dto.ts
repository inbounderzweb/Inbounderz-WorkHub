import type {
  ApprovalMode,
  MilestoneStatus,
  ProjectMemberRole,
  DepartmentStatus,
  NotificationType,
  ProjectStatus,
  RoleKey,
  TaskPriority,
  TaskSourceType,
  TaskStatus,
  TicketStatus,
  UserStatus,
  DailyUpdateStatus,
} from "@/lib/constants";
import type { TicketAction } from "@/lib/ticket-workflow";

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
  /** Set for internal-request work items. */
  ticket?: { id: string; ticketNumber: string } | null;
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
  /** Field-level details recorded with the entry: { field: { from, to } }. */
  changes?: Record<string, { from: unknown; to: unknown }> | null;
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
  tickets: { id: string; ticketNumber: string; title: string; status: TicketStatus }[];
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
  updatedAt: string;
  sourceType: TaskSourceType;
  /** Internal request this task delivers (sourceType "internal_ticket"). */
  linkedTicket: { id: string; ticketNumber: string } | null;
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

export type TaskDetailDTO = TaskListItemDTO & {
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
    review: boolean;
    comment: boolean;
    updateChecklist: boolean;
    upload: boolean;
    reportBlocker: boolean;
    logHours: boolean;
    addSubtask: boolean;
  };
};

/* ------------------------------------------------------------------ */
/* Internal tickets                                                    */
/* ------------------------------------------------------------------ */

export type TicketCategoryDTO = {
  id: string;
  name: string;
  description: string;
  defaultDepartment: DepartmentRef | null;
  isActive: boolean;
  order: number;
  ticketCount?: number;
};

export type TicketListItemDTO = {
  id: string;
  ticketNumber: string;
  title: string;
  status: TicketStatus;
  priority: TaskPriority;
  category: { id: string; name: string };
  requester: UserRef | null;
  requestingDepartment: DepartmentRef | null;
  targetDepartment: DepartmentRef | null;
  project: { id: string; name: string; code: string } | null;
  assignee: UserRef | null;
  dueDate: string;
  isOverdue: boolean;
  linkedTask: { id: string; taskNumber: string } | null;
  /** The viewer is the one who needs to act next. */
  awaitingMe: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TicketAssignmentDTO = {
  id: string;
  employee: UserRef | null;
  department: DepartmentRef | null;
  assignedBy: UserRef | null;
  assignedAt: string;
  note: string;
  endedAt: string | null;
  endReason: "REASSIGNED" | "REJECTED" | null;
};

export type TicketResolutionDTO = {
  id: string;
  round: number;
  note: string;
  deliverables: AttachmentDTO[];
  submittedBy: UserRef | null;
  submittedAt: string;
  outcome: "PENDING" | "ACCEPTED" | "CHANGES_REQUESTED";
  reviewedBy: UserRef | null;
  reviewedAt: string | null;
  feedback: string;
};

export type TicketCommentDTO = {
  id: string;
  body: string;
  kind: "COMMENT" | "INFO_REQUEST" | "INFO_RESPONSE" | "RESOLUTION" | "CHANGE_REQUEST" | "CLOSURE" | "REJECTION" | "REOPEN" | "ASSIGNMENT";
  author: UserRef | null;
  createdAt: string;
};

export type TicketActivityDTO = {
  id: string;
  action: string;
  message: string;
  from: unknown;
  to: unknown;
  actor: UserRef | null;
  createdAt: string;
};

export type TicketDetailDTO = TicketListItemDTO & {
  description: string;
  referenceLinks: string[];
  category: { id: string; name: string };
  assignedBy: UserRef | null;
  assignedAt: string | null;
  reviewedBy: UserRef | null;
  reviewedAt: string | null;
  startedAt: string | null;
  resolvedAt: string | null;
  reopenCount: number;
  assignments: TicketAssignmentDTO[];
  infoRequest: { requestedBy: UserRef | null; requestedAt: string | null; message: string } | null;
  resolutions: TicketResolutionDTO[];
  /** Deliverables uploaded since the last submission (not yet submitted). */
  draftDeliverables: AttachmentDTO[];
  attachments: AttachmentDTO[];
  comments: TicketCommentDTO[];
  activity: TicketActivityDTO[];
  closure: { closedBy: UserRef | null; closedAt: string | null; note: string; byManager: boolean } | null;
  rejection: { rejectedBy: UserRef | null; rejectedAt: string | null; reason: string } | null;
  linkedTaskStatus: TaskStatus | null;
  actions: TicketAction[];
  viewer: { isRequester: boolean; isAssignee: boolean; canManage: boolean; canMonitor: boolean };
  can: { comment: boolean; upload: boolean; uploadDeliverable: boolean; edit: boolean };
};

export type TicketSummaryDTO = {
  counts: Record<TicketStatus, number>;
  overdue: number;
  open: number;
  awaitingMe: number;
  requesters: UserRef[];
  assignees: UserRef[];
};

export type EligibleAssigneeDTO = {
  id: string;
  name: string;
  email: string;
  employeeId: string;
  designation: string;
  role: RoleKey | null;
  openTasks: number;
};

/* ------------------------------------------------------------------ */
/* Daily work updates                                                  */
/* ------------------------------------------------------------------ */

export type DailyUpdateDTO = {
  id: string;
  date: string;
  user: UserRef | null;
  department: DepartmentRef | null;
  project: { id: string; name: string; code: string } | null;
  task: { id: string; taskNumber: string; title: string } | null;
  workCompleted: string;
  pendingWork: string;
  blockers: string;
  hoursSpent: number;
  status: DailyUpdateStatus;
  revision: number;
  submittedAt: string;
  updatedAt: string;
  reviewedBy: UserRef | null;
  reviewedAt: string | null;
  reviewComment: string;
  attachmentCount: number;
  can: { edit: boolean; delete: boolean; review: boolean };
};

export type DailyUpdateDetailDTO = DailyUpdateDTO & {
  attachments: AttachmentDTO[];
  history: { action: string; by: UserRef | null; at: string; comment: string }[];
  canUpload: boolean;
};

export type DailySummaryDTO = {
  view: "day" | "week";
  from: string;
  to: string;
  days: string[];
  rows: {
    user: UserRef;
    department: string | null;
    reports: number;
    hours: number;
    hoursByDay: Record<string, number>;
    approved: number;
    pending: number;
    changesRequested: number;
    blockers: number;
  }[];
  /** Active team members with no report in the period (team scope only). */
  missing: UserRef[];
  totals: { reports: number; hours: number; employees: number; blockers: number; pending: number };
};

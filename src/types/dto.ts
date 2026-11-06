import type {
  DepartmentStatus,
  NotificationType,
  ProjectStatus,
  RoleKey,
  TaskPriority,
  TaskStatus,
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
};

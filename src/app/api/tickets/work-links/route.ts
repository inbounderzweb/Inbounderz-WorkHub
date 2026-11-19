import { withAuth } from "@/lib/api";
import { ticketProjectOptions, ticketTaskOptions } from "@/services/ticket-task.service";

/** Options for the ticket form: open projects, or (with ?project=) that project's open tasks. */
export const GET = withAuth(
  async (req, _ctx, user) => {
    const project = new URL(req.url).searchParams.get("project");
    return project && /^[a-f\d]{24}$/i.test(project) ? ticketTaskOptions(user, project) : ticketProjectOptions(user);
  },
  { permission: "ticket:create" }
);

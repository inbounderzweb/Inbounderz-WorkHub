import "server-only";
import { ApiError } from "@/lib/api";
import { nextSequence, Task, Ticket } from "@/models";

/** Next free task number (TSK-00001). Skips numbers taken by pre-counter data. */
export async function generateTaskNumber(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const n = `TSK-${String(await nextSequence("taskNumber")).padStart(5, "0")}`;
    if (!(await Task.exists({ taskNumber: n }))) return n;
  }
  throw new ApiError(500, "Could not generate a task number");
}

/** Next free ticket number (TKT-0001). */
export async function generateTicketNumber(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const n = `TKT-${String(await nextSequence("ticketNumber")).padStart(4, "0")}`;
    if (!(await Ticket.exists({ ticketNumber: n }))) return n;
  }
  throw new ApiError(500, "Could not generate a ticket number");
}

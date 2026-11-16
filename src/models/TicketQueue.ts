import { Schema } from "mongoose";
import { defineModel } from "./_helpers";

/**
 * One document per employee queue (its _id is the employee's user id). It only exists to serialise
 * concurrent re-orders: a writer claims `lockedUntil` atomically before rewriting the queue's ranks.
 */
const TicketQueueSchema = new Schema({ lockedUntil: { type: Date, default: null } }, { timestamps: false });

export const TicketQueue = defineModel("TicketQueue", TicketQueueSchema);

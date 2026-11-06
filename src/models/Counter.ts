import { Schema } from "mongoose";
import { defineModel } from "./_helpers";

/** Atomic sequences (e.g. employee IDs). */
const CounterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export const Counter = defineModel("Counter", CounterSchema);

export async function nextSequence(name: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  ).lean();
  return doc!.seq;
}

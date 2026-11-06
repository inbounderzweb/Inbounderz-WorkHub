import mongoose, { type InferSchemaType, type Model, type Schema } from "mongoose";

/**
 * Registers a model once and returns it typed from its schema.
 * Next.js hot reloading re-evaluates modules, and re-registering a model
 * throws `OverwriteModelError`, so reuse the existing one when present.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineModel<TSchema extends Schema<any>>(
  name: string,
  schema: TSchema
): Model<InferSchemaType<TSchema>> {
  const existing = mongoose.models[name] as Model<InferSchemaType<TSchema>> | undefined;
  return existing ?? mongoose.model<InferSchemaType<TSchema>>(name, schema);
}

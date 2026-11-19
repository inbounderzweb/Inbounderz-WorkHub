import mongoose, { type InferSchemaType, type Model, type Schema } from "mongoose";

/**
 * Registers a model once and returns it typed from its schema.
 * Next.js hot reloading re-evaluates modules, and re-registering a model
 * throws `OverwriteModelError`, so reuse the existing one when present.
 *
 * In development a re-evaluated module brings a NEW schema object (e.g. a field was added).
 * Reusing the old model would silently drop the new fields on save until a restart, so the
 * model is re-registered instead. Production evaluates each model once and is unaffected.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineModel<TSchema extends Schema<any>>(
  name: string,
  schema: TSchema
): Model<InferSchemaType<TSchema>> {
  const existing = mongoose.models[name] as Model<InferSchemaType<TSchema>> | undefined;
  if (existing && process.env.NODE_ENV !== "production" && existing.schema !== schema) {
    mongoose.deleteModel(name);
    return mongoose.model<InferSchemaType<TSchema>>(name, schema);
  }
  return existing ?? mongoose.model<InferSchemaType<TSchema>>(name, schema);
}

/**
 * Makes a collection append-only at the application layer: Mongoose update/delete operations on it throw.
 * This guards every code path that goes through Mongoose. It cannot stop someone with raw database
 * access, so production should also run the app with a database user that has no update/delete
 * privilege on these collections.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeAppendOnly(schema: Schema<any>, label: string): void {
  const refuse = () => {
    throw new Error(`${label} is append-only: records cannot be modified or deleted.`);
  };
  for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"] as const) {
    schema.pre(op, refuse);
  }
  schema.pre("save", function () {
    if (!this.isNew) refuse();
  });
}

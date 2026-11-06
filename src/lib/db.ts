import mongoose from "mongoose";

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  var __mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = globalThis.__mongooseCache ?? { conn: null, promise: null };
globalThis.__mongooseCache = cache;

mongoose.set("strictQuery", true);

/**
 * Returns a shared Mongoose connection. The connection promise is cached on
 * `globalThis` so hot reloads in development and warm serverless invocations
 * reuse the same pool instead of opening a new one per request.
 */
export async function connectDB(): Promise<typeof mongoose> {
  if (cache.conn && mongoose.connection.readyState === 1) return cache.conn;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set. Add it to .env.local (see .env.example).");
  }

  if (!cache.promise) {
    cache.promise = mongoose
      .connect(uri, {
        bufferCommands: false,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10_000,
      })
      .catch((err) => {
        cache.promise = null; // allow retry on the next request
        throw err;
      });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}

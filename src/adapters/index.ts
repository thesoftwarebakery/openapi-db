// Shared adapter interfaces
export type { Adapter, Context, InterpolationHelpers } from "./types.js";

// Built-in adapters
export { PgAdapter } from "./postgres/index.js";
export { MongoAdapter } from "./mongodb/index.js";

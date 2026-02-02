// Main entry point
export { createRouter } from "./router.js";

// Error class
export { OpenApiDbError } from "./errors.js";
export type { ErrorCode } from "./errors.js";

// Adapter types and implementations
export type { Adapter, Context, InterpolationHelpers } from "./adapters/types.js";
export { PgAdapter } from "./adapters/postgres/index.js";
export { MysqlAdapter } from "./adapters/mysql/index.js";
export { MongoAdapter } from "./adapters/mongodb/index.js";

// Helpers (for custom adapter implementations)
export { createHelpers } from "./helpers.js";

// Types
export type {
  RouterOptions,
  Router,
  RouterResponse,
  CompiledRoute,
  RouteMatch,
  XDbExtension,
  ParsedQuery,
  InterpolationContext,
  AuthResolver,
  OpenApiSpec,
  OpenApiParameter,
} from "./types.js";

// Response shaping
export type { ResponseConfig } from "./response.js";
export { shapeResponse, applyFieldMapping } from "./response.js";

// Internal utilities (for advanced use cases)
export { parseSpec } from "./parser.js";
export { parseTemplate } from "./template.js";
export { matchRoute, compileRoute } from "./matcher.js";

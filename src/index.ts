// Main entry point
export { createRouter } from "./router.js";

// Error class
export { OpenApiDbError } from "./errors.js";
export type { ErrorCode } from "./errors.js";

// Types
export type {
  RouterOptions,
  Router,
  RouterResponse,
  CompiledRoute,
  RouteMatch,
  XDbExtension,
  XDbResponse,
  ParsedQuery,
  InterpolationContext,
  AuthResolver,
  OpenApiSpec,
  OpenApiParameter,
} from "./types.js";

// Internal utilities (for advanced use cases)
export { parseSpec } from "./parser.js";
export { parseTemplate } from "./template.js";
export { matchRoute, compileRoute } from "./matcher.js";
export { shapeResponse, applyFieldMapping } from "./response.js";
export { executeQuery } from "./executor.js";

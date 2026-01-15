// Framework adapters
export { openApiDb } from "./frameworks/express.js";

// Core utilities
export { parseSpec } from "./parser.js";
export { parseTemplate } from "./template.js";
export { validateRoutes } from "./validation.js";

// Database adapters
export { executeQuery, shapeResponse, applyFieldMapping } from "./adapters/postgres.js";

// Types
export type {
  OpenApiDbOptions,
  XDbExtension,
  XDbResponse,
  ParsedRoute,
  ParsedQuery,
  InterpolationContext,
  AuthResolver,
  OpenApiSpec,
  OpenApiParameter,
} from "./types.js";

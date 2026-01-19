import type { IncomingMessage } from "node:http";
import type { Adapter } from "./adapters/types.js";

/**
 * Configuration options for the router
 */
export interface RouterOptions {
  /** Path to OpenAPI spec file (YAML/JSON), or pre-parsed spec object */
  spec: string | OpenApiSpec;

  /**
   * Database adapters keyed by name.
   * Routes reference adapters via x-db.adapter field.
   */
  adapters: Record<string, Adapter>;

  /** Optional auth resolver - extracts user context from request */
  auth?: AuthResolver;
}

export type AuthResolver = (
  req: IncomingMessage
) => Promise<Record<string, unknown> | null>;

/**
 * Router interface returned by createRouter
 */
export interface Router {
  handle(req: IncomingMessage): Promise<RouterResponse | null>;
}

/**
 * Response object returned by router.handle()
 */
export interface RouterResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

/**
 * The x-db extension schema for OpenAPI operations
 */
export interface XDbExtension {
  /** The query template (string for SQL, object for NoSQL) */
  query: unknown;

  /**
   * Adapter name from the adapters config.
   * Optional if only one adapter is configured.
   */
  adapter?: string;

  /**
   * Field mapping: { apiFieldName: db_column_name }
   * Applied to every row before extraction.
   */
  fields?: Record<string, string>;

  /**
   * JSON Pointer (RFC 6901) for extracting from result array.
   * Examples: "/0" (first row), "/0/total" (scalar from first row)
   * If omitted, returns full array.
   */
  returns?: string;
}

/**
 * A compiled route with regex pattern for matching
 */
export interface CompiledRoute {
  /** HTTP method (lowercase): get, post, put, delete, patch */
  method: HttpMethod;

  /** Regex pattern for matching paths */
  pattern: RegExp;

  /** Names of path parameters in order */
  paramNames: string[];

  /** The x-db extension configuration */
  xDb: XDbExtension;

  /** OpenAPI parameter definitions for this route */
  parameters: OpenApiParameter[];

  /** Whether this route uses $auth.* variables */
  usesAuth: boolean;

  /** Original OpenAPI path for error messages, e.g., /users/{id} */
  originalPath: string;
}

/**
 * Result of matching a request against compiled routes
 */
export interface RouteMatch {
  route: CompiledRoute;
  pathParams: Record<string, string>;
}

export type HttpMethod = "get" | "post" | "put" | "delete" | "patch";

/**
 * OpenAPI parameter definition
 */
export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: OpenApiSchema;
  style?: "form" | "simple" | "spaceDelimited" | "pipeDelimited";
  explode?: boolean;
}

export interface OpenApiSchema {
  type?: string;
  format?: string;
  items?: OpenApiSchema;
}

/**
 * Minimal OpenAPI spec structure
 */
export interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, OpenApiPathItem>;
}

export interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  delete?: OpenApiOperation;
  patch?: OpenApiOperation;
  parameters?: OpenApiParameter[];
}

export interface OpenApiOperation {
  "x-db"?: XDbExtension;
  parameters?: OpenApiParameter[];
  requestBody?: unknown;
  responses?: unknown;
}

/**
 * Result of parsing a query template
 */
export interface ParsedQuery {
  /** SQL with positional placeholders ($1, $2, etc.) */
  sql: string;

  /** Ordered array of values to bind */
  values: unknown[];
}

/**
 * Context available during template interpolation
 */
export interface InterpolationContext {
  path: Record<string, string>;
  query: Record<string, string | string[]>;
  body: unknown;
  auth: Record<string, unknown> | null;
}

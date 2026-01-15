import type { Pool } from "pg";
import type { Request } from "express";

/**
 * Configuration options for the openapi-db middleware
 */
export interface OpenApiDbOptions {
  /** Path to OpenAPI spec file (YAML/JSON), or pre-parsed spec object */
  spec: string | OpenApiSpec;

  /** Postgres connection pool */
  db: Pool;

  /** Optional auth resolver - extracts user context from request */
  auth?: AuthResolver;
}

export type AuthResolver = (
  req: Request
) => Promise<Record<string, unknown> | null>;

/**
 * The x-db extension schema for OpenAPI operations
 */
export interface XDbExtension {
  /** The SQL query template with variable placeholders */
  query: string;

  /** Named connection (reserved for future multi-db support) */
  connection?: string;

  /** Response shaping configuration */
  response?: XDbResponse;
}

export interface XDbResponse {
  /**
   * 'array' (default): Return all rows as array
   * 'first': Return first row (404 if none)
   * 'value': Return first column of first row as scalar
   */
  type?: "array" | "first" | "value";

  /** Field mapping: { apiFieldName: sql_column_name } */
  fields?: Record<string, string>;
}

/**
 * A parsed route with Express-style path and x-db configuration
 */
export interface ParsedRoute {
  /** Express-style path, e.g., /users/:id */
  path: string;

  /** HTTP method (lowercase): get, post, put, delete, patch */
  method: HttpMethod;

  /** The x-db extension configuration */
  xDb: XDbExtension;

  /** OpenAPI parameter definitions for this route */
  parameters: OpenApiParameter[];

  /** Original OpenAPI path for error messages, e.g., /users/{id} */
  originalPath: string;
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

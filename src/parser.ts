import * as fs from "node:fs";
import * as yaml from "yaml";
import type { OpenApiSpec, OpenApiParameter, CompiledRoute, HttpMethod } from "./types.js";
import { compileRoute } from "./matcher.js";

const HTTP_METHODS: HttpMethod[] = ["get", "post", "put", "delete", "patch"];

/**
 * Parse an OpenAPI spec and extract routes with x-db extensions.
 *
 * @param spec - Can be:
 *   - A file path (ending in .yaml, .yml, or .json)
 *   - YAML content string (detected by starting with 'openapi:' or common YAML patterns)
 *   - JSON content string (detected by starting with '{')
 *   - A pre-parsed OpenAPI spec object
 */
export function parseSpec(spec: string | OpenApiSpec): CompiledRoute[] {
  const parsed = typeof spec === "string" ? loadSpec(spec) : spec;
  return extractRoutes(parsed);
}

/**
 * Load an OpenAPI spec from a file path or content string.
 */
function loadSpec(input: string): OpenApiSpec {
  const trimmed = input.trim();

  // Detect if input is content rather than a file path
  if (isYamlContent(trimmed)) {
    return yaml.parse(trimmed) as OpenApiSpec;
  }

  if (isJsonContent(trimmed)) {
    return JSON.parse(trimmed) as OpenApiSpec;
  }

  // Treat as file path
  return loadSpecFromFile(input);
}

/**
 * Check if string looks like YAML content.
 */
function isYamlContent(input: string): boolean {
  // YAML content typically starts with these patterns
  return (
    input.startsWith("openapi:") ||
    input.startsWith("swagger:") ||
    input.startsWith("---") ||
    input.startsWith("%YAML")
  );
}

/**
 * Check if string looks like JSON content.
 */
function isJsonContent(input: string): boolean {
  return input.startsWith("{");
}

/**
 * Load an OpenAPI spec from a file path.
 */
function loadSpecFromFile(filePath: string): OpenApiSpec {
  const content = fs.readFileSync(filePath, "utf-8");
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    return yaml.parse(content) as OpenApiSpec;
  }
  return JSON.parse(content) as OpenApiSpec;
}

/**
 * Extract all routes with x-db extensions from the spec.
 */
function extractRoutes(spec: OpenApiSpec): CompiledRoute[] {
  const routes: CompiledRoute[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const pathParams = pathItem.parameters ?? [];

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation?.["x-db"]) continue;

      const mergedParams = mergeParameters(pathParams, operation.parameters ?? []);
      routes.push(compileRoute(path, method, operation["x-db"], mergedParams));
    }
  }

  return routes;
}

/**
 * Merge path-level and operation-level parameters.
 * Operation parameters override path parameters with the same name and location.
 */
function mergeParameters(
  pathParams: OpenApiParameter[],
  operationParams: OpenApiParameter[]
): OpenApiParameter[] {
  const merged = new Map<string, OpenApiParameter>();

  // Add path-level params first
  for (const param of pathParams) {
    const key = `${param.in}:${param.name}`;
    merged.set(key, param);
  }

  // Override with operation-level params
  for (const param of operationParams) {
    const key = `${param.in}:${param.name}`;
    merged.set(key, param);
  }

  return [...merged.values()];
}

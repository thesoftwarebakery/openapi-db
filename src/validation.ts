import type { ParsedRoute, AuthResolver } from "./types.js";

export interface ValidationOptions {
  auth?: AuthResolver | undefined;
}

/**
 * Validate routes at boot time.
 * - Throw if $auth is used but no auth resolver provided
 * - Throw if $path.x references undefined path parameter
 * - Throw if $query.x references undefined query parameter
 */
export function validateRoutes(
  routes: ParsedRoute[],
  options: ValidationOptions
): void {
  for (const route of routes) {
    const query = route.xDb.query;
    const routeId = `${route.method.toUpperCase()} ${route.originalPath}`;

    // Check auth usage
    if (/\$auth\.\w+/.test(query) && !options.auth) {
      throw new Error(
        `Route ${routeId} references $auth but no auth resolver provided`
      );
    }

    // Extract and validate path params
    const pathParamRefs = query.match(/\$path\.(\w+)/g) ?? [];
    const definedPathParams = new Set(
      route.parameters.filter((p) => p.in === "path").map((p) => p.name)
    );

    for (const ref of pathParamRefs) {
      const paramName = ref.replace("$path.", "");
      if (!definedPathParams.has(paramName)) {
        throw new Error(
          `Route ${routeId} references $path.${paramName} but parameter not defined in spec`
        );
      }
    }

    // Extract and validate query params
    const queryParamRefs = query.match(/\$query\.(\w+)/g) ?? [];
    const definedQueryParams = new Set(
      route.parameters.filter((p) => p.in === "query").map((p) => p.name)
    );

    for (const ref of queryParamRefs) {
      const paramName = ref.replace("$query.", "");
      if (!definedQueryParams.has(paramName)) {
        throw new Error(
          `Route ${routeId} references $query.${paramName} but parameter not defined in spec`
        );
      }
    }
  }
}

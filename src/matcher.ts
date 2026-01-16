import type {
  CompiledRoute,
  RouteMatch,
  XDbExtension,
  OpenApiParameter,
  HttpMethod,
} from "./types.js";

/**
 * Compile an OpenAPI path into a regex pattern for matching.
 * Converts /users/{id}/posts/{postId} to ^/users/([^/]+)/posts/([^/]+)$
 */
export function compileRoute(
  path: string,
  method: HttpMethod,
  xDb: XDbExtension,
  parameters: OpenApiParameter[]
): CompiledRoute {
  const paramNames: string[] = [];

  // Convert {param} to regex capture groups
  const patternStr = path.replace(/\{([^}]+)\}/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });

  // Check if the query uses $auth.* variables
  const usesAuth = /\$auth\.\w+/.test(xDb.query);

  return {
    method,
    pattern: new RegExp(`^${patternStr}$`),
    paramNames,
    xDb,
    parameters,
    usesAuth,
    originalPath: path,
  };
}

/**
 * Match a request against compiled routes.
 * Returns the first matching route with extracted path parameters, or null.
 */
export function matchRoute(
  routes: CompiledRoute[],
  method: string,
  path: string
): RouteMatch | null {
  const normalizedMethod = method.toLowerCase();

  for (const route of routes) {
    if (route.method !== normalizedMethod) continue;

    const match = path.match(route.pattern);
    if (!match) continue;

    // Extract path parameters
    const pathParams: Record<string, string> = {};
    route.paramNames.forEach((name, i) => {
      pathParams[name] = decodeURIComponent(match[i + 1]!);
    });

    return { route, pathParams };
  }

  return null;
}

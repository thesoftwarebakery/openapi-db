import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { randomUUID } from "node:crypto";
import type {
  OpenApiDbOptions,
  ParsedRoute,
  InterpolationContext,
} from "./types.js";
import { parseSpec } from "./parser.js";
import { parseTemplate } from "./template.js";
import { executeQuery } from "./adapters/postgres.js";

/**
 * Create an Express router that handles x-db annotated routes from an OpenAPI spec.
 */
export function openApiDb(options: OpenApiDbOptions): Router {
  const routes = parseSpec(options.spec);

  validateRoutes(routes, options);

  const router = Router();

  for (const route of routes) {
    router[route.method](route.path, createHandler(route, options));
  }

  return router;
}

/**
 * Validate routes at boot time.
 * - Throw if $auth is used but no auth resolver provided
 * - Throw if $path.x references undefined path parameter
 * - Throw if $query.x references undefined query parameter
 */
export function validateRoutes(
  routes: ParsedRoute[],
  options: OpenApiDbOptions
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

/**
 * Create a request handler for a route.
 */
function createHandler(route: ParsedRoute, options: OpenApiDbOptions) {
  return async (
    req: Request,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    const correlationId = randomUUID();

    try {
      // Resolve auth context
      const auth = options.auth ? await options.auth(req) : null;

      // Build interpolation context
      const context: InterpolationContext = {
        path: req.params as Record<string, string>,
        query: req.query as Record<string, string | string[]>,
        body: req.body as unknown,
        auth,
      };

      // Parse template and execute
      const { sql, values } = parseTemplate(route.xDb.query, context);

      const result = await executeQuery(options.db, {
        sql,
        values,
        response: route.xDb.response,
      });

      // Handle 404 for 'first' type with no result
      if (route.xDb.response?.type === "first" && result === null) {
        res.status(404).json({
          error: "Not Found",
          correlationId,
        });
        return;
      }

      res.json(result);
    } catch (error) {
      console.error(`[${correlationId}] Error:`, error);
      res.status(500).json({
        error: "Internal Server Error",
        correlationId,
      });
    }
  };
}

// Re-export types for consumers
export type {
  OpenApiDbOptions,
  XDbExtension,
  XDbResponse,
  ParsedRoute,
  AuthResolver,
} from "./types.js";

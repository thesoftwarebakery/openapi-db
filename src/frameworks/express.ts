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
} from "../types.js";
import { parseSpec } from "../parser.js";
import { parseTemplate } from "../template.js";
import { executeQuery } from "../adapters/postgres.js";
import { validateRoutes } from "../validation.js";

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
 * Create an Express request handler for a route.
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

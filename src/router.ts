import type { IncomingMessage } from "node:http";
import type { Pool } from "pg";
import type {
  RouterOptions,
  Router,
  RouterResponse,
  CompiledRoute,
  InterpolationContext,
  OpenApiParameter,
} from "./types.js";
import { OpenApiDbError } from "./errors.js";
import { parseSpec } from "./parser.js";
import { matchRoute } from "./matcher.js";
import { parseTemplate } from "./template.js";
import { executeQuery } from "./executor.js";
import { shapeResponse } from "./response.js";

/**
 * Create a router from an OpenAPI spec with x-db extensions.
 */
export async function createRouter(options: RouterOptions): Promise<Router> {
  const routes = parseSpec(options.spec);

  // Boot-time validation: check $auth usage vs auth option
  for (const route of routes) {
    if (route.usesAuth && !options.auth) {
      throw new OpenApiDbError(
        "VALIDATION_ERROR",
        `Route ${route.method.toUpperCase()} ${route.originalPath} uses $auth but no auth resolver provided`
      );
    }
  }

  return new RouterImpl(routes, options.db, options.auth);
}

class RouterImpl implements Router {
  constructor(
    private routes: CompiledRoute[],
    private db: Pool,
    private auth?: RouterOptions["auth"]
  ) {}

  async handle(req: IncomingMessage): Promise<RouterResponse | null> {
    const method = req.method?.toLowerCase() ?? "get";
    const path = this.parsePath(req.url ?? "/");

    // Match route
    const match = matchRoute(this.routes, method, path);
    if (!match) return null;

    const { route, pathParams } = match;

    // Resolve auth if needed
    let authContext: Record<string, unknown> | null = null;
    if (route.usesAuth) {
      if (!this.auth) {
        throw new OpenApiDbError(
          "AUTH_RESOLVER_MISSING",
          "Route uses $auth but no auth resolver provided",
          500
        );
      }
      authContext = await this.auth(req);
      if (!authContext) {
        throw new OpenApiDbError("AUTH_REQUIRED", "Authentication required", 401);
      }
    }

    // Parse body and query
    const body = await this.parseBody(req);
    const query = this.parseQuery(req.url ?? "/", route.parameters);

    // Build context
    const context: InterpolationContext = {
      path: pathParams,
      query,
      body,
      auth: authContext,
    };

    // Interpolate SQL and execute
    const { sql, values } = parseTemplate(route.xDb.query, context);
    const rows = await executeQuery(this.db, sql, values);

    // Shape response
    const responseBody = shapeResponse(rows, route.xDb.response);

    // Handle 404 for 'first' type with no result
    if (route.xDb.response?.type === "first" && responseBody === null) {
      throw new OpenApiDbError("NOT_FOUND", "Resource not found", 404);
    }

    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: responseBody,
    };
  }

  /**
   * Extract path from URL (removes query string).
   */
  private parsePath(url: string): string {
    const questionMark = url.indexOf("?");
    return questionMark === -1 ? url : url.slice(0, questionMark);
  }

  /**
   * Parse request body. Uses pre-parsed body if available (Express/Fastify).
   */
  private async parseBody(req: IncomingMessage): Promise<unknown> {
    // Use pre-parsed body if available (Express, Fastify, etc.)
    const reqWithBody = req as IncomingMessage & { body?: unknown };
    if (reqWithBody.body !== undefined) {
      return reqWithBody.body;
    }

    // Parse body from stream
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });
      req.on("end", () => {
        if (!data) {
          resolve(undefined);
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
      req.on("error", reject);
    });
  }

  /**
   * Parse query string. Uses pre-parsed query if available (Express/Fastify).
   * Handles array coercion based on OpenAPI parameter schemas.
   */
  private parseQuery(
    url: string,
    parameters: OpenApiParameter[]
  ): Record<string, string | string[]> {
    // Find array parameters from OpenAPI spec
    const arrayParams = new Set(
      parameters
        .filter((p) => p.in === "query" && p.schema?.type === "array")
        .map((p) => p.name)
    );

    const questionMark = url.indexOf("?");
    if (questionMark === -1) return {};

    const queryString = url.slice(questionMark + 1);
    const params = new URLSearchParams(queryString);
    const result: Record<string, string | string[]> = {};

    for (const [key, value] of params.entries()) {
      if (arrayParams.has(key)) {
        // Coerce to array (comma-separated)
        result[key] = value.split(",");
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}

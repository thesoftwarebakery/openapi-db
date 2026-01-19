import type { IncomingMessage } from "node:http";
import type {
  RouterOptions,
  Router,
  RouterResponse,
  CompiledRoute,
  OpenApiParameter,
} from "./types.js";
import type { Adapter, Context } from "./adapters/types.js";
import { OpenApiDbError } from "./errors.js";
import { parseSpec } from "./parser.js";
import { matchRoute } from "./matcher.js";
import { createHelpers } from "./helpers.js";
import { shapeResponse } from "./response.js";

/**
 * Resolve the adapter name for a route.
 * If adapter is specified, use it. Otherwise:
 * - If exactly one adapter is configured, use that
 * - If multiple adapters are configured, throw an error
 */
function resolveAdapterName(
  explicitAdapter: string | undefined,
  adapters: Record<string, Adapter>,
  route: CompiledRoute
): string {
  if (explicitAdapter) {
    if (!adapters[explicitAdapter]) {
      throw new OpenApiDbError(
        "VALIDATION_ERROR",
        "Route " + route.method.toUpperCase() + " " + route.originalPath + " uses adapter '" + explicitAdapter + "' which is not configured"
      );
    }
    return explicitAdapter;
  }

  const adapterNames = Object.keys(adapters);
  if (adapterNames.length === 0) {
    throw new OpenApiDbError(
      "VALIDATION_ERROR",
      "No adapters configured"
    );
  }

  if (adapterNames.length === 1) {
    return adapterNames[0]!;
  }

  throw new OpenApiDbError(
    "VALIDATION_ERROR",
    "Route " + route.method.toUpperCase() + " " + route.originalPath + " must specify x-db.adapter when multiple adapters are configured"
  );
}

/**
 * Create a router from an OpenAPI spec with x-db extensions.
 */
export async function createRouter(options: RouterOptions): Promise<Router> {
  const routes = parseSpec(options.spec);

  // Boot-time validation
  for (const route of routes) {
    // Check $auth usage vs auth option
    if (route.usesAuth && !options.auth) {
      throw new OpenApiDbError(
        "VALIDATION_ERROR",
        "Route " + route.method.toUpperCase() + " " + route.originalPath + " uses ${{ auth }} but no auth resolver provided"
      );
    }

    // Resolve adapter name
    const adapterName = resolveAdapterName(route.xDb.adapter, options.adapters, route);
    const adapter = options.adapters[adapterName]!;

    // Validate query format for this adapter
    const validation = adapter.validateQuery(route.xDb.query);
    if (!validation.valid) {
      throw new OpenApiDbError(
        "VALIDATION_ERROR",
        `Route ${route.method.toUpperCase()} ${route.originalPath}: ${validation.error}`
      );
    }
  }

  return new RouterImpl(routes, options.adapters, options.auth);
}

class RouterImpl implements Router {
  private helpers = createHelpers();

  constructor(
    private routes: CompiledRoute[],
    private adapters: Record<string, Adapter>,
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
          "Route uses " + "${{ auth }}" + " but no auth resolver provided",
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
    const context: Context = {
      path: pathParams,
      query,
      body,
      auth: authContext,
    };

    // Get adapter and execute
    const adapterName = resolveAdapterName(route.xDb.adapter, this.adapters, route);
    const adapter = this.adapters[adapterName]!;

    // Interpolate and execute
    const interpolated = adapter.interpolate(route.xDb.query, context, this.helpers);
    const rows = await adapter.execute(interpolated);

    // Shape response
    const responseBody = shapeResponse(rows, {
      fields: route.xDb.fields,
      returns: route.xDb.returns,
    });

    // Handle 404 for single-item extraction with no result
    if (route.xDb.returns?.startsWith("/0") && responseBody === null) {
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

/**
 * Context available during query interpolation.
 */
export interface Context {
  path: Record<string, string>;
  query: Record<string, string | string[]>;
  body: unknown;
  auth: Record<string, unknown> | null;
}

/**
 * Helpers provided by core for adapters to use during interpolation.
 */
export interface InterpolationHelpers {
  /**
   * Resolve a variable reference to its value.
   * e.g. 'path.id', 'query.status', 'body.user.name', 'auth.tenantId'
   * (Note: receives inner content of ${{ }}, not the delimiters)
   */
  resolveVariable(ref: string, context: Context): unknown;

  /**
   * Evaluate a function expression.
   * e.g. 'default(query.status, "active")', 'now()', 'uuid()'
   * (Note: receives inner content of ${{ }}, not the delimiters)
   */
  evaluateFunction(expr: string, context: Context): unknown;

  /**
   * Parse a template string, return all ${{ }} references found.
   * Returns the full match including delimiters and positions.
   */
  parseTemplate(
    template: string
  ): Array<{ match: string; inner: string; start: number; end: number }>;
}

/**
 * Database adapter interface.
 * Each adapter handles validation, interpolation, and execution for its database type.
 */
export interface Adapter {
  /**
   * Validate the query shape for this adapter.
   * Called at boot time for each route using this adapter.
   * SQL adapters expect string, MongoDB expects object, etc.
   */
  validateQuery(query: unknown): { valid: true } | { valid: false; error: string };

  /**
   * Interpolate variables and functions in the query.
   * The adapter owns its interpolation strategy, using helpers from core.
   * Returns adapter-specific format ready for execute().
   */
  interpolate(
    query: unknown,
    context: Context,
    helpers: InterpolationHelpers
  ): unknown;

  /**
   * Execute the interpolated query.
   * Receives output from interpolate().
   */
  execute(interpolatedQuery: unknown): Promise<Record<string, unknown>[]>;
}

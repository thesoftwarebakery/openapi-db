import { randomUUID } from "node:crypto";
import type { Context, InterpolationHelpers } from "./adapters/types.js";
import { OpenApiDbError } from "./errors.js";

const OPEN_DELIM = "${{";
const CLOSE_DELIM = "}}";

/**
 * Create InterpolationHelpers instance for adapters to use.
 */
export function createHelpers(): InterpolationHelpers {
  return {
    resolveVariable,
    evaluateFunction,
    parseTemplate,
  };
}

/**
 * Resolve a variable reference like 'path.id' or 'body.user.name'.
 * The ref is the inner content of ${{ }}, NOT including delimiters.
 */
function resolveVariable(ref: string, context: Context): unknown {
  const parts = ref.trim().split(".");
  const source = parts[0];
  const path = parts.slice(1);

  let value: unknown;
  switch (source) {
    case "path":
      value = context.path;
      break;
    case "query":
      value = context.query;
      break;
    case "body":
      value = context.body;
      break;
    case "auth":
      value = context.auth;
      break;
    default:
      return undefined;
  }

  // Navigate the path
  for (const segment of path) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }

  // Handle comma-separated query params as arrays
  if (source === "query" && typeof value === "string" && value.includes(",")) {
    return value.split(",");
  }

  return value;
}

/**
 * Evaluate a function expression like 'default(query.status, "active")'.
 * The expr is the inner content of ${{ }}, NOT including delimiters.
 */
function evaluateFunction(expr: string, context: Context): unknown {
  const trimmed = expr.trim();

  // Parse function name and arguments
  const parenPos = trimmed.indexOf("(");
  if (parenPos === -1 || !trimmed.endsWith(")")) {
    throw new OpenApiDbError(
      "UNKNOWN_FUNCTION",
      `Invalid function expression: ${expr}`
    );
  }

  const name = trimmed.slice(0, parenPos).trim();
  const argsStr = trimmed.slice(parenPos + 1, -1);
  const args = parseArgs(argsStr, context);

  switch (name) {
    case "default":
      return args[0] ?? args[1];

    case "now":
      return new Date();

    case "uuid":
      return randomUUID();

    default:
      throw new OpenApiDbError("UNKNOWN_FUNCTION", `Unknown function: ${name}()`);
  }
}

/**
 * Parse function arguments, evaluating nested references.
 */
function parseArgs(argsStr: string, context: Context): unknown[] {
  const args: unknown[] = [];
  if (!argsStr.trim()) return args;

  let pos = 0;
  let argStart = 0;
  let depth = 0;
  let inString = false;

  while (pos <= argsStr.length) {
    const char = argsStr[pos];

    if (inString) {
      if (char === "'" && argsStr[pos - 1] !== "\\") {
        inString = false;
      }
      pos++;
      continue;
    }

    if (char === "'") {
      inString = true;
      pos++;
      continue;
    }

    if (char === "(") {
      depth++;
      pos++;
      continue;
    }

    if (char === ")") {
      depth--;
      pos++;
      continue;
    }

    if ((char === "," && depth === 0) || pos === argsStr.length) {
      const argText = argsStr.slice(argStart, pos).trim();
      if (argText) {
        args.push(evaluateArg(argText, context));
      }
      argStart = pos + 1;
    }

    pos++;
  }

  return args;
}

/**
 * Evaluate a single argument (literal, variable, or nested function).
 */
function evaluateArg(arg: string, context: Context): unknown {
  const trimmed = arg.trim();

  // String literal
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/\\'/g, "'");
  }

  // Number literal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return parseFloat(trimmed);
  }

  // null literal
  if (trimmed === "null") {
    return null;
  }

  // Check if it's a function call
  if (trimmed.includes("(") && trimmed.endsWith(")")) {
    return evaluateFunction(trimmed, context);
  }

  // Otherwise it's a variable reference
  return resolveVariable(trimmed, context);
}

/**
 * Parse a template string and return all ${{ }} references with positions.
 */
function parseTemplate(
  template: string
): Array<{ match: string; inner: string; start: number; end: number }> {
  const results: Array<{
    match: string;
    inner: string;
    start: number;
    end: number;
  }> = [];
  let pos = 0;

  while (pos < template.length) {
    const openPos = template.indexOf(OPEN_DELIM, pos);
    if (openPos === -1) break;

    const closePos = findClosingDelimiter(template, openPos + OPEN_DELIM.length);
    if (closePos === -1) break;

    const endPos = closePos + CLOSE_DELIM.length;
    const match = template.slice(openPos, endPos);
    const inner = template.slice(openPos + OPEN_DELIM.length, closePos).trim();

    results.push({
      match,
      inner,
      start: openPos,
      end: endPos,
    });

    pos = endPos;
  }

  return results;
}

/**
 * Find the closing }} delimiter, handling nested braces in string literals.
 */
function findClosingDelimiter(template: string, start: number): number {
  let pos = start;
  let depth = 1;

  while (pos < template.length && depth > 0) {
    if (template.slice(pos, pos + 2) === "}}") {
      depth--;
      if (depth === 0) return pos;
      pos += 2;
    } else if (template.slice(pos, pos + 2) === "{{") {
      depth++;
      pos += 2;
    } else if (template[pos] === "'") {
      // Skip string literal
      pos++;
      while (pos < template.length && template[pos] !== "'") {
        if (template[pos] === "\\" && pos + 1 < template.length) {
          pos += 2;
        } else {
          pos++;
        }
      }
      pos++; // Skip closing quote
    } else {
      pos++;
    }
  }

  return -1;
}

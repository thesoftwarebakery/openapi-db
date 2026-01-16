import { randomUUID } from "node:crypto";
import type { InterpolationContext, ParsedQuery } from "./types.js";
import { OpenApiDbError } from "./errors.js";

type VariableSource = "path" | "query" | "body" | "auth";

type Token =
  | { type: "TEXT"; value: string }
  | { type: "VARIABLE"; source: VariableSource; path: string[] }
  | { type: "FUNCTION"; name: string; args: Token[][] }
  | { type: "LITERAL"; value: string | number | null };

const OPEN_DELIM = "${{";
const CLOSE_DELIM = "}}";

/**
 * Parse a SQL template with variable placeholders and functions,
 * returning a parameterized query safe from SQL injection.
 */
export function parseTemplate(
  template: string,
  context: InterpolationContext
): ParsedQuery {
  const tokens = tokenize(template);
  const values: unknown[] = [];

  const sqlParts: string[] = [];
  for (const token of tokens) {
    if (token.type === "TEXT") {
      sqlParts.push(token.value);
    } else {
      const value = evaluateToken(token, context);
      values.push(value);
      sqlParts.push(`$${values.length}`);
    }
  }

  return {
    sql: sqlParts.join(""),
    values,
  };
}

/**
 * Tokenize a template string into TEXT, VARIABLE, FUNCTION, and LITERAL tokens.
 * Expressions use ${{ }} delimiters: ${{ path.id }}, ${{ default(query.status, 'active') }}
 */
export function tokenize(template: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < template.length) {
    const openPos = template.indexOf(OPEN_DELIM, pos);

    if (openPos === -1) {
      // No more expressions - rest is text
      if (pos < template.length) {
        tokens.push({ type: "TEXT", value: template.slice(pos) });
      }
      break;
    }

    // Add text before ${{
    if (openPos > pos) {
      tokens.push({ type: "TEXT", value: template.slice(pos, openPos) });
    }

    // Find closing }}
    const closePos = findClosingDelimiter(template, openPos + OPEN_DELIM.length);
    if (closePos === -1) {
      // No closing delimiter - treat rest as text
      tokens.push({ type: "TEXT", value: template.slice(openPos) });
      break;
    }

    // Extract expression inside ${{ }}
    const expr = template.slice(openPos + OPEN_DELIM.length, closePos).trim();
    const token = parseExpression(expr);
    tokens.push(token);

    pos = closePos + CLOSE_DELIM.length;
  }

  return tokens;
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

/**
 * Parse an expression inside ${{ }}.
 * Can be a variable (path.id) or function (default(query.status, 'active'))
 */
function parseExpression(expr: string): Token {
  const trimmed = expr.trim();

  // Check if it's a function call: name(...)
  const parenPos = trimmed.indexOf("(");
  if (parenPos !== -1 && trimmed.endsWith(")")) {
    const name = trimmed.slice(0, parenPos).trim();
    const argsStr = trimmed.slice(parenPos + 1, -1);
    const args = parseArguments(argsStr);
    return { type: "FUNCTION", name, args };
  }

  // Otherwise it's a variable: source.path or just source
  return parseVariable(trimmed);
}

/**
 * Parse a variable expression like "path.id" or "body.user.name" or "body"
 */
function parseVariable(expr: string): Token {
  const sources: VariableSource[] = ["path", "query", "body", "auth"];
  const parts = expr.split(".");
  const source = parts[0] as VariableSource;

  if (!sources.includes(source)) {
    // Unknown source - return as text (will cause issues at runtime)
    return { type: "TEXT", value: expr };
  }

  const path = parts.slice(1);

  // body without path is valid (entire body)
  if (source !== "body" && path.length === 0) {
    return { type: "TEXT", value: expr };
  }

  return { type: "VARIABLE", source, path };
}

/**
 * Parse function arguments, handling nested expressions and string literals.
 */
function parseArguments(argsStr: string): Token[][] {
  const args: Token[][] = [];
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
        args.push(tokenizeArgument(argText));
      }
      argStart = pos + 1;
    }

    pos++;
  }

  return args;
}

/**
 * Tokenize a single function argument.
 */
function tokenizeArgument(arg: string): Token[] {
  const trimmed = arg.trim();

  // String literal
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    const value = trimmed.slice(1, -1).replace(/\\'/g, "'");
    return [{ type: "LITERAL", value }];
  }

  // Number literal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return [{ type: "LITERAL", value: parseFloat(trimmed) }];
  }

  // null literal
  if (trimmed === "null") {
    return [{ type: "LITERAL", value: null }];
  }

  // Variable or nested function - parse as expression
  const token = parseExpression(trimmed);
  return [token];
}

/**
 * Evaluate a token to its runtime value.
 */
export function evaluateToken(
  token: Token,
  context: InterpolationContext
): unknown {
  switch (token.type) {
    case "TEXT":
      return token.value;

    case "LITERAL":
      return token.value;

    case "VARIABLE":
      return evaluateVariable(token.source, token.path, context);

    case "FUNCTION":
      return evaluateFunction(token.name, token.args, context);
  }
}

/**
 * Evaluate a variable reference.
 */
function evaluateVariable(
  source: VariableSource,
  path: string[],
  context: InterpolationContext
): unknown {
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
 * Evaluate a function call.
 */
function evaluateFunction(
  name: string,
  args: Token[][],
  context: InterpolationContext
): unknown {
  // Evaluate all arguments
  const evaluatedArgs = args.map((argTokens) => {
    if (argTokens.length === 0) return undefined;
    if (argTokens.length === 1) return evaluateToken(argTokens[0]!, context);
    // Multiple tokens in arg - shouldn't happen in well-formed input
    return argTokens.map((t) => evaluateToken(t, context)).join("");
  });

  switch (name) {
    case "default":
      return evaluatedArgs[0] ?? evaluatedArgs[1];

    case "now":
      return new Date();

    case "uuid":
      return randomUUID();

    default:
      throw new OpenApiDbError("UNKNOWN_FUNCTION", `Unknown function: ${name}()`);
  }
}

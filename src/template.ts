import { randomUUID } from "node:crypto";
import type { InterpolationContext, ParsedQuery } from "./types.js";
import { OpenApiDbError } from "./errors.js";

type VariableSource = "path" | "query" | "body" | "auth";

type Token =
  | { type: "TEXT"; value: string }
  | { type: "VARIABLE"; source: VariableSource; path: string[] }
  | { type: "FUNCTION"; name: string; args: Token[][] }
  | { type: "LITERAL"; value: string | number | null };

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
 */
export function tokenize(template: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < template.length) {
    const dollarPos = template.indexOf("$", pos);

    if (dollarPos === -1) {
      // No more $ - rest is text
      tokens.push({ type: "TEXT", value: template.slice(pos) });
      break;
    }

    // Add text before $
    if (dollarPos > pos) {
      tokens.push({ type: "TEXT", value: template.slice(pos, dollarPos) });
    }

    // Parse what comes after $
    const result = parseExpression(template, dollarPos);
    tokens.push(result.token);
    pos = result.end;
  }

  return tokens;
}

/**
 * Parse an expression starting at $ (variable or function).
 */
function parseExpression(
  template: string,
  start: number
): { token: Token; end: number } {
  // Check if it's a function ($.name) or variable ($source.path)
  const afterDollar = template.slice(start + 1);

  if (afterDollar.startsWith(".")) {
    // Function: $.name(args)
    return parseFunction(template, start);
  }

  // Variable: $source.path
  return parseVariable(template, start);
}

/**
 * Parse a variable like $path.id or $body.user.name
 */
function parseVariable(
  template: string,
  start: number
): { token: Token; end: number } {
  const sources: VariableSource[] = ["path", "query", "body", "auth"];
  const afterDollar = template.slice(start + 1);

  for (const source of sources) {
    if (afterDollar.startsWith(source)) {
      const sourceEnd = start + 1 + source.length;

      // Check for dot after source
      if (template[sourceEnd] === ".") {
        // Parse the path segments
        const pathResult = parsePath(template, sourceEnd + 1);
        return {
          token: {
            type: "VARIABLE",
            source,
            path: pathResult.segments,
          },
          end: pathResult.end,
        };
      }

      // Just $body with no path (entire body)
      if (source === "body") {
        return {
          token: { type: "VARIABLE", source: "body", path: [] },
          end: sourceEnd,
        };
      }
    }
  }

  // Unknown $ expression - treat as text
  return {
    token: { type: "TEXT", value: "$" },
    end: start + 1,
  };
}

/**
 * Parse dot-separated path segments like "user.name.first"
 */
function parsePath(
  template: string,
  start: number
): { segments: string[]; end: number } {
  const segments: string[] = [];
  let pos = start;

  while (pos < template.length) {
    const segment = parseIdentifier(template, pos);
    if (!segment.value) break;

    segments.push(segment.value);
    pos = segment.end;

    // Check for more segments
    if (template[pos] === ".") {
      pos++;
    } else {
      break;
    }
  }

  return { segments, end: pos };
}

/**
 * Parse an identifier (alphanumeric + underscore)
 */
function parseIdentifier(
  template: string,
  start: number
): { value: string; end: number } {
  let end = start;
  while (end < template.length && /[\w]/.test(template[end]!)) {
    end++;
  }
  return { value: template.slice(start, end), end };
}

/**
 * Parse a function like $.default(arg1, arg2) or $.now()
 */
function parseFunction(
  template: string,
  start: number
): { token: Token; end: number } {
  // Skip "$."
  let pos = start + 2;

  // Parse function name
  const nameResult = parseIdentifier(template, pos);
  const name = nameResult.value;
  pos = nameResult.end;

  // Expect opening parenthesis
  if (template[pos] !== "(") {
    return {
      token: { type: "TEXT", value: template.slice(start, pos) },
      end: pos,
    };
  }
  pos++; // Skip "("

  // Parse arguments
  const args: Token[][] = [];
  let currentArg: Token[] = [];

  let depth = 1;
  let argStart = pos;

  while (pos < template.length && depth > 0) {
    const char = template[pos];

    if (char === "(") {
      depth++;
      pos++;
    } else if (char === ")") {
      depth--;
      if (depth === 0) {
        // End of function - finalize current argument
        if (pos > argStart || currentArg.length > 0) {
          const argText = template.slice(argStart, pos).trim();
          if (argText || currentArg.length > 0) {
            if (currentArg.length === 0 && argText) {
              currentArg = tokenizeArgument(argText);
            }
            args.push(currentArg);
          }
        }
        pos++; // Skip ")"
      } else {
        pos++;
      }
    } else if (char === "," && depth === 1) {
      // Argument separator at top level
      const argText = template.slice(argStart, pos).trim();
      if (argText) {
        currentArg = tokenizeArgument(argText);
      }
      args.push(currentArg);
      currentArg = [];
      pos++;
      argStart = pos;
    } else if (char === "'") {
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

  return {
    token: { type: "FUNCTION", name, args },
    end: pos,
  };
}

/**
 * Tokenize a single function argument
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

  // Variable or function - parse recursively
  if (trimmed.startsWith("$")) {
    return tokenize(trimmed);
  }

  // Unknown - treat as text
  return [{ type: "TEXT", value: trimmed }];
}

/**
 * Evaluate a token to its runtime value
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
 * Evaluate a variable reference
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
 * Evaluate a function call
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
      throw new OpenApiDbError("UNKNOWN_FUNCTION", `Unknown function: $.${name}`);
  }
}

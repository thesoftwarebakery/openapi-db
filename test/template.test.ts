import { describe, it, expect } from "vitest";
import { parseTemplate, tokenize, evaluateToken } from "../src/template.js";
import type { InterpolationContext } from "../src/types.js";

const emptyContext: InterpolationContext = {
  path: {},
  query: {},
  body: null,
  auth: null,
};

describe("tokenize", () => {
  it("returns text token for plain SQL", () => {
    const tokens = tokenize("SELECT * FROM users");
    expect(tokens).toEqual([{ type: "TEXT", value: "SELECT * FROM users" }]);
  });

  it("parses $path variable", () => {
    const tokens = tokenize("WHERE id = $path.id");
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toEqual({ type: "TEXT", value: "WHERE id = " });
    expect(tokens[1]).toEqual({ type: "VARIABLE", source: "path", path: ["id"] });
  });

  it("parses $query variable", () => {
    const tokens = tokenize("$query.status");
    expect(tokens).toEqual([{ type: "VARIABLE", source: "query", path: ["status"] }]);
  });

  it("parses $auth variable", () => {
    const tokens = tokenize("$auth.tenantId");
    expect(tokens).toEqual([{ type: "VARIABLE", source: "auth", path: ["tenantId"] }]);
  });

  it("parses nested $body path", () => {
    const tokens = tokenize("$body.user.profile.name");
    expect(tokens).toEqual([
      { type: "VARIABLE", source: "body", path: ["user", "profile", "name"] },
    ]);
  });

  it("parses $body without path", () => {
    const tokens = tokenize("VALUES ($body)");
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toEqual({ type: "TEXT", value: "VALUES (" });
    expect(tokens[1]).toEqual({ type: "VARIABLE", source: "body", path: [] });
    expect(tokens[2]).toEqual({ type: "TEXT", value: ")" });
  });

  it("parses $.now() function", () => {
    const tokens = tokenize("$.now()");
    expect(tokens).toEqual([{ type: "FUNCTION", name: "now", args: [] }]);
  });

  it("parses $.uuid() function", () => {
    const tokens = tokenize("$.uuid()");
    expect(tokens).toEqual([{ type: "FUNCTION", name: "uuid", args: [] }]);
  });

  it("parses $.default with string literal", () => {
    const tokens = tokenize("$.default($query.status, 'active')");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ type: "FUNCTION", name: "default" });
    const fn = tokens[0] as { type: "FUNCTION"; name: string; args: unknown[][] };
    expect(fn.args).toHaveLength(2);
  });

  it("parses multiple variables in one template", () => {
    const tokens = tokenize("WHERE a = $path.a AND b = $query.b");
    expect(tokens).toHaveLength(4);
    expect(tokens[0]).toEqual({ type: "TEXT", value: "WHERE a = " });
    expect(tokens[1]).toEqual({ type: "VARIABLE", source: "path", path: ["a"] });
    expect(tokens[2]).toEqual({ type: "TEXT", value: " AND b = " });
    expect(tokens[3]).toEqual({ type: "VARIABLE", source: "query", path: ["b"] });
  });
});

describe("evaluateToken", () => {
  it("evaluates path variable", () => {
    const token = { type: "VARIABLE" as const, source: "path" as const, path: ["id"] };
    const context: InterpolationContext = {
      ...emptyContext,
      path: { id: "123" },
    };
    expect(evaluateToken(token, context)).toBe("123");
  });

  it("evaluates nested body path", () => {
    const token = { type: "VARIABLE" as const, source: "body" as const, path: ["user", "name"] };
    const context: InterpolationContext = {
      ...emptyContext,
      body: { user: { name: "Alice" } },
    };
    expect(evaluateToken(token, context)).toBe("Alice");
  });

  it("returns undefined for missing nested path", () => {
    const token = { type: "VARIABLE" as const, source: "body" as const, path: ["user", "missing"] };
    const context: InterpolationContext = {
      ...emptyContext,
      body: { user: {} },
    };
    expect(evaluateToken(token, context)).toBeUndefined();
  });

  it("evaluates literal token", () => {
    const token = { type: "LITERAL" as const, value: "hello" };
    expect(evaluateToken(token, emptyContext)).toBe("hello");
  });

  it("splits comma-separated query param into array", () => {
    const token = { type: "VARIABLE" as const, source: "query" as const, path: ["ids"] };
    const context: InterpolationContext = {
      ...emptyContext,
      query: { ids: "1,2,3" },
    };
    expect(evaluateToken(token, context)).toEqual(["1", "2", "3"]);
  });
});

describe("parseTemplate", () => {
  it("handles plain SQL with no variables", () => {
    const result = parseTemplate("SELECT 1", emptyContext);
    expect(result.sql).toBe("SELECT 1");
    expect(result.values).toEqual([]);
  });

  it("interpolates path parameter", () => {
    const context: InterpolationContext = {
      ...emptyContext,
      path: { id: "123" },
    };
    const result = parseTemplate("SELECT * FROM users WHERE id = $path.id", context);
    expect(result.sql).toBe("SELECT * FROM users WHERE id = $1");
    expect(result.values).toEqual(["123"]);
  });

  it("interpolates multiple parameters with correct order", () => {
    const context: InterpolationContext = {
      ...emptyContext,
      path: { a: "1" },
      query: { b: "2" },
    };
    const result = parseTemplate("WHERE a = $path.a AND b = $query.b", context);
    expect(result.sql).toBe("WHERE a = $1 AND b = $2");
    expect(result.values).toEqual(["1", "2"]);
  });

  it("interpolates nested body field", () => {
    const context: InterpolationContext = {
      ...emptyContext,
      body: { user: { name: "Alice" } },
    };
    const result = parseTemplate("INSERT INTO t (name) VALUES ($body.user.name)", context);
    expect(result.sql).toBe("INSERT INTO t (name) VALUES ($1)");
    expect(result.values).toEqual(["Alice"]);
  });

  it("evaluates $.default with present value", () => {
    const context: InterpolationContext = {
      ...emptyContext,
      query: { status: "pending" },
    };
    const result = parseTemplate("WHERE status = $.default($query.status, 'active')", context);
    expect(result.sql).toBe("WHERE status = $1");
    expect(result.values).toEqual(["pending"]);
  });

  it("evaluates $.default with missing value uses fallback", () => {
    const result = parseTemplate("WHERE status = $.default($query.status, 'active')", emptyContext);
    expect(result.sql).toBe("WHERE status = $1");
    expect(result.values).toEqual(["active"]);
  });

  it("evaluates $.now() to a Date", () => {
    const before = new Date();
    const result = parseTemplate("INSERT INTO t (created) VALUES ($.now())", emptyContext);
    const after = new Date();

    expect(result.sql).toBe("INSERT INTO t (created) VALUES ($1)");
    expect(result.values).toHaveLength(1);
    expect(result.values[0]).toBeInstanceOf(Date);

    const date = result.values[0] as Date;
    expect(date.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(date.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("evaluates $.uuid() to valid UUID", () => {
    const result = parseTemplate("INSERT INTO t (id) VALUES ($.uuid())", emptyContext);
    expect(result.sql).toBe("INSERT INTO t (id) VALUES ($1)");
    expect(result.values).toHaveLength(1);
    expect(result.values[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("handles complex template with multiple functions and variables", () => {
    const context: InterpolationContext = {
      ...emptyContext,
      body: { firstName: "Alice", lastName: "Smith" },
      auth: { tenantId: "t123" },
    };
    const template = `
      INSERT INTO users (id, first_name, last_name, tenant_id, created_at)
      VALUES ($.uuid(), $body.firstName, $body.lastName, $auth.tenantId, $.now())
    `;
    const result = parseTemplate(template, context);

    expect(result.sql).toContain("VALUES ($1, $2, $3, $4, $5)");
    expect(result.values).toHaveLength(5);
    expect(result.values[0]).toMatch(/^[0-9a-f-]{36}$/i); // UUID
    expect(result.values[1]).toBe("Alice");
    expect(result.values[2]).toBe("Smith");
    expect(result.values[3]).toBe("t123");
    expect(result.values[4]).toBeInstanceOf(Date);
  });

  it("handles array query parameter", () => {
    const context: InterpolationContext = {
      ...emptyContext,
      query: { ids: "1,2,3" },
    };
    const result = parseTemplate("WHERE id = ANY($query.ids)", context);
    expect(result.sql).toBe("WHERE id = ANY($1)");
    expect(result.values).toEqual([["1", "2", "3"]]);
  });
});

import { describe, it, expect } from "vitest";
import { createHelpers } from "../src/helpers.js";
import type { Context } from "../src/adapters/types.js";

const helpers = createHelpers();

const emptyContext: Context = {
  path: {},
  query: {},
  body: null,
  auth: null,
};

describe("resolveVariable", () => {
  it("resolves path variable", () => {
    const context: Context = {
      ...emptyContext,
      path: { id: "123" },
    };
    expect(helpers.resolveVariable("path.id", context)).toBe("123");
  });

  it("resolves query variable", () => {
    const context: Context = {
      ...emptyContext,
      query: { status: "active" },
    };
    expect(helpers.resolveVariable("query.status", context)).toBe("active");
  });

  it("resolves auth variable", () => {
    const context: Context = {
      ...emptyContext,
      auth: { tenantId: "tenant-1" },
    };
    expect(helpers.resolveVariable("auth.tenantId", context)).toBe("tenant-1");
  });

  it("resolves nested body path", () => {
    const context: Context = {
      ...emptyContext,
      body: { user: { name: "Alice" } },
    };
    expect(helpers.resolveVariable("body.user.name", context)).toBe("Alice");
  });

  it("returns undefined for missing path", () => {
    const context: Context = {
      ...emptyContext,
      body: { user: {} },
    };
    expect(helpers.resolveVariable("body.user.missing", context)).toBeUndefined();
  });

  it("splits comma-separated query params into array", () => {
    const context: Context = {
      ...emptyContext,
      query: { ids: "1,2,3" },
    };
    expect(helpers.resolveVariable("query.ids", context)).toEqual(["1", "2", "3"]);
  });

  it("returns undefined for unknown source", () => {
    expect(helpers.resolveVariable("unknown.field", emptyContext)).toBeUndefined();
  });
});

describe("evaluateFunction", () => {
  it("evaluates default with present value", () => {
    const context: Context = {
      ...emptyContext,
      query: { status: "pending" },
    };
    const result = helpers.evaluateFunction("default(query.status, 'active')", context);
    expect(result).toBe("pending");
  });

  it("evaluates default with missing value uses fallback", () => {
    const result = helpers.evaluateFunction("default(query.status, 'active')", emptyContext);
    expect(result).toBe("active");
  });

  it("evaluates default with number fallback", () => {
    const result = helpers.evaluateFunction("default(query.limit, 20)", emptyContext);
    expect(result).toBe(20);
  });

  it("evaluates now() to a Date", () => {
    const before = new Date();
    const result = helpers.evaluateFunction("now()", emptyContext);
    const after = new Date();

    expect(result).toBeInstanceOf(Date);
    const date = result as Date;
    expect(date.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(date.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("evaluates uuid() to valid UUID", () => {
    const result = helpers.evaluateFunction("uuid()", emptyContext);
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("throws on unknown function", () => {
    expect(() => helpers.evaluateFunction("unknown()", emptyContext)).toThrow(
      "Unknown function: unknown()"
    );
  });

  it("throws on invalid function expression", () => {
    expect(() => helpers.evaluateFunction("notafunction", emptyContext)).toThrow(
      "Invalid function expression"
    );
  });
});

describe("parseTemplate", () => {
  it("returns empty array for plain text", () => {
    const result = helpers.parseTemplate("SELECT * FROM users");
    expect(result).toEqual([]);
  });

  it("finds single variable reference", () => {
    const result = helpers.parseTemplate("WHERE id = ${{ path.id }}");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      match: "${{ path.id }}",
      inner: "path.id",
      start: 11,
      end: 25,
    });
  });

  it("finds multiple references", () => {
    const result = helpers.parseTemplate(
      "WHERE a = ${{ path.a }} AND b = ${{ query.b }}"
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.inner).toBe("path.a");
    expect(result[1]!.inner).toBe("query.b");
  });

  it("finds function call", () => {
    const result = helpers.parseTemplate("${{ default(query.status, 'active') }}");
    expect(result).toHaveLength(1);
    expect(result[0]!.inner).toBe("default(query.status, 'active')");
  });

  it("handles whitespace inside delimiters", () => {
    const result = helpers.parseTemplate("${{  path.id  }}");
    expect(result).toHaveLength(1);
    expect(result[0]!.inner).toBe("path.id");
  });

  it("handles no whitespace inside delimiters", () => {
    const result = helpers.parseTemplate("${{path.id}}");
    expect(result).toHaveLength(1);
    expect(result[0]!.inner).toBe("path.id");
  });

  it("returns correct positions for replacement", () => {
    const template = "SELECT * FROM users WHERE id = ${{ path.id }}";
    const result = helpers.parseTemplate(template);

    expect(result).toHaveLength(1);
    const ref = result[0]!;

    // Verify positions are correct
    expect(template.slice(ref.start, ref.end)).toBe("${{ path.id }}");
  });

  it("handles complex template with multiple functions and variables", () => {
    const template =
      "INSERT INTO users (id, name, tenant_id, created_at) " +
      "VALUES (${{ uuid() }}, ${{ body.name }}, ${{ auth.tenantId }}, ${{ now() }})";
    const result = helpers.parseTemplate(template);

    expect(result).toHaveLength(4);
    expect(result[0]!.inner).toBe("uuid()");
    expect(result[1]!.inner).toBe("body.name");
    expect(result[2]!.inner).toBe("auth.tenantId");
    expect(result[3]!.inner).toBe("now()");
  });
});

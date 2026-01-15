import { describe, it, expect } from "vitest";
import { shapeResponse, applyFieldMapping } from "../src/adapters/postgres.js";
import type { QueryResult } from "pg";

function makeResult(rows: Record<string, unknown>[]): QueryResult {
  return {
    rows,
    rowCount: rows.length,
    command: "SELECT",
    oid: 0,
    fields: [],
  };
}

describe("applyFieldMapping", () => {
  it("returns rows unchanged when no mapping provided", () => {
    const rows = [{ id: 1, name: "Alice" }];
    expect(applyFieldMapping(rows)).toEqual(rows);
  });

  it("returns rows unchanged when mapping is undefined", () => {
    const rows = [{ id: 1, name: "Alice" }];
    expect(applyFieldMapping(rows, undefined)).toEqual(rows);
  });

  it("maps SQL column names to API field names", () => {
    const rows = [{ id: 1, first_name: "Alice", last_name: "Smith" }];
    const fields = { firstName: "first_name", lastName: "last_name" };

    const result = applyFieldMapping(rows, fields);

    expect(result).toEqual([{ id: 1, firstName: "Alice", lastName: "Smith" }]);
  });

  it("preserves unmapped fields", () => {
    const rows = [{ id: 1, first_name: "Alice", status: "active" }];
    const fields = { firstName: "first_name" };

    const result = applyFieldMapping(rows, fields);

    expect(result).toEqual([{ id: 1, firstName: "Alice", status: "active" }]);
  });

  it("handles empty rows array", () => {
    expect(applyFieldMapping([], { firstName: "first_name" })).toEqual([]);
  });

  it("handles multiple rows", () => {
    const rows = [
      { first_name: "Alice" },
      { first_name: "Bob" },
    ];
    const fields = { firstName: "first_name" };

    const result = applyFieldMapping(rows, fields);

    expect(result).toEqual([{ firstName: "Alice" }, { firstName: "Bob" }]);
  });
});

describe("shapeResponse", () => {
  describe("type: array (default)", () => {
    it("returns all rows as array", () => {
      const result = makeResult([{ id: 1 }, { id: 2 }]);
      expect(shapeResponse(result)).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("returns empty array when no rows", () => {
      const result = makeResult([]);
      expect(shapeResponse(result)).toEqual([]);
    });

    it("is the default when no response config", () => {
      const result = makeResult([{ id: 1 }]);
      expect(shapeResponse(result)).toEqual([{ id: 1 }]);
    });
  });

  describe("type: first", () => {
    it("returns first row", () => {
      const result = makeResult([{ id: 1 }, { id: 2 }]);
      expect(shapeResponse(result, { type: "first" })).toEqual({ id: 1 });
    });

    it("returns null when no rows", () => {
      const result = makeResult([]);
      expect(shapeResponse(result, { type: "first" })).toBeNull();
    });
  });

  describe("type: value", () => {
    it("returns first column of first row", () => {
      const result = makeResult([{ count: 42 }]);
      expect(shapeResponse(result, { type: "value" })).toBe(42);
    });

    it("returns null when no rows", () => {
      const result = makeResult([]);
      expect(shapeResponse(result, { type: "value" })).toBeNull();
    });

    it("returns first column when multiple columns", () => {
      // Object key order is guaranteed in modern JS for string keys
      const result = makeResult([{ a: 1, b: 2, c: 3 }]);
      expect(shapeResponse(result, { type: "value" })).toBe(1);
    });
  });

  describe("with field mapping", () => {
    it("applies field mapping before shaping", () => {
      const result = makeResult([{ first_name: "Alice" }]);
      const response = { type: "first" as const, fields: { firstName: "first_name" } };

      expect(shapeResponse(result, response)).toEqual({ firstName: "Alice" });
    });

    it("applies mapping to all rows for array type", () => {
      const result = makeResult([{ first_name: "Alice" }, { first_name: "Bob" }]);
      const response = { type: "array" as const, fields: { firstName: "first_name" } };

      expect(shapeResponse(result, response)).toEqual([
        { firstName: "Alice" },
        { firstName: "Bob" },
      ]);
    });
  });
});

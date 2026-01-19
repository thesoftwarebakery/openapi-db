import { describe, it, expect } from "vitest";
import { shapeResponse, applyFieldMapping } from "../src/response.js";

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
  describe("no config (default - full array)", () => {
    it("returns all rows as array", () => {
      const rows = [{ id: 1 }, { id: 2 }];
      expect(shapeResponse(rows)).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("returns empty array when no rows", () => {
      expect(shapeResponse([])).toEqual([]);
    });

    it("returns rows unchanged when config is undefined", () => {
      const rows = [{ id: 1 }];
      expect(shapeResponse(rows, undefined)).toEqual([{ id: 1 }]);
    });
  });

  describe("returns: /0 (first row)", () => {
    it("returns first row as object", () => {
      const rows = [{ id: 1 }, { id: 2 }];
      expect(shapeResponse(rows, { returns: "/0" })).toEqual({ id: 1 });
    });

    it("returns null when no rows", () => {
      expect(shapeResponse([], { returns: "/0" })).toBeNull();
    });
  });

  describe("returns: /0/field (scalar extraction)", () => {
    it("returns scalar value from first row", () => {
      const rows = [{ count: 42 }];
      expect(shapeResponse(rows, { returns: "/0/count" })).toBe(42);
    });

    it("returns null when no rows", () => {
      expect(shapeResponse([], { returns: "/0/total" })).toBeNull();
    });

    it("returns null for missing field", () => {
      const rows = [{ a: 1 }];
      expect(shapeResponse(rows, { returns: "/0/nonexistent" })).toBeNull();
    });
  });

  describe("returns: deeper paths", () => {
    it("extracts specific row by index", () => {
      const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
      expect(shapeResponse(rows, { returns: "/1" })).toEqual({ id: 2 });
    });

    it("extracts field from specific row", () => {
      const rows = [{ name: "Alice" }, { name: "Bob" }];
      expect(shapeResponse(rows, { returns: "/1/name" })).toBe("Bob");
    });

    it("returns null for out-of-bounds index", () => {
      const rows = [{ id: 1 }];
      expect(shapeResponse(rows, { returns: "/5" })).toBeNull();
    });
  });

  describe("with field mapping", () => {
    it("applies field mapping before extraction", () => {
      const rows = [{ first_name: "Alice" }];
      const config = { fields: { firstName: "first_name" }, returns: "/0" };

      expect(shapeResponse(rows, config)).toEqual({ firstName: "Alice" });
    });

    it("applies mapping to all rows when returning full array", () => {
      const rows = [{ first_name: "Alice" }, { first_name: "Bob" }];
      const config = { fields: { firstName: "first_name" } };

      expect(shapeResponse(rows, config)).toEqual([
        { firstName: "Alice" },
        { firstName: "Bob" },
      ]);
    });

    it("extracts mapped field by new name", () => {
      const rows = [{ first_name: "Alice" }];
      const config = { fields: { firstName: "first_name" }, returns: "/0/firstName" };

      expect(shapeResponse(rows, config)).toBe("Alice");
    });
  });
});

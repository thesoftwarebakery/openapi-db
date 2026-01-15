import { describe, it, expect } from "vitest";
import { parseSpec, convertPath } from "../src/parser.js";
import type { OpenApiSpec } from "../src/types.js";

describe("convertPath", () => {
  it("converts single path parameter", () => {
    expect(convertPath("/users/{id}")).toBe("/users/:id");
  });

  it("converts multiple path parameters", () => {
    expect(convertPath("/users/{userId}/posts/{postId}")).toBe(
      "/users/:userId/posts/:postId"
    );
  });

  it("leaves paths without parameters unchanged", () => {
    expect(convertPath("/users")).toBe("/users");
  });
});

describe("parseSpec", () => {
  it("extracts routes with x-db extensions", () => {
    const spec: OpenApiSpec = {
      openapi: "3.0.3",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users": {
          get: {
            "x-db": { query: "SELECT * FROM users" },
            parameters: [],
          },
        },
      },
    };

    const routes = parseSpec(spec);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      path: "/users",
      method: "get",
      xDb: { query: "SELECT * FROM users" },
    });
  });

  it("ignores operations without x-db", () => {
    const spec: OpenApiSpec = {
      openapi: "3.0.3",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/health": {
          get: { responses: {} },
        },
        "/users": {
          get: { "x-db": { query: "SELECT 1" } },
        },
      },
    };

    const routes = parseSpec(spec);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.path).toBe("/users");
  });

  it("converts OpenAPI path params to Express style", () => {
    const spec: OpenApiSpec = {
      openapi: "3.0.3",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users/{userId}/posts/{postId}": {
          get: {
            "x-db": { query: "SELECT 1" },
            parameters: [
              { name: "userId", in: "path", required: true },
              { name: "postId", in: "path", required: true },
            ],
          },
        },
      },
    };

    const routes = parseSpec(spec);
    expect(routes[0]?.path).toBe("/users/:userId/posts/:postId");
    expect(routes[0]?.originalPath).toBe("/users/{userId}/posts/{postId}");
  });

  it("preserves original path for error messages", () => {
    const spec: OpenApiSpec = {
      openapi: "3.0.3",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users/{id}": {
          get: { "x-db": { query: "SELECT 1" } },
        },
      },
    };

    const routes = parseSpec(spec);
    expect(routes[0]?.originalPath).toBe("/users/{id}");
  });

  it("merges path-level and operation-level parameters", () => {
    const spec: OpenApiSpec = {
      openapi: "3.0.3",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users/{id}": {
          parameters: [{ name: "id", in: "path", required: true }],
          get: {
            "x-db": { query: "SELECT 1" },
            parameters: [{ name: "limit", in: "query" }],
          },
        },
      },
    };

    const routes = parseSpec(spec);
    expect(routes[0]?.parameters).toHaveLength(2);
    expect(routes[0]?.parameters).toContainEqual({
      name: "id",
      in: "path",
      required: true,
    });
    expect(routes[0]?.parameters).toContainEqual({ name: "limit", in: "query" });
  });

  it("operation parameters override path parameters", () => {
    const spec: OpenApiSpec = {
      openapi: "3.0.3",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users/{id}": {
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          get: {
            "x-db": { query: "SELECT 1" },
            parameters: [
              { name: "id", in: "path", required: true, schema: { type: "integer" } },
            ],
          },
        },
      },
    };

    const routes = parseSpec(spec);
    expect(routes[0]?.parameters).toHaveLength(1);
    expect(routes[0]?.parameters[0]?.schema?.type).toBe("integer");
  });

  it("extracts multiple HTTP methods from same path", () => {
    const spec: OpenApiSpec = {
      openapi: "3.0.3",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users": {
          get: { "x-db": { query: "SELECT * FROM users" } },
          post: { "x-db": { query: "INSERT INTO users" } },
        },
      },
    };

    const routes = parseSpec(spec);
    expect(routes).toHaveLength(2);
    expect(routes.map((r) => r.method)).toContain("get");
    expect(routes.map((r) => r.method)).toContain("post");
  });

  it("extracts response configuration", () => {
    const spec: OpenApiSpec = {
      openapi: "3.0.3",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users/{id}": {
          get: {
            "x-db": {
              query: "SELECT * FROM users WHERE id = $path.id",
              response: {
                type: "first",
                fields: { firstName: "first_name" },
              },
            },
          },
        },
      },
    };

    const routes = parseSpec(spec);
    expect(routes[0]?.xDb.response).toEqual({
      type: "first",
      fields: { firstName: "first_name" },
    });
  });
});

import { describe, it, expect } from "vitest";
import { parseSpec } from "../src/parser.js";
import type { OpenApiSpec } from "../src/types.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
      originalPath: "/users",
      method: "get",
      xDb: { query: "SELECT * FROM users" },
    });
    expect(routes[0]?.pattern.test("/users")).toBe(true);
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
    expect(routes[0]?.originalPath).toBe("/users");
  });

  it("compiles OpenAPI path params to regex pattern", () => {
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
    expect(routes[0]?.originalPath).toBe("/users/{userId}/posts/{postId}");
    expect(routes[0]?.paramNames).toEqual(["userId", "postId"]);
    expect(routes[0]?.pattern.test("/users/123/posts/456")).toBe(true);
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

describe("parseSpec with YAML content", () => {
  it("parses YAML string starting with openapi:", () => {
    const yamlContent = `
openapi: "3.0.3"
info:
  title: Test API
  version: "1.0.0"
paths:
  /users:
    get:
      x-db:
        query: SELECT * FROM users
`;
    const routes = parseSpec(yamlContent);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.originalPath).toBe("/users");
    expect(routes[0]?.xDb.query).toBe("SELECT * FROM users");
  });

  it("parses YAML string starting with ---", () => {
    const yamlContent = `---
openapi: "3.0.3"
info:
  title: Test API
  version: "1.0.0"
paths:
  /items:
    get:
      x-db:
        query: SELECT * FROM items
`;
    const routes = parseSpec(yamlContent);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.originalPath).toBe("/items");
  });

  it("parses YAML with complex x-db configuration", () => {
    const yamlContent = `
openapi: "3.0.3"
info:
  title: Test API
  version: "1.0.0"
paths:
  /users/{id}:
    get:
      parameters:
        - name: id
          in: path
          required: true
      x-db:
        query: |
          SELECT id, first_name, last_name
          FROM users
          WHERE id = $path.id
        response:
          type: first
          fields:
            firstName: first_name
            lastName: last_name
`;
    const routes = parseSpec(yamlContent);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.originalPath).toBe("/users/{id}");
    expect(routes[0]?.xDb.response?.type).toBe("first");
    expect(routes[0]?.xDb.response?.fields).toEqual({
      firstName: "first_name",
      lastName: "last_name",
    });
  });

  it("parses YAML with multiple routes and methods", () => {
    const yamlContent = `
openapi: "3.0.3"
info:
  title: Test API
  version: "1.0.0"
paths:
  /users:
    get:
      x-db:
        query: SELECT * FROM users
    post:
      x-db:
        query: INSERT INTO users (name) VALUES ($body.name)
        response:
          type: first
  /posts:
    get:
      x-db:
        query: SELECT * FROM posts
`;
    const routes = parseSpec(yamlContent);
    expect(routes).toHaveLength(3);
    expect(routes.map((r) => `${r.method} ${r.originalPath}`)).toContain("get /users");
    expect(routes.map((r) => `${r.method} ${r.originalPath}`)).toContain("post /users");
    expect(routes.map((r) => `${r.method} ${r.originalPath}`)).toContain("get /posts");
  });

  it("handles YAML with leading newline", () => {
    const yamlContent = `
openapi: "3.0.3"
info:
  title: Test
  version: "1.0.0"
paths:
  /test:
    get:
      x-db:
        query: SELECT 1
`;
    const routes = parseSpec(yamlContent);
    expect(routes).toHaveLength(1);
  });
});

describe("parseSpec with JSON content", () => {
  it("parses JSON string", () => {
    const jsonContent = JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users": {
          get: {
            "x-db": { query: "SELECT * FROM users" },
          },
        },
      },
    });

    const routes = parseSpec(jsonContent);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.originalPath).toBe("/users");
  });

  it("parses formatted JSON string", () => {
    const jsonContent = `{
  "openapi": "3.0.3",
  "info": { "title": "Test", "version": "1.0.0" },
  "paths": {
    "/items": {
      "get": {
        "x-db": {
          "query": "SELECT * FROM items",
          "response": { "type": "array" }
        }
      }
    }
  }
}`;
    const routes = parseSpec(jsonContent);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.originalPath).toBe("/items");
    expect(routes[0]?.xDb.response?.type).toBe("array");
  });

  it("parses JSON with leading whitespace", () => {
    const jsonContent = `
    {
      "openapi": "3.0.3",
      "info": { "title": "Test", "version": "1.0.0" },
      "paths": {
        "/test": {
          "get": { "x-db": { "query": "SELECT 1" } }
        }
      }
    }`;
    const routes = parseSpec(jsonContent);
    expect(routes).toHaveLength(1);
  });
});

describe("parseSpec with file paths", () => {
  it("loads YAML file from path", () => {
    const filePath = path.join(__dirname, "fixtures", "openapi.yaml");
    const routes = parseSpec(filePath);
    expect(routes.length).toBeGreaterThan(0);
  });

  it("loads JSON file from path", () => {
    const filePath = path.join(__dirname, "fixtures", "openapi.json");
    const routes = parseSpec(filePath);
    expect(routes).toHaveLength(3);
    expect(routes.map((r) => `${r.method} ${r.originalPath}`)).toContain("get /items");
    expect(routes.map((r) => `${r.method} ${r.originalPath}`)).toContain("post /items");
    expect(routes.map((r) => `${r.method} ${r.originalPath}`)).toContain("get /items/{id}");
  });
});

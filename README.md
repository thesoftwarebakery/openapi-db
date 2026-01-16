# openapi-db

A lightweight, framework-agnostic library that serves REST API endpoints directly from an OpenAPI spec with SQL queries embedded via a custom `x-db` extension.

## Features

- **Framework-agnostic** - Works with raw Node.js, Express, Fastify, Hono, or any framework
- **OpenAPI-driven** - Define your API once, get routing and database queries from the same spec
- **SQL injection safe** - All variables become parameterized query placeholders
- **Zero boilerplate** - No controllers, no route handlers, just OpenAPI + SQL

## Installation

```bash
npm install openapi-db pg yaml
```

## Quick Start

```typescript
import { createRouter } from "openapi-db";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const router = await createRouter({
  spec: "./openapi.yaml",
  db: pool,
});

// router.handle(req) returns { status, headers, body } or null
```

## API Reference

### `createRouter(options): Promise<Router>`

Creates a router from an OpenAPI spec with `x-db` extensions.

```typescript
interface RouterOptions {
  // Path to OpenAPI spec file (YAML/JSON), or pre-parsed object
  spec: string | OpenAPIDocument;

  // Postgres connection pool
  db: Pool;

  // Optional auth resolver - called for routes that use $auth.*
  auth?: (req: IncomingMessage) => Promise<Record<string, unknown> | null>;
}
```

### `Router.handle(req): Promise<RouterResponse | null>`

Handles an incoming request. Returns `null` if no matching `x-db` route is found.

```typescript
interface RouterResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}
```

### `OpenApiDbError`

Typed error class thrown for various error conditions. Catch this to format error responses.

```typescript
class OpenApiDbError extends Error {
  code: string; // Error code (see below)
  status: number; // HTTP status code
  details?: unknown; // Additional error details
}
```

**Error codes:**

- `VALIDATION_ERROR` - Boot-time validation failed
- `AUTH_RESOLVER_MISSING` - Route uses `$auth` but no auth resolver provided
- `AUTH_REQUIRED` - Auth resolver returned null
- `UNKNOWN_FUNCTION` - Unknown function in template
- `QUERY_ERROR` - Database query failed
- `NOT_FOUND` - First-type response with no rows

## The `x-db` Extension

Add the `x-db` extension to any OpenAPI operation to generate a database-backed endpoint:

```yaml
paths:
  /users:
    get:
      summary: List users
      x-db:
        query: SELECT * FROM users
```

### Extension Schema

```yaml
x-db:
  # SQL query with variable interpolation (required)
  query: string

  # Response shaping (optional)
  response:
    # How to shape the result
    type: 'array' | 'first' | 'value'

    # Field mapping: API field name -> SQL column name
    fields:
      apiFieldName: sql_column_name
```

### Response Types

| Type              | Description                      | No rows returns          |
| ----------------- | -------------------------------- | ------------------------ |
| `array` (default) | Return all rows as an array      | `[]`                     |
| `first`           | Return first row as object       | Throws `NOT_FOUND` error |
| `value`           | Return first column of first row | `null`                   |

### Field Mapping

Map snake_case database columns to camelCase API fields:

```yaml
x-db:
  query: SELECT id, first_name, last_name FROM users
  response:
    fields:
      firstName: first_name
      lastName: last_name
```

Result: `{ "id": 1, "firstName": "Alice", "lastName": "Smith" }`

## Variable Interpolation

Variables in SQL queries are replaced with parameterized placeholders (`$1`, `$2`, etc.), preventing SQL injection.

### Variable Sources

| Syntax              | Description                | Example                                               |
| ------------------- | -------------------------- | ----------------------------------------------------- |
| `$path.name`        | URL path parameters        | `/users/{id}` → `$path.id`                            |
| `$query.name`       | Query string parameters    | `?status=active` → `$query.status`                    |
| `$body.field`       | Request body fields        | `{ "name": "Alice" }` → `$body.name`                  |
| `$body.nested.path` | Nested body fields         | `{ "user": { "name": "Alice" } }` → `$body.user.name` |
| `$body`             | Entire request body        | For JSONB columns                                     |
| `$auth.field`       | Auth resolver return value | `$auth.tenantId`                                      |

### Example

```yaml
paths:
  /users/{id}:
    get:
      parameters:
        - name: id
          in: path
          required: true
      x-db:
        query: |
          SELECT * FROM users
          WHERE id = $path.id
            AND tenant_id = $auth.tenantId
        response:
          type: first
```

## Functions

Helper functions for common operations:

| Function                     | Description                                 | Example                       |
| ---------------------------- | ------------------------------------------- | ----------------------------- |
| `$.default(value, fallback)` | Returns fallback if value is null/undefined | `$.default($query.limit, 20)` |
| `$.now()`                    | Current timestamp                           | `$.now()`                     |
| `$.uuid()`                   | Generate UUID v4                            | `$.uuid()`                    |

Functions can be nested:

```yaml
x-db:
  query: |
    SELECT * FROM users
    WHERE status = $.default($query.status, 'active')
    LIMIT $.default($query.limit, 20)
```

## Usage Examples

### Raw Node.js

```typescript
import http from "http";
import { Pool } from "pg";
import { createRouter, OpenApiDbError } from "openapi-db";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const router = await createRouter({
  spec: "./openapi.yaml",
  db: pool,
  auth: async (req) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return null;
    const user = await verifyJwt(token);
    return { userId: user.id, tenantId: user.tenantId };
  },
});

http
  .createServer(async (req, res) => {
    try {
      const response = await router.handle(req);

      if (!response) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      res.writeHead(response.status, {
        "Content-Type": "application/json",
        ...response.headers,
      });
      res.end(JSON.stringify(response.body));
    } catch (err) {
      if (err instanceof OpenApiDbError) {
        res.writeHead(err.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.code, message: err.message }));
      } else {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  })
  .listen(3000);
```

### Express

```typescript
import express from "express";
import { Pool } from "pg";
import { createRouter, OpenApiDbError } from "openapi-db";

const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const router = await createRouter({
  spec: "./openapi.yaml",
  db: pool,
  auth: async (req) => ({ tenantId: req.headers["x-tenant-id"] }),
});

// OpenAPI-db middleware
app.use(async (req, res, next) => {
  try {
    const response = await router.handle(req);
    if (!response) return next();
    res.status(response.status).json(response.body);
  } catch (err) {
    if (err instanceof OpenApiDbError) {
      res.status(err.status).json({ error: err.code, message: err.message });
    } else {
      next(err);
    }
  }
});

// Custom routes still work
app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(3000);
```

### Fastify

```typescript
import Fastify from "fastify";
import { Pool } from "pg";
import { createRouter, OpenApiDbError } from "openapi-db";

const fastify = Fastify();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const router = await createRouter({ spec: "./openapi.yaml", db: pool });

fastify.addHook("onRequest", async (req, reply) => {
  try {
    const response = await router.handle(req.raw);
    if (response) {
      reply.status(response.status).send(response.body);
    }
  } catch (err) {
    if (err instanceof OpenApiDbError) {
      reply.status(err.status).send({ error: err.code, message: err.message });
    } else {
      throw err;
    }
  }
});

fastify.get("/health", async () => ({ ok: true }));

fastify.listen({ port: 3000 });
```

## Complete OpenAPI Example

```yaml
openapi: 3.0.3
info:
  title: Users API
  version: 1.0.0

paths:
  /users:
    get:
      summary: List users
      parameters:
        - name: status
          in: query
          schema:
            type: string
        - name: limit
          in: query
          schema:
            type: integer
      x-db:
        query: |
          SELECT id, first_name, last_name, email, created_at
          FROM users
          WHERE tenant_id = $auth.tenantId
            AND status = $.default($query.status, 'active')
          ORDER BY created_at DESC
          LIMIT $.default($query.limit, 20)
        response:
          fields:
            firstName: first_name
            lastName: last_name
            createdAt: created_at

    post:
      summary: Create user
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                firstName:
                  type: string
                lastName:
                  type: string
                email:
                  type: string
      x-db:
        query: |
          INSERT INTO users (id, first_name, last_name, email, tenant_id, created_at)
          VALUES ($.uuid(), $body.firstName, $body.lastName, $body.email, $auth.tenantId, $.now())
          RETURNING id, first_name, last_name, email, created_at
        response:
          type: first
          fields:
            firstName: first_name
            lastName: last_name
            createdAt: created_at

  /users/{id}:
    get:
      summary: Get user by ID
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      x-db:
        query: |
          SELECT id, first_name, last_name, email, created_at
          FROM users
          WHERE id = $path.id AND tenant_id = $auth.tenantId
        response:
          type: first
          fields:
            firstName: first_name
            lastName: last_name
            createdAt: created_at

    delete:
      summary: Delete user
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      x-db:
        query: |
          DELETE FROM users
          WHERE id = $path.id AND tenant_id = $auth.tenantId
          RETURNING id
        response:
          type: first

  /users/count:
    get:
      summary: Get user count
      x-db:
        query: |
          SELECT COUNT(*)::int FROM users WHERE tenant_id = $auth.tenantId
        response:
          type: value
```

## Array Parameters

Query parameters defined as arrays in the OpenAPI spec are automatically coerced:

```yaml
parameters:
  - name: ids
    in: query
    schema:
      type: array
      items:
        type: string
```

```
GET /users?ids=1,2,3
```

```yaml
x-db:
  query: SELECT * FROM users WHERE id = ANY($query.ids)
```

## Boot-time Validation

When `createRouter()` is called, the library validates:

1. **Auth usage** - If any query uses `$auth.*` but no `auth` option is provided, an error is thrown
2. **Spec parsing** - Invalid YAML/JSON specs throw `SPEC_PARSE_ERROR`

## Security Warning

**Never publish or expose your OpenAPI spec when using openapi-db.**

Unlike standard OpenAPI specs which describe your API contract,
specs with `x-db` extensions contain implementation details:

- Database table and column names
- SQL queries and access patterns
- Authorization logic
- Internal business rules

Treat your spec file like source code, not documentation.

### Recommendations

1. **Separate specs** - Keep a public OpenAPI spec for documentation
   and a private one with `x-db` extensions for your server
2. **Git ignore patterns** - Consider naming convention like
   `*.internal.yaml` and gitignoring if the repo is public
3. **Disable Swagger UI** - Don't serve the raw spec from your API
4. **Strip x-db in CI** - If you generate client SDKs, strip
   extensions first

## License

MIT

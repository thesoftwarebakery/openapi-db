# openapi-db

Framework-agnostic library that serves REST API endpoints directly from an OpenAPI specification with embedded database queries.

Define your API once in OpenAPI, add database queries via the `x-db` extension, and get automatic routing, parameter binding, and response shaping. No controller boilerplate.

## Features

- **OpenAPI-first**: Your spec is the source of truth
- **Framework-agnostic**: Works with Express, Fastify, Hono, Koa, or raw Node.js
- **Multiple databases**: PostgreSQL and MongoDB adapters included, or [build your own](docs/adapters/custom.md)
- **Secure by default**: Parameterized queries prevent SQL/NoSQL injection
- **Response shaping**: Field mapping and JSON Pointer extraction built-in

## Installation

```bash
npm install openapi-db
```

Install your database driver as a peer dependency:

```bash
# For PostgreSQL
npm install pg

# For MongoDB
npm install mongodb
```

## Quick Start

### 1. Define your OpenAPI spec with `x-db` extensions

```yaml
# openapi.yaml
openapi: "3.0.3"
info:
  title: My API
  version: "1.0.0"

paths:
  /users:
    get:
      summary: List users
      parameters:
        - name: status
          in: query
          schema:
            type: string
      x-db:
        query: |
          SELECT id, first_name, last_name, status
          FROM users
          WHERE status = ${{ default(query.status, 'active') }}
        fields:
          firstName: first_name
          lastName: last_name

  /users/{id}:
    get:
      summary: Get user by ID
      parameters:
        - name: id
          in: path
          required: true
      x-db:
        query: |
          SELECT id, first_name, last_name, status
          FROM users
          WHERE id = ${{ path.id }}
        fields:
          firstName: first_name
          lastName: last_name
        returns: /0
```

### 2. Create the router and handle requests

```typescript
import { createRouter, PgAdapter, OpenApiDbError } from "openapi-db";
import { Pool } from "pg";
import express from "express";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: {
    postgres: new PgAdapter(pool),
  },
});

const app = express();
app.use(express.json());

app.use(async (req, res, next) => {
  try {
    const response = await router.handle(req);
    if (!response) return next(); // No matching route
    res.status(response.status).json(response.body);
  } catch (err) {
    if (err instanceof OpenApiDbError) {
      res.status(err.status).json({ error: err.message });
    } else {
      next(err);
    }
  }
});

app.listen(3000);
```

That's it. `GET /users` and `GET /users/:id` now work, with automatic parameter binding, field mapping, and error handling.

## The `x-db` Extension

Add `x-db` to any OpenAPI operation to connect it to a database query:

```yaml
x-db:
  # Required: the query to execute
  query: SELECT * FROM users WHERE id = ${{ path.id }}

  # Optional: which adapter to use (required if multiple adapters configured)
  adapter: postgres

  # Optional: map database columns to API field names
  fields:
    firstName: first_name
    lastName: last_name

  # Optional: JSON Pointer to extract from result array
  returns: /0
```

## Variable Interpolation

Use `${{ }}` syntax to inject request values into queries. All variables become parameterized placeholders, preventing injection attacks.

| Source    | Example                | Description                       |
| --------- | ---------------------- | --------------------------------- |
| `path.*`  | `${{ path.id }}`       | URL path parameters               |
| `query.*` | `${{ query.status }}`  | Query string parameters           |
| `body.*`  | `${{ body.email }}`    | Request body fields               |
| `auth.*`  | `${{ auth.tenantId }}` | Auth context (from your resolver) |

### Built-in Functions

| Function                   | Example                                  | Description                      |
| -------------------------- | ---------------------------------------- | -------------------------------- |
| `default(value, fallback)` | `${{ default(query.status, 'active') }}` | Use fallback if value is missing |
| `uuid()`                   | `${{ uuid() }}`                          | Generate a UUID v4               |
| `now()`                    | `${{ now() }}`                           | Current ISO 8601 timestamp       |

## Response Shaping

### Field Mapping

Map snake_case database columns to camelCase API fields:

```yaml
fields:
  firstName: first_name
  lastName: last_name
```

### JSON Pointer Extraction

Use `returns` to extract from the result array:

| Value      | Result           | Use Case              |
| ---------- | ---------------- | --------------------- |
| (omitted)  | `[{...}, {...}]` | List endpoints        |
| `/0`       | `{...}` or 404   | Single item endpoints |
| `/0/count` | `42`             | Scalar values         |

## Authentication

Provide an auth resolver to inject user context into queries:

```typescript
const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: { postgres: new PgAdapter(pool) },
  auth: async (req) => {
    const token = req.headers.authorization?.split(" ")[1];
    const user = await verifyToken(token);
    return user ? { userId: user.id, tenantId: user.tenantId } : null;
  },
});
```

Then use `${{ auth.* }}` in queries for tenant isolation:

```yaml
x-db:
  query: SELECT * FROM users WHERE tenant_id = ${{ auth.tenantId }}
```

Routes using `${{ auth.* }}` return 401 if the auth resolver returns `null`.

## Error Handling

Catch `OpenApiDbError` to handle errors:

```typescript
import { OpenApiDbError } from "openapi-db";

try {
  const response = await router.handle(req);
} catch (err) {
  if (err instanceof OpenApiDbError) {
    // err.code: "NOT_FOUND", "AUTH_REQUIRED", "QUERY_ERROR", etc.
    // err.status: HTTP status code
    // err.message: Human-readable message
  }
}
```

| Code               | Status | Description                     |
| ------------------ | ------ | ------------------------------- |
| `NOT_FOUND`        | 404    | `returns: /0` with empty result |
| `AUTH_REQUIRED`    | 401    | Auth resolver returned null     |
| `QUERY_ERROR`      | 500    | Database query failed           |
| `VALIDATION_ERROR` | 500    | Invalid spec or configuration   |

## Security Warning

**Never publish or expose your OpenAPI spec when using openapi-db.**

Unlike standard OpenAPI specs which describe your API contract, specs with `x-db` extensions contain implementation details: database schema, queries, authorization logic. Treat your spec file like source code, not documentation.

**Recommendations:**

- Keep separate public (documentation) and private (server) specs
- Don't serve the raw spec from your API
- Strip `x-db` extensions before generating client SDKs

## Documentation

### Adapters

- [PostgreSQL](docs/adapters/postgres.md) - Setup, query syntax, examples
- [MongoDB](docs/adapters/mongodb.md) - Setup, all operations, aggregation pipelines
- [Custom Adapters](docs/adapters/custom.md) - Build your own adapter

### Integration

- [Framework Examples](docs/frameworks.md) - Express, Fastify, Hono, Koa

## License

ISC

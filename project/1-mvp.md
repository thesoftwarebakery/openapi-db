# openapi-db

A lightweight Express middleware that serves REST API endpoints directly from an OpenAPI spec with SQL queries embedded via a custom `x-db` extension.

## Overview

The goal is simple: **declare CRUD routes, don't write them**.

- OpenAPI spec is the source of truth
- SQL queries are written directly in the spec
- No migrations, no codegen, no query builder
- If you outgrow it, just write a handler and remove the `x-db` annotation

## The `x-db` Extension Schema

```yaml
x-db:
  # The SQL query - required
  query: string

  # Connection name if multiple DBs configured - optional, defaults to 'default'
  connection: string

  # Response shaping - optional
  response:
    # 'array' (default) | 'first' (unwrap single row) | 'value' (return scalar)
    type: 'array' | 'first' | 'value'

    # Field mapping: API field name -> SQL column name
    # Applied after query returns, before JSON serialization
    fields:
      apiFieldName: sql_column_name
```

## Variable Syntax

Variables are interpolated into queries as parameterised values (safe from SQL injection).

```
$path.paramName           # URL path parameters
$query.paramName          # Query string parameters
$body.field.nested.path   # Request body (supports nesting)
$body                     # Entire request body
$auth.fieldName           # From auth resolver
```

## Function Syntax

A small set of helper functions:

```
$.default(value, fallback)    # Null coalescing
$.now()                       # Current timestamp
$.uuid()                      # Generate UUID
```

Functions can be nested: `$.default($.lower($query.search), 'default')`

## Array Parameters

Array query parameters (as defined in OpenAPI with `style: form`) are automatically converted to native JS arrays. For example, `?ids=1,2,3` becomes an array suitable for use with `WHERE id = ANY($query.ids)` in Postgres.

## Full Example

```yaml
openapi: 3.0.3
info:
  title: My API
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
          SELECT id, first_name, last_name, created_at
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
              $ref: "#/components/schemas/CreateUserRequest"
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

  /stats/user-count:
    get:
      summary: Get total user count
      x-db:
        query: |
          SELECT COUNT(*) FROM users WHERE tenant_id = $auth.tenantId
        response:
          type: value
```

## Middleware Usage

```typescript
import express from "express";
import { openApiDb } from "openapi-db";
import { Pool } from "pg";

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());

app.use(
  openApiDb({
    spec: "./openapi.yaml",
    db: pool,
    auth: async (req) => {
      const token = req.headers.authorization?.split(" ")[1];
      if (!token) return null;
      const user = await verifyJwt(token);
      return { userId: user.id, tenantId: user.tenantId };
    },
  })
);

// Custom routes coexist - middleware calls next() for non-x-db routes
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(3000);
```

## TypeScript Interfaces

```typescript
interface OpenApiDbOptions {
  // Path to OpenAPI spec file, or parsed object
  spec: string | object;

  // Database connection (Postgres Pool for MVP)
  db: Pool;

  // Optional auth resolver - extracts user context from request
  auth?: (req: express.Request) => Promise<Record<string, unknown> | null>;
}

interface XDbExtension {
  query: string;
  connection?: string;
  response?: {
    type?: "array" | "first" | "value";
    fields?: Record<string, string>;
  };
}

interface ParsedRoute {
  path: string; // Express-style path, e.g. /users/:id
  method: string; // GET, POST, PUT, DELETE, PATCH
  xDb: XDbExtension;
  parameters: OpenAPIParameter[]; // From OpenAPI spec
}
```

## Project Structure

```
openapi-db/
├── src/
│   ├── index.ts          # Middleware entry point, exports
│   ├── parser.ts         # OpenAPI + x-db extraction
│   ├── template.ts       # Variable/function interpolation
│   ├── adapters/
│   │   └── postgres.ts   # Postgres adapter
│   └── types.ts          # TypeScript interfaces
├── test/
│   └── fixtures/
│       └── openapi.yaml  # Test spec
├── package.json
├── tsconfig.json
└── README.md
```

## Boot-time Validation

On startup, the middleware should parse the spec and validate:

1. **Auth usage**: If any query references `$auth.*` but no auth resolver is provided, throw immediately.

2. **Path parameters**: If a query references `$path.foo` but `foo` is not defined in the OpenAPI path parameters, warn or throw.

3. **Query parameters**: If a query references `$query.bar` but `bar` is not defined in the OpenAPI query parameters, warn or throw.

```typescript
// Example validation logic
for (const route of parsedRoutes) {
  const query = route.xDb.query;

  if (/\$auth\.\w+/.test(query) && !options.auth) {
    throw new Error(
      `Route ${route.method.toUpperCase()} ${
        route.path
      } references $auth but no auth resolver provided`
    );
  }
}
```

## MVP Scope

**In scope:**

- Express middleware
- OpenAPI 3.x parsing
- `x-db` extension with `query`, `response.type`, `response.fields`
- Variable interpolation: `$path.*`, `$query.*`, `$body.*`, `$auth.*`
- Functions: `$.default()`, `$.now()`, `$.uuid()`
- Postgres adapter
- Boot-time validation
- Array parameter handling

**Out of scope (for now):**

- Build-time SQL/schema validation
- Multiple database connections
- Additional functions (`$.lower()`, `$.concat()`, etc.)
- Fastify/Hono adapters
- Migrations
- Type generation

## Key Implementation Notes

1. **Parameter binding**: All variables must be converted to parameterised queries, never string interpolation. This prevents SQL injection.

2. **Path conversion**: OpenAPI uses `{id}` style, Express uses `:id` style. Convert during parsing.

3. **Response shaping**: Apply field mapping after query returns, before sending response. The `type` option determines whether to send array, single object, or scalar value.

4. **Error handling**: Unhandled exceptions should result in 500 responses with correlation IDs for debugging. Known errors (e.g. not found for `type: first` with no rows) should return appropriate status codes.

5. **Middleware passthrough**: If a request doesn't match any `x-db` route, call `next()` to allow other handlers.

# Building Custom Adapters

This guide explains how to build your own database adapter for openapi-db. You might want to do this to support MySQL, SQLite, DynamoDB, or any other data store.

## The Adapter Interface

Every adapter must implement the `Adapter` interface:

```typescript
import type { Adapter, Context, InterpolationHelpers } from "openapi-db";

interface Adapter {
  validateQuery(query: unknown): { valid: true } | { valid: false; error: string };
  interpolate(query: unknown, context: Context, helpers: InterpolationHelpers): unknown;
  execute(interpolatedQuery: unknown): Promise<Record<string, unknown>[]>;
}
```

## Method Responsibilities

### validateQuery(query)

Called **at boot time** for each route using this adapter. Validate the query structure before the server starts accepting requests.

```typescript
validateQuery(query: unknown): { valid: true } | { valid: false; error: string } {
  if (typeof query !== "string") {
    return { valid: false, error: "MySQL adapter expects a string query" };
  }
  return { valid: true };
}
```

**Guidelines:**
- Validate the query shape (string for SQL, object for NoSQL)
- Don't validate variable placeholders (they're resolved at runtime)
- Return clear error messages - they appear at startup

### interpolate(query, context, helpers)

Called **at request time** to replace `${{ }}` placeholders with actual values from the request.

```typescript
interpolate(
  query: unknown,
  context: Context,
  helpers: InterpolationHelpers
): InterpolatedQuery {
  const template = query as string;
  const refs = helpers.parseTemplate(template);
  // ... replace placeholders with parameterized values
  return { sql: "SELECT * FROM users WHERE id = ?", values: ["123"] };
}
```

**Context object:**
```typescript
interface Context {
  path: Record<string, string>;              // URL path parameters
  query: Record<string, string | string[]>;  // Query string parameters
  body: unknown;                             // Request body
  auth: Record<string, unknown> | null;      // Auth resolver result
}
```

**Guidelines:**
- Use `helpers.parseTemplate()` to find all `${{ }}` placeholders
- Use `helpers.resolveVariable()` for variable references like `path.id`
- Use `helpers.evaluateFunction()` for function calls like `default(query.x, 'y')`
- Return whatever format your `execute()` method expects

### execute(interpolatedQuery)

Called **after interpolation** to run the query against your database.

```typescript
async execute(query: InterpolatedQuery): Promise<Record<string, unknown>[]> {
  try {
    const result = await this.connection.query(query.sql, query.values);
    return result.rows;
  } catch (error) {
    throw new OpenApiDbError(
      "QUERY_ERROR",
      error instanceof Error ? error.message : "Query failed",
      500,
      error
    );
  }
}
```

**Guidelines:**
- Always return an array of row objects
- Wrap database errors in `OpenApiDbError` with code `QUERY_ERROR`
- Include the original error in `details` for debugging

## Interpolation Helpers

The `helpers` parameter provides utilities for parsing and evaluating `${{ }}` expressions:

### helpers.parseTemplate(template)

Find all `${{ }}` placeholders in a string:

```typescript
const refs = helpers.parseTemplate("SELECT * FROM users WHERE id = ${{ path.id }}");
// Returns:
// [{ match: "${{ path.id }}", inner: "path.id", start: 36, end: 51 }]
```

### helpers.resolveVariable(ref, context)

Resolve a variable reference to its value:

```typescript
// context.path = { id: "123" }
const value = helpers.resolveVariable("path.id", context);
// Returns: "123"

// context.body = { user: { name: "Alice" } }
const name = helpers.resolveVariable("body.user.name", context);
// Returns: "Alice"
```

### helpers.evaluateFunction(expr, context)

Evaluate a function expression:

```typescript
// Built-in functions: default(), now(), uuid()
const status = helpers.evaluateFunction("default(query.status, 'active')", context);
// Returns: "active" if query.status is undefined

const id = helpers.evaluateFunction("uuid()", context);
// Returns: "550e8400-e29b-41d4-a716-446655440000"

const timestamp = helpers.evaluateFunction("now()", context);
// Returns: "2024-01-15T10:30:00.000Z"
```

## Example: MySQL Adapter

Here's a complete example of a MySQL adapter:

```typescript
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { Adapter, Context, InterpolationHelpers } from "openapi-db";
import { OpenApiDbError } from "openapi-db";

interface InterpolatedMysqlQuery {
  sql: string;
  values: unknown[];
}

export class MysqlAdapter implements Adapter {
  constructor(private pool: Pool) {}

  validateQuery(query: unknown): { valid: true } | { valid: false; error: string } {
    if (typeof query !== "string") {
      return {
        valid: false,
        error: "MySQL adapter expects a string query",
      };
    }
    return { valid: true };
  }

  interpolate(
    query: unknown,
    context: Context,
    helpers: InterpolationHelpers
  ): InterpolatedMysqlQuery {
    const template = query as string;
    const refs = helpers.parseTemplate(template);
    const values: unknown[] = [];
    let sql = template;
    let offset = 0;

    for (const ref of refs) {
      // Determine if it's a function or variable
      const isFunction = /^\w+\(/.test(ref.inner);
      const value = isFunction
        ? helpers.evaluateFunction(ref.inner, context)
        : helpers.resolveVariable(ref.inner, context);

      values.push(value);
      const placeholder = "?"; // MySQL uses ? for placeholders

      // Replace ${{ ... }} with ?
      sql =
        sql.slice(0, ref.start + offset) +
        placeholder +
        sql.slice(ref.end + offset);
      offset += placeholder.length - (ref.end - ref.start);
    }

    return { sql, values };
  }

  async execute(query: InterpolatedMysqlQuery): Promise<Record<string, unknown>[]> {
    try {
      const [rows] = await this.pool.query<RowDataPacket[]>(query.sql, query.values);
      return rows as Record<string, unknown>[];
    } catch (error) {
      throw new OpenApiDbError(
        "QUERY_ERROR",
        error instanceof Error ? error.message : "MySQL query failed",
        500,
        error
      );
    }
  }
}
```

Usage:

```typescript
import mysql from "mysql2/promise";
import { createRouter } from "openapi-db";
import { MysqlAdapter } from "./mysql-adapter";

const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  database: "myapp",
});

const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: {
    mysql: new MysqlAdapter(pool),
  },
});
```

## Example: SQLite Adapter

```typescript
import Database from "better-sqlite3";
import type { Adapter, Context, InterpolationHelpers } from "openapi-db";
import { OpenApiDbError } from "openapi-db";

interface InterpolatedSqliteQuery {
  sql: string;
  values: unknown[];
}

export class SqliteAdapter implements Adapter {
  constructor(private db: Database.Database) {}

  validateQuery(query: unknown): { valid: true } | { valid: false; error: string } {
    if (typeof query !== "string") {
      return {
        valid: false,
        error: "SQLite adapter expects a string query",
      };
    }
    return { valid: true };
  }

  interpolate(
    query: unknown,
    context: Context,
    helpers: InterpolationHelpers
  ): InterpolatedSqliteQuery {
    const template = query as string;
    const refs = helpers.parseTemplate(template);
    const values: unknown[] = [];
    let sql = template;
    let offset = 0;

    for (const ref of refs) {
      const isFunction = /^\w+\(/.test(ref.inner);
      const value = isFunction
        ? helpers.evaluateFunction(ref.inner, context)
        : helpers.resolveVariable(ref.inner, context);

      values.push(value);
      const placeholder = "?";

      sql =
        sql.slice(0, ref.start + offset) +
        placeholder +
        sql.slice(ref.end + offset);
      offset += placeholder.length - (ref.end - ref.start);
    }

    return { sql, values };
  }

  async execute(query: InterpolatedSqliteQuery): Promise<Record<string, unknown>[]> {
    try {
      // better-sqlite3 is synchronous, wrap in Promise for interface compatibility
      const stmt = this.db.prepare(query.sql);

      // Detect if it's a SELECT query
      if (query.sql.trim().toUpperCase().startsWith("SELECT")) {
        return stmt.all(...query.values) as Record<string, unknown>[];
      }

      // For INSERT/UPDATE/DELETE, run and return metadata
      const result = stmt.run(...query.values);
      return [{
        lastInsertRowid: result.lastInsertRowid,
        changes: result.changes,
      }];
    } catch (error) {
      throw new OpenApiDbError(
        "QUERY_ERROR",
        error instanceof Error ? error.message : "SQLite query failed",
        500,
        error
      );
    }
  }
}
```

## Testing Your Adapter

### Unit Tests

Test interpolation logic with mocked helpers:

```typescript
import { describe, it, expect } from "vitest";
import { MysqlAdapter } from "./mysql-adapter";

describe("MysqlAdapter", () => {
  describe("validateQuery", () => {
    it("accepts string queries", () => {
      const adapter = new MysqlAdapter({} as any);
      expect(adapter.validateQuery("SELECT * FROM users")).toEqual({ valid: true });
    });

    it("rejects non-string queries", () => {
      const adapter = new MysqlAdapter({} as any);
      expect(adapter.validateQuery({ collection: "users" })).toEqual({
        valid: false,
        error: "MySQL adapter expects a string query",
      });
    });
  });

  describe("interpolate", () => {
    it("replaces placeholders with ?", () => {
      const adapter = new MysqlAdapter({} as any);
      const context = {
        path: { id: "123" },
        query: {},
        body: null,
        auth: null,
      };
      const helpers = {
        parseTemplate: () => [
          { match: "${{ path.id }}", inner: "path.id", start: 32, end: 46 },
        ],
        resolveVariable: () => "123",
        evaluateFunction: () => null,
      };

      const result = adapter.interpolate(
        "SELECT * FROM users WHERE id = ${{ path.id }}",
        context,
        helpers
      );

      expect(result).toEqual({
        sql: "SELECT * FROM users WHERE id = ?",
        values: ["123"],
      });
    });
  });
});
```

### Integration Tests

Use testcontainers for real database tests:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MySqlContainer, StartedMySqlContainer } from "@testcontainers/mysql";
import mysql from "mysql2/promise";
import { createRouter } from "openapi-db";
import { MysqlAdapter } from "./mysql-adapter";

describe("MysqlAdapter integration", () => {
  let container: StartedMySqlContainer;
  let pool: mysql.Pool;

  beforeAll(async () => {
    container = await new MySqlContainer().start();
    pool = mysql.createPool({
      host: container.getHost(),
      port: container.getPort(),
      user: container.getUsername(),
      password: container.getUserPassword(),
      database: container.getDatabase(),
    });

    // Create schema
    await pool.query(`
      CREATE TABLE users (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255),
        status VARCHAR(50)
      )
    `);
  }, 60000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it("executes SELECT queries", async () => {
    await pool.query("INSERT INTO users VALUES ('1', 'Alice', 'active')");

    const router = await createRouter({
      spec: {
        openapi: "3.0.3",
        info: { title: "Test", version: "1.0.0" },
        paths: {
          "/users/{id}": {
            get: {
              parameters: [{ name: "id", in: "path", required: true }],
              "x-db": {
                query: "SELECT * FROM users WHERE id = ${{ path.id }}",
                returns: "/0",
              },
            },
          },
        },
      },
      adapters: {
        mysql: new MysqlAdapter(pool),
      },
    });

    // Test with mock request...
  });
});
```

## Best Practices

1. **Use parameterized queries** - Never concatenate user input directly into queries
2. **Preserve types** - When a placeholder is the entire value, preserve the resolved type
3. **Handle errors gracefully** - Wrap all database errors in `OpenApiDbError`
4. **Validate early** - Catch configuration errors at boot time in `validateQuery()`
5. **Document your adapter** - Explain query format, supported features, and limitations
6. **Write comprehensive tests** - Cover both unit and integration scenarios

# MySQL Adapter

The MySQL adapter (`MysqlAdapter`) executes SQL queries using the `mysql2` library with parameterized queries for security.

## Setup

### Install peer dependency

```bash
npm install mysql2
```

### Create the adapter

```typescript
import { createRouter, MysqlAdapter } from "openapi-db";
import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "password",
  database: "myapp",
});

const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: {
    mysql: new MysqlAdapter(pool),
  },
});
```

The adapter accepts any `mysql2/promise` Pool instance. You control connection pooling, SSL configuration, and other settings through your pool configuration.

## Query Syntax

Queries are standard SQL strings with `${{ }}` placeholders for variable interpolation:

```yaml
x-db:
  adapter: mysql
  query: |
    SELECT id, first_name, last_name
    FROM users
    WHERE id = ${{ path.id }}
```

### Parameterization

All `${{ }}` placeholders become parameterized query placeholders (`?`), preventing SQL injection:

```yaml
# Your spec
x-db:
  adapter: mysql
  query: |
    SELECT * FROM users
    WHERE tenant_id = ${{ auth.tenantId }}
      AND status = ${{ query.status }}
```

```sql
-- Executed query
SELECT * FROM users
WHERE tenant_id = ?
  AND status = ?
-- values: ['tenant-123', 'active']
```

## Examples

### SELECT - List with filtering

```yaml
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
        adapter: mysql
        query: |
          SELECT id, first_name, last_name, email, status, created_at
          FROM users
          WHERE tenant_id = ${{ auth.tenantId }}
            AND status = ${{ default(query.status, 'active') }}
          ORDER BY created_at DESC
          LIMIT ${{ default(query.limit, 20) }}
        fields:
          firstName: first_name
          lastName: last_name
          createdAt: created_at
```

### SELECT - Single item

```yaml
paths:
  /users/{id}:
    get:
      summary: Get user by ID
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      x-db:
        adapter: mysql
        query: |
          SELECT id, first_name, last_name, email, status
          FROM users
          WHERE id = ${{ path.id }}
            AND tenant_id = ${{ auth.tenantId }}
        fields:
          firstName: first_name
          lastName: last_name
        returns: /0
```

The `returns: /0` extracts the first row as an object. If no rows are returned, a 404 error is thrown.

### INSERT

```yaml
paths:
  /users:
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
        adapter: mysql
        query: |
          INSERT INTO users (id, first_name, last_name, email, tenant_id, status, created_at)
          VALUES (
            ${{ uuid() }},
            ${{ body.firstName }},
            ${{ body.lastName }},
            ${{ body.email }},
            ${{ auth.tenantId }},
            'active',
            ${{ now() }}
          )
```

> **Note:** MySQL does not support `RETURNING` clauses. For INSERT operations, the adapter returns metadata about the operation. If you need the inserted row, use a separate SELECT query or consider using `LAST_INSERT_ID()` for auto-increment columns.

### UPDATE

```yaml
paths:
  /users/{id}:
    patch:
      summary: Update user
      parameters:
        - name: id
          in: path
          required: true
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
      x-db:
        adapter: mysql
        query: |
          UPDATE users
          SET
            first_name = COALESCE(${{ body.firstName }}, first_name),
            last_name = COALESCE(${{ body.lastName }}, last_name),
            updated_at = ${{ now() }}
          WHERE id = ${{ path.id }}
            AND tenant_id = ${{ auth.tenantId }}
```

### DELETE

```yaml
paths:
  /users/{id}:
    delete:
      summary: Delete user
      parameters:
        - name: id
          in: path
          required: true
      x-db:
        adapter: mysql
        query: |
          DELETE FROM users
          WHERE id = ${{ path.id }}
            AND tenant_id = ${{ auth.tenantId }}
```

### Aggregations

```yaml
paths:
  /users/count:
    get:
      summary: Get user count
      x-db:
        adapter: mysql
        query: |
          SELECT COUNT(*) as total
          FROM users
          WHERE tenant_id = ${{ auth.tenantId }}
        returns: /0/total
```

The `returns: /0/total` extracts the scalar value from the first row's `total` field.

### Array parameters with IN clause

For `IN` clauses, MySQL requires expanding the array. You can use a workaround with `FIND_IN_SET` or pass comma-separated values:

```yaml
paths:
  /users:
    get:
      parameters:
        - name: ids
          in: query
          schema:
            type: string
            description: Comma-separated list of IDs
      x-db:
        adapter: mysql
        query: |
          SELECT * FROM users
          WHERE FIND_IN_SET(id, ${{ query.ids }}) > 0
            AND tenant_id = ${{ auth.tenantId }}
```

Request: `GET /users?ids=id1,id2,id3`

### JSON columns

MySQL 5.7+ supports JSON columns:

```yaml
paths:
  /events:
    post:
      x-db:
        adapter: mysql
        query: |
          INSERT INTO events (id, type, payload, created_at)
          VALUES (${{ uuid() }}, ${{ body.type }}, ${{ body }}, ${{ now() }})
```

### Complex queries with subqueries

```yaml
paths:
  /users/{id}/stats:
    get:
      x-db:
        adapter: mysql
        query: |
          SELECT
            u.id,
            u.first_name,
            u.last_name,
            (SELECT COUNT(*) FROM orders WHERE user_id = u.id) as order_count,
            (SELECT SUM(total) FROM orders WHERE user_id = u.id) as total_spent
          FROM users u
          WHERE u.id = ${{ path.id }}
            AND u.tenant_id = ${{ auth.tenantId }}
        fields:
          firstName: first_name
          lastName: last_name
          orderCount: order_count
          totalSpent: total_spent
        returns: /0
```

## Field Mapping

Map snake_case database columns to camelCase API fields:

```yaml
x-db:
  adapter: mysql
  query: SELECT id, first_name, last_name, created_at FROM users
  fields:
    firstName: first_name
    lastName: last_name
    createdAt: created_at
```

Input from database:
```json
[{ "id": "123", "first_name": "Alice", "last_name": "Smith", "created_at": "2024-01-01" }]
```

Output to API:
```json
[{ "id": "123", "firstName": "Alice", "lastName": "Smith", "createdAt": "2024-01-01" }]
```

Unmapped columns (like `id`) pass through unchanged.

## Response Extraction

Use JSON Pointer syntax to extract specific values:

| `returns` | Result | Use case |
|-----------|--------|----------|
| (omitted) | `[{...}, {...}]` | List endpoints |
| `/0` | `{...}` | Single item (404 if empty) |
| `/0/field` | `value` | Scalar value |

## Error Handling

Database errors are wrapped in `OpenApiDbError` with code `QUERY_ERROR`:

```typescript
try {
  const response = await router.handle(req);
} catch (err) {
  if (err instanceof OpenApiDbError && err.code === "QUERY_ERROR") {
    console.error("Database error:", err.message);
    console.error("Original error:", err.details);
  }
}
```

## Differences from PostgreSQL

| Feature | PostgreSQL | MySQL |
|---------|------------|-------|
| Placeholder style | `$1`, `$2`, `$3` | `?` |
| RETURNING clause | ✅ Supported | ❌ Not supported |
| UUID type | `UUID` | `CHAR(36)` or `VARCHAR(36)` |
| Type casting | `::int` | `CAST(... AS SIGNED)` |
| Array parameters | `ANY($1)` | `FIND_IN_SET()` or expand manually |

## Multiple Adapters

Use multiple MySQL adapters for read replicas or different databases:

```typescript
const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: {
    primary: new MysqlAdapter(primaryPool),
    replica: new MysqlAdapter(replicaPool),
    analytics: new MysqlAdapter(analyticsPool),
  },
});
```

Specify the adapter in your spec:

```yaml
paths:
  /users:
    get:
      x-db:
        adapter: replica
        query: SELECT * FROM users
    post:
      x-db:
        adapter: primary
        query: INSERT INTO users ...

  /reports/daily:
    get:
      x-db:
        adapter: analytics
        query: SELECT * FROM daily_stats
```

## MariaDB Compatibility

The MySQL adapter is compatible with MariaDB. Use the same `mysql2` library:

```typescript
const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  database: "myapp",
  // MariaDB uses the same protocol as MySQL
});

const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: {
    mariadb: new MysqlAdapter(pool),
  },
});
```

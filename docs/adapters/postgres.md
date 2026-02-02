# PostgreSQL Adapter

The PostgreSQL adapter (`PgAdapter`) executes SQL queries using the `pg` library with parameterized queries for security.

## Setup

### Install peer dependency

```bash
npm install pg
```

### Create the adapter

```typescript
import { createRouter, PgAdapter } from "openapi-db";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: {
    postgres: new PgAdapter(pool),
  },
});
```

The adapter accepts any `pg.Pool` instance. You control connection pooling, SSL configuration, and other settings through your Pool configuration.

## Query Syntax

Queries are standard SQL strings with `${{ }}` placeholders for variable interpolation:

```yaml
x-db:
  query: |
    SELECT id, first_name, last_name
    FROM users
    WHERE id = ${{ path.id }}
```

### Parameterization

All `${{ }}` placeholders become parameterized query placeholders (`$1`, `$2`, etc.), preventing SQL injection:

```yaml
# Your spec
x-db:
  query: |
    SELECT * FROM users
    WHERE tenant_id = ${{ auth.tenantId }}
      AND status = ${{ query.status }}
```

```sql
-- Executed query
SELECT * FROM users
WHERE tenant_id = $1
  AND status = $2
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
            format: uuid
      x-db:
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

### INSERT with RETURNING

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
          RETURNING id, first_name, last_name, email, status, created_at
        fields:
          firstName: first_name
          lastName: last_name
          createdAt: created_at
        returns: /0
```

### UPDATE with RETURNING

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
        query: |
          UPDATE users
          SET
            first_name = COALESCE(${{ body.firstName }}, first_name),
            last_name = COALESCE(${{ body.lastName }}, last_name),
            updated_at = ${{ now() }}
          WHERE id = ${{ path.id }}
            AND tenant_id = ${{ auth.tenantId }}
          RETURNING id, first_name, last_name, email, status
        fields:
          firstName: first_name
          lastName: last_name
        returns: /0
```

### DELETE with RETURNING

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
        query: |
          DELETE FROM users
          WHERE id = ${{ path.id }}
            AND tenant_id = ${{ auth.tenantId }}
          RETURNING id
        returns: /0
```

### Aggregations

```yaml
paths:
  /users/count:
    get:
      summary: Get user count
      x-db:
        query: |
          SELECT COUNT(*)::int as total
          FROM users
          WHERE tenant_id = ${{ auth.tenantId }}
        returns: /0/total
```

The `returns: /0/total` extracts the scalar value from the first row's `total` field.

### Array parameters

For `IN` clauses, define the parameter as an array in your OpenAPI spec:

```yaml
paths:
  /users:
    get:
      parameters:
        - name: ids
          in: query
          schema:
            type: array
            items:
              type: string
      x-db:
        query: |
          SELECT * FROM users
          WHERE id = ANY(${{ query.ids }})
            AND tenant_id = ${{ auth.tenantId }}
```

Request: `GET /users?ids=id1,id2,id3`

The `query.ids` value is passed as an array to PostgreSQL's `ANY()` function.

### JSONB columns

Store the entire request body in a JSONB column:

```yaml
paths:
  /events:
    post:
      x-db:
        query: |
          INSERT INTO events (id, type, payload, created_at)
          VALUES (${{ uuid() }}, ${{ body.type }}, ${{ body }}, ${{ now() }})
          RETURNING id
        returns: /0
```

### Complex queries with CTEs

```yaml
paths:
  /users/{id}/stats:
    get:
      x-db:
        query: |
          WITH user_orders AS (
            SELECT COUNT(*) as order_count, SUM(total) as total_spent
            FROM orders
            WHERE user_id = ${{ path.id }}
              AND tenant_id = ${{ auth.tenantId }}
          )
          SELECT
            u.id,
            u.first_name,
            u.last_name,
            uo.order_count,
            uo.total_spent
          FROM users u
          CROSS JOIN user_orders uo
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

## Multiple Adapters

Use multiple PostgreSQL adapters for read replicas or different databases:

```typescript
const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: {
    primary: new PgAdapter(primaryPool),
    replica: new PgAdapter(replicaPool),
    analytics: new PgAdapter(analyticsPool),
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

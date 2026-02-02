# MongoDB Adapter

The MongoDB adapter (`MongoAdapter`) executes queries using the official `mongodb` driver. It supports standard CRUD operations and aggregation pipelines.

## Setup

### Install peer dependency

```bash
npm install mongodb
```

### Create the adapter

```typescript
import { createRouter, MongoAdapter } from "openapi-db";
import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db("myapp");

const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: {
    mongo: new MongoAdapter(db),
  },
});
```

The adapter accepts a `mongodb.Db` instance. You control connection settings, authentication, and replica set configuration through your MongoClient.

## Query Syntax

MongoDB queries are objects (not strings) with a required `collection` field and either an `operation` or `pipeline` field:

```yaml
x-db:
  query:
    collection: users
    operation: find
    filter:
      status: active
```

### Variable Interpolation

All string values containing `${{ }}` are interpolated recursively:

```yaml
x-db:
  query:
    collection: users
    operation: find
    filter:
      tenant_id: ${{ auth.tenantId }}
      status: ${{ default(query.status, 'active') }}
```

### Type Preservation

When a string value is entirely a `${{ }}` expression, the resolved value's type is preserved:

```yaml
# Numbers stay numbers
options:
  limit: ${{ default(query.limit, 20) }}  # → 20 (number, not "20")

# Nulls stay null
filter:
  deleted_at: ${{ default(query.deleted, null) }}  # → null
```

## Supported Operations

### find

Query multiple documents.

```yaml
x-db:
  query:
    collection: users
    operation: find
    filter:
      tenant_id: ${{ auth.tenantId }}
      status: ${{ default(query.status, 'active') }}
    options:
      limit: ${{ default(query.limit, 20) }}
      skip: ${{ default(query.skip, 0) }}
      sort:
        created_at: -1
      projection:
        password: 0
  fields:
    firstName: first_name
    lastName: last_name
```

### findOne

Query a single document.

```yaml
x-db:
  query:
    collection: users
    operation: findOne
    filter:
      _id: ${{ path.id }}
      tenant_id: ${{ auth.tenantId }}
  fields:
    id: _id
    firstName: first_name
    lastName: last_name
  returns: /0
```

Returns an empty array if not found. Use `returns: /0` to get a 404 error when the document doesn't exist.

### insertOne

Create a new document.

```yaml
x-db:
  query:
    collection: users
    operation: insertOne
    document:
      _id: ${{ uuid() }}
      first_name: ${{ body.firstName }}
      last_name: ${{ body.lastName }}
      email: ${{ body.email }}
      tenant_id: ${{ auth.tenantId }}
      status: active
      created_at: ${{ now() }}
  fields:
    id: _id
    firstName: first_name
    lastName: last_name
  returns: /0
```

Returns the inserted document with its `_id`.

### updateOne

Update a document using update operators.

```yaml
x-db:
  query:
    collection: users
    operation: updateOne
    filter:
      _id: ${{ path.id }}
      tenant_id: ${{ auth.tenantId }}
    update:
      $set:
        status: ${{ body.status }}
        updated_at: ${{ now() }}
```

Returns operation metadata:
```json
{ "matchedCount": 1, "modifiedCount": 1, "upsertedId": null }
```

### replaceOne

Replace an entire document.

```yaml
x-db:
  query:
    collection: users
    operation: replaceOne
    filter:
      _id: ${{ path.id }}
      tenant_id: ${{ auth.tenantId }}
    replacement:
      _id: ${{ path.id }}
      first_name: ${{ body.firstName }}
      last_name: ${{ body.lastName }}
      email: ${{ body.email }}
      tenant_id: ${{ auth.tenantId }}
      updated_at: ${{ now() }}
```

Returns operation metadata:
```json
{ "matchedCount": 1, "modifiedCount": 1, "upsertedId": null }
```

### deleteOne

Delete a document.

```yaml
x-db:
  query:
    collection: users
    operation: deleteOne
    filter:
      _id: ${{ path.id }}
      tenant_id: ${{ auth.tenantId }}
```

Returns:
```json
{ "deletedCount": 1 }
```

### count

Count documents matching a filter.

```yaml
x-db:
  query:
    collection: users
    operation: count
    filter:
      tenant_id: ${{ auth.tenantId }}
      status: active
  returns: /0
```

Returns:
```json
{ "count": 42 }
```

### findOneAndUpdate

Atomically find and update a document, returning the updated version.

```yaml
x-db:
  query:
    collection: users
    operation: findOneAndUpdate
    filter:
      _id: ${{ path.id }}
      tenant_id: ${{ auth.tenantId }}
    update:
      $set:
        status: ${{ body.status }}
        updated_at: ${{ now() }}
    options:
      returnDocument: after
  fields:
    id: _id
    firstName: first_name
    lastName: last_name
  returns: /0
```

By default, returns the document *after* the update. Returns empty array if not found.

### findOneAndDelete

Atomically find and delete a document, returning the deleted document.

```yaml
x-db:
  query:
    collection: users
    operation: findOneAndDelete
    filter:
      _id: ${{ path.id }}
      tenant_id: ${{ auth.tenantId }}
  fields:
    id: _id
    firstName: first_name
  returns: /0
```

### bulkWrite

Execute multiple write operations in a single command.

```yaml
x-db:
  query:
    collection: users
    operation: bulkWrite
    operations:
      - insertOne:
          document:
            _id: ${{ uuid() }}
            name: ${{ body.users.0.name }}
      - updateOne:
          filter:
            _id: ${{ body.updateId }}
          update:
            $set:
              status: updated
```

Returns:
```json
{
  "insertedCount": 1,
  "matchedCount": 1,
  "modifiedCount": 1,
  "deletedCount": 0,
  "upsertedCount": 0
}
```

## Aggregation Pipelines

Use `pipeline` instead of `operation` for aggregation queries:

```yaml
x-db:
  query:
    collection: users
    pipeline:
      - $match:
          tenant_id: ${{ auth.tenantId }}
          status: active
      - $group:
          _id: $department
          count:
            $sum: 1
          avgSalary:
            $avg: $salary
      - $sort:
          count: -1
```

### Pipeline with $lookup (join)

```yaml
x-db:
  query:
    collection: orders
    pipeline:
      - $match:
          tenant_id: ${{ auth.tenantId }}
          user_id: ${{ path.userId }}
      - $lookup:
          from: products
          localField: product_id
          foreignField: _id
          as: product
      - $unwind: $product
      - $project:
          _id: 1
          quantity: 1
          total: 1
          productName: $product.name
          productPrice: $product.price
```

### Pipeline with $facet (multiple aggregations)

```yaml
x-db:
  query:
    collection: orders
    pipeline:
      - $match:
          tenant_id: ${{ auth.tenantId }}
      - $facet:
          byStatus:
            - $group:
                _id: $status
                count:
                  $sum: 1
          byMonth:
            - $group:
                _id:
                  $month: $created_at
                total:
                  $sum: $amount
          recent:
            - $sort:
                created_at: -1
            - $limit: 5
```

## Field Mapping

Map MongoDB field names to API field names:

```yaml
x-db:
  query:
    collection: users
    operation: find
    filter:
      tenant_id: ${{ auth.tenantId }}
  fields:
    id: _id
    firstName: first_name
    lastName: last_name
    createdAt: created_at
```

Input from MongoDB:
```json
[{ "_id": "abc123", "first_name": "Alice", "last_name": "Smith" }]
```

Output to API:
```json
[{ "id": "abc123", "firstName": "Alice", "lastName": "Smith" }]
```

## Response Extraction

Use JSON Pointer syntax to extract specific values:

| `returns` | Result | Use case |
|-----------|--------|----------|
| (omitted) | `[{...}, {...}]` | List endpoints |
| `/0` | `{...}` | Single item (404 if empty) |
| `/0/count` | `42` | Scalar value |

## Complete Examples

### CRUD API

```yaml
openapi: "3.0.3"
info:
  title: Users API
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
        - name: limit
          in: query
          schema:
            type: integer
      x-db:
        adapter: mongo
        query:
          collection: users
          operation: find
          filter:
            tenant_id: ${{ auth.tenantId }}
            status: ${{ default(query.status, 'active') }}
          options:
            limit: ${{ default(query.limit, 20) }}
            sort:
              created_at: -1
        fields:
          id: _id
          firstName: first_name
          lastName: last_name

    post:
      summary: Create user
      x-db:
        adapter: mongo
        query:
          collection: users
          operation: insertOne
          document:
            _id: ${{ uuid() }}
            first_name: ${{ body.firstName }}
            last_name: ${{ body.lastName }}
            email: ${{ body.email }}
            tenant_id: ${{ auth.tenantId }}
            status: active
            created_at: ${{ now() }}
        fields:
          id: _id
          firstName: first_name
          lastName: last_name
        returns: /0

  /users/{id}:
    get:
      summary: Get user by ID
      parameters:
        - name: id
          in: path
          required: true
      x-db:
        adapter: mongo
        query:
          collection: users
          operation: findOne
          filter:
            _id: ${{ path.id }}
            tenant_id: ${{ auth.tenantId }}
        fields:
          id: _id
          firstName: first_name
          lastName: last_name
        returns: /0

    patch:
      summary: Update user
      parameters:
        - name: id
          in: path
          required: true
      x-db:
        adapter: mongo
        query:
          collection: users
          operation: findOneAndUpdate
          filter:
            _id: ${{ path.id }}
            tenant_id: ${{ auth.tenantId }}
          update:
            $set:
              first_name: ${{ body.firstName }}
              last_name: ${{ body.lastName }}
              updated_at: ${{ now() }}
        fields:
          id: _id
          firstName: first_name
          lastName: last_name
        returns: /0

    delete:
      summary: Delete user
      parameters:
        - name: id
          in: path
          required: true
      x-db:
        adapter: mongo
        query:
          collection: users
          operation: findOneAndDelete
          filter:
            _id: ${{ path.id }}
            tenant_id: ${{ auth.tenantId }}
        fields:
          id: _id
        returns: /0

  /users/count:
    get:
      summary: Count users
      x-db:
        adapter: mongo
        query:
          collection: users
          operation: count
          filter:
            tenant_id: ${{ auth.tenantId }}
        returns: /0

  /users/stats:
    get:
      summary: User statistics by status
      x-db:
        adapter: mongo
        query:
          collection: users
          pipeline:
            - $match:
                tenant_id: ${{ auth.tenantId }}
            - $group:
                _id: $status
                count:
                  $sum: 1
            - $project:
                status: $_id
                count: 1
                _id: 0
```

## Error Handling

MongoDB errors are wrapped in `OpenApiDbError` with code `QUERY_ERROR`:

```typescript
try {
  const response = await router.handle(req);
} catch (err) {
  if (err instanceof OpenApiDbError && err.code === "QUERY_ERROR") {
    console.error("MongoDB error:", err.message);
    console.error("Original error:", err.details);
  }
}
```

## Multiple Adapters

Use multiple MongoDB adapters for different databases:

```typescript
const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: {
    users: new MongoAdapter(client.db("users")),
    analytics: new MongoAdapter(client.db("analytics")),
  },
});
```

Specify the adapter in your spec:

```yaml
paths:
  /users:
    get:
      x-db:
        adapter: users
        query:
          collection: users
          operation: find

  /events:
    post:
      x-db:
        adapter: analytics
        query:
          collection: events
          operation: insertOne
          document:
            type: ${{ body.type }}
            data: ${{ body }}
```

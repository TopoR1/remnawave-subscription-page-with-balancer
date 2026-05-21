# Admin API

All admin requests require:

```http
Authorization: Bearer TOPOR_BALANCER_ADMIN_TOKEN
```

## Health

```bash
curl -H "Authorization: Bearer TOKEN" http://127.0.0.1:3010/api/topor-balancer/health
```

## Balancer Groups

Groups are the public locations users see. Technical nodes live inside a group and inherit its public fields.

```http
GET /api/topor-balancer/groups
POST /api/topor-balancer/groups
PATCH /api/topor-balancer/groups/:id
DELETE /api/topor-balancer/groups/:id
```

```json
{
  "publicHostCode": "fi_standard",
  "publicName": "🇫🇮 Finland",
  "locationCode": "FI",
  "planCode": "standard",
  "strategy": "least_loaded",
  "enabled": true
}
```

Deleting a group with nodes returns `409 Conflict`.

## Technical Nodes

```http
GET /api/topor-balancer/groups/:id/nodes
POST /api/topor-balancer/groups/:id/nodes
PATCH /api/topor-balancer/groups/:id/nodes/:nodeId
DELETE /api/topor-balancer/groups/:id/nodes/:nodeId
```

```json
{
  "technicalHostName": "FI-STD-01",
  "weight": 1,
  "maxUsers": 300,
  "status": "active"
}
```

Deleting a node with assignments returns `409 Conflict`. For production removal, prefer `status: "draining"` or `status: "disabled"`.

## Discovery Import

Discovery import can target an existing group:

```http
POST /api/topor-balancer/discovery/import
```

```json
{
  "groupId": "group-uuid",
  "nodes": [
    {
      "technicalHostName": "FI-STD-01",
      "weight": 1,
      "maxUsers": 300,
      "status": "active"
    }
  ]
}
```

Or create a new group while importing:

```json
{
  "group": {
    "publicHostCode": "fi_standard",
    "publicName": "🇫🇮 Finland",
    "locationCode": "FI",
    "planCode": "standard"
  },
  "nodes": [
    {
      "technicalHostName": "FI-STD-01",
      "weight": 1,
      "maxUsers": 300,
      "status": "active"
    }
  ]
}
```

The response contains `created`, `skipped`, `conflicts`, and `errors`. Same-group duplicates are skipped. Same `technicalHostName` in another group is returned as a conflict.

## Compatibility Nodes API

Legacy node endpoints remain available, but new integrations should use groups:

```http
GET /api/topor-balancer/nodes
POST /api/topor-balancer/nodes
PATCH /api/topor-balancer/nodes/:id
DELETE /api/topor-balancer/nodes/:id
POST /api/topor-balancer/nodes/:id/enable
POST /api/topor-balancer/nodes/:id/drain
POST /api/topor-balancer/nodes/:id/disable
```

## Assignments

```http
GET /api/topor-balancer/assignments
POST /api/topor-balancer/reassign
```

```json
{
  "shortUuid": "user-short-uuid",
  "publicHostCode": "fi_standard",
  "planCode": "standard",
  "technicalHostName": "FI-STD-02"
}
```

## Requests

```http
GET /api/topor-balancer/requests
```

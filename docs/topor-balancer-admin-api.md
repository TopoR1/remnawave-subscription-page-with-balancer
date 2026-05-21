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
GET /api/topor-balancer/groups/:id
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

Supported `strategy` values: `least_loaded`, `weighted`, `sticky_hash`, `priority_failover`, `manual`.

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

## Group Discovery

Group-scoped discovery returns each discovered technical node with its relation to the selected public group.

```http
GET /api/topor-balancer/groups/:id/discovery/remnawave
POST /api/topor-balancer/groups/:id/discovery/refresh
POST /api/topor-balancer/groups/:id/discovery/subscription
POST /api/topor-balancer/groups/:id/nodes/import
```

```json
{
  "shortUuid": "user-short-uuid"
}
```

Discovery item statuses are `free`, `in_this_group`, `in_other_group`, and `conflict`. Sensitive subscription values such as UUID, `pbk`, `sid`, and raw VLESS links are not returned.

```json
{
  "technicalHostNames": ["FI-STD-01", "FI-STD-02"],
  "defaults": {
    "weight": 1,
    "maxUsers": 300,
    "status": "active"
  },
  "mode": "skip_conflicts"
}
```

The group import endpoint never moves nodes between groups. Existing nodes in the selected group are returned in `alreadyInGroup`; nodes owned by another group are returned in `inOtherGroup`.

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

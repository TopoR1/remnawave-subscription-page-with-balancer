# Admin API

Все запросы требуют:

```http
Authorization: Bearer TOPOR_BALANCER_ADMIN_TOKEN
```

## Health

```bash
curl -H "Authorization: Bearer TOKEN" http://127.0.0.1:3010/api/topor-balancer/health
```

## Nodes

```http
GET /api/topor-balancer/nodes
```

```http
POST /api/topor-balancer/nodes
```

```json
{
  "technicalHostName": "FI-STD-01",
  "publicHostCode": "fi_standard",
  "publicName": "Finland",
  "locationCode": "FI",
  "planCode": "standard",
  "weight": 1,
  "maxUsers": 300,
  "status": "active"
}
```

```http
PATCH /api/topor-balancer/nodes/:id
DELETE /api/topor-balancer/nodes/:id
```

Удаление ноды с assignments возвращает `409 Conflict`.

Быстрые действия:

```http
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

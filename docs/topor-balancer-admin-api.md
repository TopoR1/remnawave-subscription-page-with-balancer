# Admin API Remnawave Balancer by TopoR

Admin API находится под префиксом:

```text
/api/topor-balancer
```

Все маршруты требуют Bearer token:

```http
Authorization: Bearer <TOPOR_BALANCER_ADMIN_TOKEN>
```

Если `TOPOR_BALANCER_ADMIN_TOKEN` пустой или не задан, маршруты отключены и отвечают `404 Not Found`. Если токен задан, но заголовок неверный, будет `401 Unauthorized`.

Большинство маршрутов управления читает/пишет PostgreSQL. Если `TOPOR_BALANCER_DATABASE_URL` не задан или БД недоступна, возможен `503 Service Unavailable`.

## GET `/api/topor-balancer/health`

Проверяет состояние балансировщика и БД.

Пример ответа:

```json
{
  "enabled": true,
  "assignmentMode": "database",
  "configLoaded": true,
  "databaseConnected": true,
  "nodeCount": 6,
  "assignmentCount": 120,
  "requestCount": 500,
  "lastError": "optional last config or database error"
}
```

Поля:

- `enabled` - включен ли `TOPOR_BALANCER_ENABLED`;
- `assignmentMode` - `hash` или `database`;
- `configLoaded` - удалось ли прочитать JSON-конфиг;
- `databaseConnected` - удалось ли выполнить запрос к PostgreSQL;
- `nodeCount`, `assignmentCount`, `requestCount` - счетчики таблиц;
- `lastError` - последняя ошибка проверки, если была.

## GET `/api/topor-balancer/nodes`

Возвращает список нод из БД.

Пример ответа:

```json
[
  {
    "id": "uuid",
    "technicalHostName": "FI-STD-01",
    "publicHostCode": "fi_standard",
    "publicName": "🇫🇮 Finland",
    "locationCode": "FI",
    "planCode": "standard",
    "weight": 1,
    "maxUsers": 300,
    "status": "active",
    "assignedUsers": 42,
    "createdAt": "2026-05-18T09:00:00.000Z",
    "updatedAt": "2026-05-18T09:00:00.000Z"
  }
]
```

`status`: `active`, `draining`, `disabled`, `dead`.

## PATCH `/api/topor-balancer/nodes/:id`

Обновляет поля ноды.

Пример тела:

```json
{
  "weight": 2,
  "maxUsers": 500,
  "status": "draining",
  "publicName": "🇫🇮 Finland"
}
```

Все поля необязательные. Разрешены только:

- `weight` - число больше `0`;
- `maxUsers` - целое число от `1`;
- `status` - `active`, `draining`, `disabled`, `dead`;
- `publicName` - непустая строка.

Ответ: обновленная нода.

## POST `/api/topor-balancer/nodes/:id/drain`

Ставит ноде статус `draining`.

Тело не нужно. Ответ: обновленная нода.

## POST `/api/topor-balancer/nodes/:id/enable`

Ставит ноде статус `active`.

Тело не нужно. Ответ: обновленная нода.

## POST `/api/topor-balancer/nodes/:id/disable`

Ставит ноде статус `disabled`.

Тело не нужно. Ответ: обновленная нода.

## GET `/api/topor-balancer/assignments`

Возвращает до 500 назначений, самые свежие сверху.

Query-параметры:

- `shortUuid`;
- `publicHostCode`;
- `planCode`;
- `nodeId`.

Все параметры необязательные и фильтруют результат точным совпадением.

Пример:

```text
/api/topor-balancer/assignments?shortUuid=abc123&publicHostCode=fi_standard
```

Пример ответа:

```json
[
  {
    "id": "uuid",
    "shortUuid": "abc123",
    "publicHostCode": "fi_standard",
    "planCode": "standard",
    "nodeId": "node-uuid",
    "technicalHostName": "FI-STD-01",
    "createdAt": "2026-05-18T09:00:00.000Z",
    "updatedAt": "2026-05-18T09:00:00.000Z"
  }
]
```

## POST `/api/topor-balancer/reassign`

Вручную назначает пользователя на конкретную техническую ноду.

Пример тела:

```json
{
  "shortUuid": "abc123",
  "publicHostCode": "fi_standard",
  "planCode": "standard",
  "technicalHostName": "FI-STD-01"
}
```

Правила:

- все поля обязательны;
- целевая нода должна существовать;
- у целевой ноды должны совпадать `publicHostCode` и `planCode`;
- целевая нода должна быть `active`;
- переназначение на `draining`, `disabled` или `dead` отклоняется.

Ответ: созданное или обновленное назначение.

## GET `/api/topor-balancer/requests`

Возвращает до 500 последних записанных запросов.

Query-параметры:

- `shortUuid` - необязательный фильтр.

Пример ответа:

```json
[
  {
    "id": "uuid",
    "shortUuid": "abc123",
    "userAgent": "v2rayNG/1.9.0",
    "responseFormat": "base64_links",
    "inputLinksCount": 8,
    "outputLinksCount": 3,
    "status": "ok",
    "errorMessage": null,
    "createdAt": "2026-05-18T09:00:00.000Z"
  }
]
```

Запросы записываются при обработке подписки в database mode.

## Типовые ошибки

- `400 Bad Request` - неверное тело запроса или небезопасное ручное переназначение.
- `401 Unauthorized` - нет Bearer token или токен неверный.
- `404 Not Found` - Admin API отключен из-за пустого `TOPOR_BALANCER_ADMIN_TOKEN`, либо нода не найдена.
- `503 Service Unavailable` - PostgreSQL недоступен или не настроен.

## Пример curl

```bash
curl -H "Authorization: Bearer <admin-token>" \
  https://subscription.example.com/api/topor-balancer/health
```

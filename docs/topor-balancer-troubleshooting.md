# Troubleshooting Remnawave Balancer by TopoR

## `error from registry: denied`

Причина: старый compose пытался скачать приватный или несуществующий GHCR image.

Исправление:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

## `ERESOLVE could not resolve`

Причина: peer-конфликт frontend dev tooling: `eslint-config-airbnb-base@15` ожидает ESLint 7/8, а проект использует ESLint 9.

Исправление уже в Dockerfile: build stage использует `npm ci --legacy-peer-deps`. На хосте ничего делать не нужно.

## `"/frontend/dist": not found`

Причина: старый Dockerfile ожидал frontend, собранный на хосте.

Исправление:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml build --no-cache
docker compose -f examples/docker-compose.topor-balancer.yml up -d
```

## `node: command not found` или `npm: command not found`

Node.js и npm на сервере не нужны. Сборка идет внутри Docker.

## Admin UI пустой

Это нормально для первого запуска database mode. Откройте `/admin/topor-balancer`, нажмите `Add node` и добавьте первую группу/ноду.

## Admin API возвращает 404

Чаще всего не задан `TOPOR_BALANCER_ADMIN_TOKEN`. Заполните `.env` и перезапустите контейнер.

## Admin API возвращает 401

Неверный Bearer token.

```bash
curl -H "Authorization: Bearer <admin-token>" http://127.0.0.1:3011/api/topor-balancer/health
```

## Порт занят

Если Docker пишет `port is already allocated`, проверьте занятые порты:

```bash
ss -ltnp | grep ':3010'
docker ps --format "table {{.Names}}\t{{.Ports}}"
```

Обычно достаточно изменить внешний порт:

```env
TOPOR_BALANCER_HOST_PORT=3011
```

`APP_PORT` обычно оставляют `3010`.

## Database offline

Проверьте, что compose поднял PostgreSQL:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml logs -f topor-balancer-postgres
```

Строка подключения по умолчанию:

```env
TOPOR_BALANCER_DATABASE_URL=postgres://topor_balancer:change_me@topor-balancer-postgres:5432/topor_balancer
```

## Hash mode без JSON не работает

Это ожидаемо. Hash mode не использует БД, поэтому ему нужен `topor-balancer.config.json`.

## `technicalHostName` не совпадает с VLESS remark

Balancer сопоставляет техническую ноду по remark после `#`:

```text
vless://...#FI-STD-01
```

В UI или JSON должно быть:

```text
FI-STD-01
```

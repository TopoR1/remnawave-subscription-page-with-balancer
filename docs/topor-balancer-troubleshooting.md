# Troubleshooting Remnawave Balancer by TopoR

## `error from registry: denied`

Старый compose пытался скачать приватный или несуществующий GHCR image.

```bash
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

## `ERESOLVE could not resolve`

Peer-конфликт frontend dev tooling уже обработан в Dockerfile через `npm ci --legacy-peer-deps`. Node.js/npm на хосте не нужны.

## `"/frontend/dist": not found`

Старый Dockerfile ожидал frontend, собранный на хосте.

```bash
docker compose -f examples/docker-compose.topor-balancer.yml build --no-cache
docker compose -f examples/docker-compose.topor-balancer.yml up -d
```

## `wget: bad address 'remnawave-subscription-page-with-balancer:3010'`

Причина: Caddy container и Balancer container находятся в разных Docker networks, поэтому Caddy не может резолвить имя `remnawave-subscription-page-with-balancer`.

Найдите Docker network Caddy:

```bash
docker inspect caddy --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}'
```

Вариант 1: подключить уже запущенный контейнер вручную:

```bash
docker network connect <network_name> remnawave-subscription-page-with-balancer
docker exec caddy sh -c "wget -S -O- --timeout=5 http://remnawave-subscription-page-with-balancer:3010/admin/topor-balancer 2>&1 | head -80"
```

Вариант 2: указать сеть в `.env` и перезапустить compose:

```env
REMNAWAVE_DOCKER_NETWORK=<network_name>
```

```bash
docker compose -f examples/docker-compose.topor-balancer.yml up -d
```

## Черный экран в Admin UI и 502 на `/assets/*`

Чаще всего Caddy не может достучаться до Balancer или не может резолвить имя контейнера.

Проверьте, что frontend файлы есть внутри Balancer:

```bash
docker exec remnawave-subscription-page-with-balancer sh -c "find /opt/app -maxdepth 4 -type f | grep -E 'index.html|assets|favicon' | head -100"
```

Проверьте доступ из Caddy container:

```bash
docker exec caddy sh -c "wget -S -O- --timeout=5 http://remnawave-subscription-page-with-balancer:3010/admin/topor-balancer 2>&1 | head -80"
docker exec caddy sh -c "wget -S -O- --timeout=5 http://remnawave-subscription-page-with-balancer:3010/assets/<asset> 2>&1 | head -80"
```

Рабочий Caddyfile для Docker Caddy:

```caddy
subs.example.com {
    reverse_proxy remnawave-subscription-page-with-balancer:3010 {
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-Host {host}
        header_up X-Real-IP {remote_host}
    }
}
```

Специальные Caddy routes для `/assets/*` не нужны.

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

```bash
docker compose -f examples/docker-compose.topor-balancer.yml logs -f topor-balancer-postgres
```

Строка подключения по умолчанию:

```env
TOPOR_BALANCER_DATABASE_URL=postgres://topor_balancer:change_me@topor-balancer-postgres:5432/topor_balancer
```

## PostgreSQL не принимает пароль

В логах:

```text
FATAL: password authentication failed for user "topor_balancer"
TopoR balancer database startup initialization failed
TopoR balancer will fail open with original responses.
```

PostgreSQL создает пользователя и пароль только при первом создании Docker volume. Если позже поменять `POSTGRES_PASSWORD` или пароль в `TOPOR_BALANCER_DATABASE_URL`, существующий volume сохранит старый пароль.

Сравните env:

```bash
docker exec remnawave-subscription-page-with-balancer printenv | grep -E "TOPOR_BALANCER_DATABASE_URL|POSTGRES"
docker exec topor-balancer-postgres printenv | grep -E "POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB"
docker compose -f examples/docker-compose.topor-balancer.yml config
```

Для тестового стенда можно пересоздать volume:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml down
docker volume rm examples_topor-balancer-postgres-data
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

Для production не удаляйте volume, если важны assignments. Обновите пароль через `ALTER USER` или верните старый пароль в `TOPOR_BALANCER_DATABASE_URL`.

## Hash mode без JSON не работает

Hash mode не использует БД, поэтому ему нужен `topor-balancer.config.json`.

## `technicalHostName` не совпадает с VLESS remark

```text
vless://...#FI-STD-01
```

В UI или JSON должно быть:

```text
FI-STD-01
```

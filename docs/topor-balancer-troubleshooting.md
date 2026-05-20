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

## Черный экран в Admin UI и 502 на `/assets/*`

Симптомы:

```text
https://subs.example.com/admin/topor-balancer открывается
/assets/index-*.css -> 502
/assets/index-*.js -> 502
/assets/favicon.svg -> 502
```

Это значит, что домен и TLS уже работают, но frontend assets не отдаются backend-ом или Caddy не может достучаться до upstream.

Проверьте файлы внутри app container:

```bash
docker exec remnawave-subscription-page-with-balancer sh -c "find /opt/app -maxdepth 4 -type f | grep -E 'index.html|assets|favicon' | head -80"
```

Проверьте Admin UI и один реальный asset через домен:

```bash
curl -vk https://subs.example.com/admin/topor-balancer
curl -vk https://subs.example.com/assets/<real-asset-file>
```

Если Caddy в Docker, проверьте доступ к backend из Caddy container:

```bash
docker exec caddy wget -S -O- --timeout=5 http://remnawave-subscription-page-with-balancer:3010/admin/topor-balancer 2>&1 | head -80
```

Caddy и Balancer должны быть в одной Docker network. Рабочий upstream:

```caddy
subs.example.com {
    reverse_proxy remnawave-subscription-page-with-balancer:3010 {
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-Host {host}
        header_up X-Real-IP {remote_host}
    }
}
```

Специальные Caddy routes для `/assets/*` не нужны: backend должен отдавать `/assets/*` сам.

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

## PostgreSQL не принимает пароль

В логах приложения:

```text
FATAL: password authentication failed for user "topor_balancer"
TopoR balancer database startup initialization failed
TopoR balancer will fail open with original responses.
```

Причина: PostgreSQL создает пользователя и пароль только при первом создании Docker volume. Если позже поменять `POSTGRES_PASSWORD` или пароль в `TOPOR_BALANCER_DATABASE_URL`, существующий volume сохранит старый пароль. Приложение не сможет подключиться, и database mode не будет работать.

Проверьте, что значения согласованы:

```env
POSTGRES_USER=topor_balancer
POSTGRES_PASSWORD=change_me
POSTGRES_DB=topor_balancer
TOPOR_BALANCER_DATABASE_URL=postgres://topor_balancer:change_me@topor-balancer-postgres:5432/topor_balancer
```

Сравните переменные внутри контейнеров:

```bash
docker exec remnawave-subscription-page-with-balancer printenv | grep -E "TOPOR_BALANCER_DATABASE_URL|POSTGRES"
docker exec topor-balancer-postgres printenv | grep -E "POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB"
```

Посмотрите итоговый compose после подстановки `.env`:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml config
```

Для тестового стенда можно пересоздать volume:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml down
docker volume rm examples_topor-balancer-postgres-data
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

Для production не удаляйте volume, если важны assignments. Безопасные варианты:

- обновить пароль пользователя внутри PostgreSQL через `ALTER USER`;
- или вернуть пароль в `TOPOR_BALANCER_DATABASE_URL` к тому, который уже сохранен в базе.

Если меняете пароль после первого запуска, пересоздайте volume только на тестовом стенде или обновите пароль в БД вручную.

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

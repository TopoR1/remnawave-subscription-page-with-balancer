# Переменные окружения TopoR Balancer

Основной файл для Docker Compose: `.env` в корне проекта.

```bash
cp examples/topor-balancer.env.example .env
```

## Минимум для рекомендуемого database mode

```env
APP_PORT=3010
TOPOR_BALANCER_HOST_BIND=127.0.0.1
TOPOR_BALANCER_HOST_PORT=3011
REMNAWAVE_DOCKER_NETWORK=remnawave-network
POSTGRES_USER=topor_balancer
POSTGRES_PASSWORD=change_me
POSTGRES_DB=topor_balancer
REMNAWAVE_PANEL_URL=https://panel.example.com
REMNAWAVE_API_TOKEN=replace_me
INTERNAL_JWT_SECRET=replace_me_long_random_secret
TOPOR_BALANCER_ENABLED=true
TOPOR_BALANCER_ASSIGNMENT_MODE=database
TOPOR_BALANCER_DATABASE_URL=postgres://topor_balancer:change_me@topor-balancer-postgres:5432/topor_balancer
TOPOR_BALANCER_DB_FALLBACK_TO_HASH=false
TOPOR_BALANCER_ADMIN_TOKEN=replace_me_long_random_admin_token
```

## Основные переменные

| Переменная | Пример | Что делает |
| --- | --- | --- |
| `APP_PORT` | `3010` | Порт приложения внутри контейнера. |
| `TOPOR_BALANCER_HOST_BIND` | `127.0.0.1` | Адрес на сервере, куда Docker публикует порт. |
| `TOPOR_BALANCER_HOST_PORT` | `3011` | Внешний порт на сервере. |
| `REMNAWAVE_DOCKER_NETWORK` | `remnawave-network` | Внешняя Docker network, где находится Caddy container. |
| `POSTGRES_USER` | `topor_balancer` | Пользователь PostgreSQL, создается при первом создании volume. |
| `POSTGRES_PASSWORD` | `change_me` | Пароль PostgreSQL, должен совпадать с паролем в `TOPOR_BALANCER_DATABASE_URL`. |
| `POSTGRES_DB` | `topor_balancer` | Имя базы PostgreSQL. |
| `REMNAWAVE_PANEL_URL` | `https://panel.example.com` | URL Remnawave Panel. |
| `REMNAWAVE_API_TOKEN` | `replace_me` | API token Remnawave. |
| `INTERNAL_JWT_SECRET` | `long_random_secret` | Секрет внутренних JWT/cookie механизмов. |
| `TOPOR_BALANCER_ENABLED` | `true` | Включает balancer. |
| `TOPOR_BALANCER_ASSIGNMENT_MODE` | `database` | `database` или `hash`. |
| `TOPOR_BALANCER_DATABASE_URL` | `postgres://...` | PostgreSQL для database mode. |
| `TOPOR_BALANCER_DB_FALLBACK_TO_HASH` | `false` | При ошибке БД пытаться fallback в hash mode. Для UI-only setup обычно `false`. |
| `TOPOR_BALANCER_ADMIN_TOKEN` | `long_random_token` | Bearer token для Admin UI/API. Если пустой, Admin API отвечает `404`. |
| `TOPOR_BALANCER_DEBUG` | `false` | Подробные диагностические логи. |

## Опциональные JSON-переменные

Для обычной настройки через Admin UI они не нужны.

| Переменная | Пример | Что делает |
| --- | --- | --- |
| `TOPOR_BALANCER_CONFIG_PATH` | `/opt/app/topor-balancer.config.json` | Путь к JSON-конфигу внутри контейнера. |
| `TOPOR_BALANCER_IMPORT_CONFIG_ON_START` | `false` | Импортировать JSON в БД при старте. |

## Hash mode

Hash mode не использует БД, поэтому ему нужен JSON-конфиг:

```env
TOPOR_BALANCER_ASSIGNMENT_MODE=hash
TOPOR_BALANCER_CONFIG_PATH=/opt/app/topor-balancer.config.json
TOPOR_BALANCER_DB_FALLBACK_TO_HASH=true
```

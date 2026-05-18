# Переменные окружения TopoR Balancer

Основной файл для Docker Compose в этом репозитории: `.env` в корне проекта.

Создать его можно так:

```bash
cp examples/topor-balancer.env.example .env
```

## Минимум для запуска

```env
APP_PORT=3010

REMNAWAVE_PANEL_URL=https://panel.example.com
REMNAWAVE_API_TOKEN=replace_me
INTERNAL_JWT_SECRET=replace_me_long_random_secret

TOPOR_BALANCER_ENABLED=true
TOPOR_BALANCER_ASSIGNMENT_MODE=hash
TOPOR_BALANCER_CONFIG_PATH=/opt/app/topor-balancer.config.json
TOPOR_BALANCER_ADMIN_TOKEN=replace_me_long_random_admin_token
TOPOR_BALANCER_DB_FALLBACK_TO_HASH=true
```

## Основные переменные Remnawave Subscription Page

| Переменная                                  | Обязательна               | Пример                                 | Что делает                                                           |
| ------------------------------------------- | ------------------------- | -------------------------------------- | -------------------------------------------------------------------- |
| `APP_PORT`                                  | нет                       | `3010`                                 | Порт backend внутри контейнера.                                      |
| `REMNAWAVE_PANEL_URL`                       | да                        | `https://panel.example.com`            | URL Remnawave Panel.                                                 |
| `REMNAWAVE_API_TOKEN`                       | да                        | `replace_me`                           | API token из Remnawave Panel.                                        |
| `INTERNAL_JWT_SECRET`                       | да                        | `long_random_secret`                   | Секрет для внутренних JWT/cookie механик Subscription Page.          |
| `SUBPAGE_CONFIG_UUID`                       | нет                       | `00000000-0000-0000-0000-000000000000` | UUID конфига страницы подписки.                                      |
| `CUSTOM_SUB_PREFIX`                         | нет                       | пусто                                  | Дополнительный prefix для подписки, если используется в вашей схеме. |
| `CADDY_AUTH_API_TOKEN`                      | нет                       | пусто                                  | Опциональная интеграция upstream Subscription Page.                  |
| `CLOUDFLARE_ZERO_TRUST_CLIENT_ID`           | нет                       | пусто                                  | Cloudflare Zero Trust client id, если используется.                  |
| `CLOUDFLARE_ZERO_TRUST_CLIENT_SECRET`       | нет                       | пусто                                  | Cloudflare Zero Trust client secret, если используется.              |
| `MARZBAN_LEGACY_LINK_ENABLED`               | нет                       | `false`                                | Поддержка legacy Marzban-ссылок.                                     |
| `MARZBAN_LEGACY_SECRET_KEY`                 | только для legacy Marzban | пусто                                  | Secret key для legacy Marzban.                                       |
| `MARZBAN_LEGACY_SUBSCRIPTION_VALID_FROM`    | нет                       | пусто                                  | Минимальная дата валидности legacy Marzban-подписки.                 |
| `MARZBAN_LEGACY_DROP_REVOKED_SUBSCRIPTIONS` | нет                       | `false`                                | Отбрасывать отозванные legacy Marzban-подписки.                      |

## Переменные TopoR Balancer

| Переменная                           | Обязательна       | Пример                                | Что делает                                                                           |
| ------------------------------------ | ----------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| `TOPOR_BALANCER_ENABLED`             | нет               | `true`                                | Включает обработку подписок балансировщиком. По умолчанию `false`.                   |
| `TOPOR_BALANCER_DEBUG`               | нет               | `false`                               | Включает подробные диагностические логи. Для обычного запуска не нужен.              |
| `TOPOR_BALANCER_CONFIG_PATH`         | нет               | `/opt/app/topor-balancer.config.json` | Путь к JSON-конфигу внутри контейнера.                                               |
| `TOPOR_BALANCER_ASSIGNMENT_MODE`     | нет               | `hash`                                | `hash` или `database`. Любое значение кроме `database` работает как `hash`.          |
| `TOPOR_BALANCER_DATABASE_URL`        | да для `database` | `postgres://user:pass@host:5432/db`   | PostgreSQL для database mode.                                                        |
| `TOPOR_BALANCER_DB_FALLBACK_TO_HASH` | нет               | `true`                                | Если БД недоступна в database mode, перейти на hash mode.                            |
| `TOPOR_BALANCER_ADMIN_TOKEN`         | да для админки    | `long_random_token`                   | Bearer token для Admin API и данных Admin UI. Если пустой, Admin API отвечает `404`. |

## Hash mode

```env
TOPOR_BALANCER_ENABLED=true
TOPOR_BALANCER_ASSIGNMENT_MODE=hash
TOPOR_BALANCER_DATABASE_URL=
TOPOR_BALANCER_DB_FALLBACK_TO_HASH=true
```

PostgreSQL не нужен.

## Database mode

```env
TOPOR_BALANCER_ENABLED=true
TOPOR_BALANCER_ASSIGNMENT_MODE=database
TOPOR_BALANCER_DATABASE_URL=postgres://topor_balancer:change_me@topor-balancer-postgres:5432/topor_balancer
TOPOR_BALANCER_DB_FALLBACK_TO_HASH=true
```

Для Docker Compose из этого репозитория запускайте database profile:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml --profile database up -d
```

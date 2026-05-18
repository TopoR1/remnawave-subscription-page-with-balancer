# Расширенный деплой Remnawave Balancer by TopoR

Основной способ запуска описан в README. Здесь собраны детали для Docker Compose, PostgreSQL и production-переключения.

Балансировщик работает fail-open: если обработка подписки ломается, backend возвращает оригинальный ответ Remnawave.

## Файлы

- `.env` - переменные окружения для контейнера.
- `topor-balancer.config.json` - конфиг групп и технических нод.
- `examples/docker-compose.topor-balancer.yml` - пример Docker Compose.
- `docs/topor-balancer-reverse-proxy.md` - примеры reverse proxy.

## Подготовка файлов

Из корня проекта:

```bash
cp examples/topor-balancer.env.example .env
cp examples/topor-balancer.config.example.json topor-balancer.config.json
```

На Windows PowerShell:

```powershell
Copy-Item examples/topor-balancer.env.example .env
Copy-Item examples/topor-balancer.config.example.json topor-balancer.config.json
```

В Compose-примере пути настроены так:

```yaml
env_file:
  - ../.env
volumes:
  - ../topor-balancer.config.json:/opt/app/topor-balancer.config.json:ro
```

Поэтому `.env` и `topor-balancer.config.json` должны лежать в корне репозитория, если вы запускаете именно `examples/docker-compose.topor-balancer.yml`.

## Hash mode

Первый запуск лучше делать в `hash` mode:

```env
TOPOR_BALANCER_ENABLED=true
TOPOR_BALANCER_ASSIGNMENT_MODE=hash
TOPOR_BALANCER_CONFIG_PATH=/opt/app/topor-balancer.config.json
TOPOR_BALANCER_DB_FALLBACK_TO_HASH=true
```

Запуск:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml up -d
```

Особенности:

- PostgreSQL не нужен;
- выбор стабилен для одного `shortUuid`, пока не меняется состав группы;
- используются только `active` ноды;
- реальные назначения не сохраняются.

## Database mode

Database mode подходит для production, когда нужны сохраненные назначения, список запросов и управление через Admin UI.

В `.env`:

```env
TOPOR_BALANCER_ASSIGNMENT_MODE=database
TOPOR_BALANCER_DATABASE_URL=postgres://topor_balancer:change_me@topor-balancer-postgres:5432/topor_balancer
TOPOR_BALANCER_DB_FALLBACK_TO_HASH=true
```

Пароль `change_me` в `TOPOR_BALANCER_DATABASE_URL` должен совпадать с `POSTGRES_PASSWORD` в `examples/docker-compose.topor-balancer.yml`.

Запуск:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml --profile database up -d
```

Backend сам создает таблицы:

- `topor_balancer_nodes`;
- `topor_balancer_assignments`;
- `topor_balancer_requests`.

## Проверка

Подписку проверяйте с небраузерным User-Agent:

```bash
curl -A "v2rayNG/1.9.0" "https://sub.example.com/<shortUuid>"
```

Admin UI:

```text
https://sub.example.com/admin/topor-balancer
```

Admin API:

```bash
curl -H "Authorization: Bearer <admin-token>" \
  "https://sub.example.com/api/topor-balancer/health"
```

## Production-порядок

1. Поднимите сервис на тестовом домене, например `test-sub.example.com`.
2. Проверьте обычную подписку с `TOPOR_BALANCER_ENABLED=false`.
3. Включите `hash` mode и проверьте несколько пользователей.
4. Настройте `database` mode, если он нужен.
5. Проверьте Admin UI, статусы нод и ручной `reassign`.
6. Переключите основной reverse proxy на новый контейнер.

## Reverse proxy

Минимально:

```caddy
sub.example.com {
    reverse_proxy 127.0.0.1:3010
}
```

Для production дополнительно защитите:

```text
/admin/topor-balancer
/api/topor-balancer
```

Примеры Caddy/Nginx: `docs/topor-balancer-reverse-proxy.md`.

## Rollback

Быстрый rollback:

```env
TOPOR_BALANCER_ENABLED=false
```

Затем:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml restart
```

Другие варианты:

- вернуть image на оригинальный `remnawave/subscription-page`;
- вернуть reverse proxy на старый контейнер;
- оставить PostgreSQL как есть: таблицы TopoR не меняют данные Remnawave Panel.

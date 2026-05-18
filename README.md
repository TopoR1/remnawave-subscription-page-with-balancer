# Remnawave Balancer by TopoR (TEST)

## Что это

Это форк [`remnawave/subscription-page`](https://github.com/remnawave/subscription-page). Он ставится вместо обычного Remnawave Subscription Page и добавляет балансировку между техническими нодами внутри одной публичной локации.

Пользователи продолжают использовать обычную ссылку подписки. Клиентские приложения менять не нужно.

## Как работает

Remnawave возвращает технические ноды:

- `FI-STD-01`
- `FI-STD-02`
- `FI-STD-03`

Пользователь видит:

- `🇫🇮 Finland`

Внутри:

- пользователь A может быть назначен на `FI-STD-01`;
- пользователь B может быть назначен на `FI-STD-02`.

`technicalHostName` - внутреннее имя ноды из VLESS remark после `#`. `publicName` - имя, которое видит пользователь.

## Быстрый запуск через Docker Compose

### 1. Скачать проект

```bash
git clone https://github.com/TopoR1/remnawave-subscription-page-with-balancer.git
cd remnawave-subscription-page-with-balancer
```

### 2. Создать `.env`

```bash
cp examples/topor-balancer.env.example .env
```

Минимальный `.env` для первого запуска в `hash` mode:

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

Что обязательно заменить:

- `REMNAWAVE_PANEL_URL` - URL вашего Remnawave Panel.
- `REMNAWAVE_API_TOKEN` - API token из Remnawave.
- `INTERNAL_JWT_SECRET` - длинная случайная строка.
- `TOPOR_BALANCER_ADMIN_TOKEN` - пароль/токен для Admin UI и Admin API.

Полный список env: [docs/topor-balancer-env.md](docs/topor-balancer-env.md).

### 3. Создать конфиг балансировщика

```bash
cp examples/topor-balancer.config.example.json topor-balancer.config.json
```

Минимальный `topor-balancer.config.json`:

```json
{
  "enabled": true,
  "locations": [
    {
      "publicHostCode": "fi_standard",
      "publicName": "🇫🇮 Finland",
      "locationCode": "FI",
      "planCode": "standard",
      "nodes": [
        {
          "technicalHostName": "FI-STD-01",
          "weight": 1,
          "maxUsers": 300,
          "status": "active"
        },
        {
          "technicalHostName": "FI-STD-02",
          "weight": 1,
          "maxUsers": 300,
          "status": "active"
        }
      ]
    }
  ]
}
```

Очень важно: `technicalHostName` должен точно совпадать с именем VLESS-ссылки после `#`.

Если Remnawave отдает:

```text
vless://...#FI-STD-01
```

то в конфиге должно быть:

```json
"technicalHostName": "FI-STD-01"
```

### 4. Запустить

```bash
docker compose -f examples/docker-compose.topor-balancer.yml up -d
```

Логи:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml logs -f
```

Если Docker пишет, что сети `remnawave-network` нет, создайте ее:

```bash
docker network create remnawave-network
```

### 5. Открыть админку

```text
https://sub.example.com/admin/topor-balancer
```

Введите `TOPOR_BALANCER_ADMIN_TOKEN`, затем проверьте:

- Health;
- Nodes;
- Assignments;
- Requests.

### 6. Проверить подписку

```bash
curl -A "v2rayNG/1.9.0" "https://sub.example.com/<shortUuid>"
```

Если ответ в base64:

```bash
curl -A "v2rayNG/1.9.0" "https://sub.example.com/<shortUuid>" | base64 -d
```

Ожидаемый результат: вместо нескольких технических ссылок для одной локации пользователь получает одну выбранную публичную локацию.

## Запуск в database mode

`hash` mode хорошо подходит для первого запуска. `database` mode лучше для production: он хранит реальные назначения и делает Admin UI полезнее.

В `.env` добавьте/измените:

```env
TOPOR_BALANCER_ASSIGNMENT_MODE=database
TOPOR_BALANCER_DATABASE_URL=postgres://topor_balancer:change_me@topor-balancer-postgres:5432/topor_balancer
```

Пароль `change_me` должен совпадать с `POSTGRES_PASSWORD` в `examples/docker-compose.topor-balancer.yml`.

Запуск с PostgreSQL:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml --profile database up -d
```

Подробнее: [docs/topor-balancer-deployment.md](docs/topor-balancer-deployment.md).

## Как подключить домен

Простой пример Caddy:

```caddy
sub.example.com {
    reverse_proxy 127.0.0.1:3010
}
```

Более безопасный пример с дополнительной защитой админки:

```caddy
sub.example.com {
    @admin path /admin/topor-balancer* /api/topor-balancer*
    basicauth @admin {
        admin <bcrypt_hash>
    }

    reverse_proxy 127.0.0.1:3010
}
```

Admin API уже требует Bearer token. Защита на reverse proxy рекомендуется как дополнительный слой.

## Статусы нод

- `active` - можно выдавать новым и старым пользователям.
- `draining` - старые остаются, новые не назначаются.
- `disabled` - не используется.
- `dead` - аварийно не используется, пользователи переназначаются при возможности.

## Как обновить конфиг

1. Отредактируйте `topor-balancer.config.json`.
2. Перезапустите контейнер:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml restart
```

В `hash` mode изменение нод может изменить назначения. В `database` mode существующие назначения сохраняются там, где это возможно.

## Как отключить балансировщик

В `.env`:

```env
TOPOR_BALANCER_ENABLED=false
```

Затем:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml restart
```

После этого проект будет работать ближе к обычному Remnawave Subscription Page.

## Rollback

- Поставьте `TOPOR_BALANCER_ENABLED=false` и перезапустите контейнер.
- Или переключите image/container обратно на оригинальный `remnawave/subscription-page`.
- Или верните reverse proxy на старый Subscription Page контейнер.

## Где читать подробнее

- [docs/topor-balancer-config.md](docs/topor-balancer-config.md) - поля конфига и примеры.
- [docs/topor-balancer-env.md](docs/topor-balancer-env.md) - все переменные окружения.
- [docs/topor-balancer-deployment.md](docs/topor-balancer-deployment.md) - расширенный Docker/PostgreSQL деплой.
- [docs/topor-balancer-ui.md](docs/topor-balancer-ui.md) - работа с Admin UI.
- [docs/topor-balancer-admin-api.md](docs/topor-balancer-admin-api.md) - маршруты Admin API.
- [docs/topor-balancer-troubleshooting.md](docs/topor-balancer-troubleshooting.md) - частые проблемы.

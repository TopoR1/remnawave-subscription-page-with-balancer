# Remnawave Balancer by TopoR

Форк `remnawave/subscription-page` с балансировкой пользователей между техническими нодами одной публичной локации.

Обычный production-сценарий: поставить контейнеры, открыть Admin UI, добавить группы и ноды. JSON-конфиг для этого не нужен.

## Быстрый запуск

### Требования

- Docker
- Docker Compose plugin

Не нужны Node.js, npm, pnpm/yarn, ручная сборка frontend/backend, `docker login` в GHCR и заранее опубликованный image.

### 1. Скачать проект

```bash
git clone https://github.com/TopoR1/remnawave-subscription-page-with-balancer.git
cd remnawave-subscription-page-with-balancer
```

### 2. Создать `.env`

```bash
cp examples/topor-balancer.env.example .env
```

Минимально проверьте и замените:

```env
APP_PORT=3010
REMNAWAVE_PANEL_URL=https://panel.example.com
REMNAWAVE_API_TOKEN=replace_me
INTERNAL_JWT_SECRET=replace_me_long_random_secret
TOPOR_BALANCER_ENABLED=true
TOPOR_BALANCER_ASSIGNMENT_MODE=database
TOPOR_BALANCER_DATABASE_URL=postgres://topor_balancer:change_me@topor-balancer-postgres:5432/topor_balancer
TOPOR_BALANCER_DB_FALLBACK_TO_HASH=false
TOPOR_BALANCER_ADMIN_TOKEN=replace_me_long_random_admin_token
```

### 3. Запустить

```bash
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

Compose сам поднимет PostgreSQL и локально соберет image из исходников.

### 4. Открыть Admin UI

Если используете reverse proxy:

```text
https://sub.example.com/admin/topor-balancer
```

Локально на сервере:

```text
http://127.0.0.1:3010/admin/topor-balancer
```

Если нужно открыть порт напрямую по IP сервера, измените в compose `127.0.0.1:3010:3010` на `3010:3010`, затем откройте:

```text
http://server-ip:3010/admin/topor-balancer
```

### 5. Добавить первую группу/ноду

В Admin UI нажмите `Add node` и заполните:

- `technicalHostName` - remark технической VLESS-ноды после `#`, например `FI-STD-01`
- `publicHostCode` - код публичной группы, например `fi_standard`
- `publicName` - имя, которое увидит пользователь, например `Finland`
- `locationCode` - опционально, например `FI`
- `planCode` - тариф/план, например `standard`
- `weight`, `maxUsers`, `status`

Для одной публичной локации добавьте несколько нод с одинаковыми `publicHostCode` и `planCode`, но разными `technicalHostName`.

### 6. Логи, health, остановка

```bash
docker compose -f examples/docker-compose.topor-balancer.yml logs -f
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" http://127.0.0.1:3010/api/topor-balancer/health
docker compose -f examples/docker-compose.topor-balancer.yml down
```

### 7. Обновление

```bash
git pull
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

## Опционально: JSON-конфиг и hash mode

JSON-конфиг больше не нужен для обычной database/Admin UI установки.

Он полезен только для:

- hash mode без PostgreSQL;
- первичного импорта в БД;
- аварийного статического конфига;
- продвинутых сценариев.

Для hash mode:

```bash
cp examples/topor-balancer.config.example.json topor-balancer.config.json
```

В `.env`:

```env
TOPOR_BALANCER_ASSIGNMENT_MODE=hash
TOPOR_BALANCER_CONFIG_PATH=/opt/app/topor-balancer.config.json
TOPOR_BALANCER_DB_FALLBACK_TO_HASH=true
```

И добавьте bind mount в сервис приложения:

```yaml
volumes:
  - ../topor-balancer.config.json:/opt/app/topor-balancer.config.json:ro
```

Для одноразового импорта JSON в database mode:

```env
TOPOR_BALANCER_IMPORT_CONFIG_ON_START=true
TOPOR_BALANCER_CONFIG_PATH=/opt/app/topor-balancer.config.json
```

Важно: импорт синхронизирует поля нод из JSON в БД. Не включайте его постоянно, если управляете нодами из UI.

## Частые ошибки установки

### `error from registry: denied`

Старый compose пытался скачать приватный или несуществующий GHCR image. Используйте локальную сборку:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

### `"/frontend/dist": not found`

Старый Dockerfile ожидал frontend, собранный на хосте. В актуальном Dockerfile frontend собирается внутри Docker:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml build --no-cache
```

### `ERESOLVE could not resolve`

Во frontend dev-зависимостях есть peer-конфликт ESLint 9 и `eslint-config-airbnb-base`. Dockerfile использует `npm ci --legacy-peer-deps` в build stage. Production build это не меняет: ESLint не участвует в сборке приложения.

### `node: command not found` или `npm: command not found`

Node.js и npm на сервере не нужны. Сборка идет внутри Docker.

## Документация

- [Переменные окружения](docs/topor-balancer-env.md)
- [JSON-конфиг и hash mode](docs/topor-balancer-config.md)
- [Deployment](docs/topor-balancer-deployment.md)
- [Admin UI](docs/topor-balancer-ui.md)
- [Admin API](docs/topor-balancer-admin-api.md)
- [Troubleshooting](docs/topor-balancer-troubleshooting.md)
- [Разработка и проверки](docs/topor-balancer-development.md)

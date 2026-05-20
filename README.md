# Remnawave Balancer by TopoR

Форк `remnawave/subscription-page` с балансировкой пользователей между техническими нодами одной публичной локации.

Пользователь продолжает получать обычную ссылку подписки, а внутри balancer оставляет только одну подходящую VLESS-ноду из группы. Например, Remnawave отдает `FI-STD-01`, `FI-STD-02`, `FI-STD-03`, а пользователь видит одну публичную локацию `Finland`.

## Быстрый запуск

### Требования

- Docker
- Docker Compose plugin

Не нужны:

- Node.js на сервере
- npm, pnpm или yarn на сервере
- ручная сборка frontend/backend
- `docker login` в GHCR
- заранее опубликованный Docker image

### 1. Скачать проект

```bash
git clone https://github.com/TopoR1/remnawave-subscription-page-with-balancer.git
cd remnawave-subscription-page-with-balancer
```

### 2. Создать `.env`

```bash
cp examples/topor-balancer.env.example .env
```

Минимально проверьте и замените значения:

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

### 3. Создать конфиг

```bash
cp examples/topor-balancer.config.example.json topor-balancer.config.json
```

Отредактируйте `topor-balancer.config.json`. Поле `technicalHostName` должно точно совпадать с remark в VLESS-ссылке после `#`.

Если Remnawave отдает:

```text
vless://...#FI-STD-01
```

то в конфиге должно быть:

```json
"technicalHostName": "FI-STD-01"
```

### 4. Запуск в hash mode без PostgreSQL

```bash
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

### 5. Запуск в database mode с PostgreSQL

В `.env` измените или добавьте:

```env
TOPOR_BALANCER_ASSIGNMENT_MODE=database
TOPOR_BALANCER_DATABASE_URL=postgres://topor_balancer:change_me@topor-balancer-postgres:5432/topor_balancer
```

Запустите compose с profile `database`:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml --profile database up -d --build
```

### 6. Логи

```bash
docker compose -f examples/docker-compose.topor-balancer.yml logs -f
```

### 7. Admin UI

По умолчанию compose публикует порт только на `127.0.0.1`:

```text
http://127.0.0.1:3010/admin/topor-balancer
```

За доменом или reverse proxy:

```text
https://sub.example.com/admin/topor-balancer
```

Если хотите открыть порт напрямую по IP сервера, измените `127.0.0.1:3010:3010` на `3010:3010` в `examples/docker-compose.topor-balancer.yml`.

После этого Admin UI будет доступен так:

```text
http://server-ip:3010/admin/topor-balancer
```

### 8. Health check

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" http://127.0.0.1:3010/api/topor-balancer/health
```

### 9. Остановка

```bash
docker compose -f examples/docker-compose.topor-balancer.yml down
```

### 10. Обновление

```bash
git pull
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

## Опционально: prebuilt image

По умолчанию проект собирается локально из исходников. GHCR не нужен.

Опытные пользователи могут заменить `build` на `image: ghcr.io/...` только если сами опубликовали image и имеют доступ к registry.

## Частые ошибки установки

### `error from registry: denied`

Причина: compose пытается скачать приватный или несуществующий GHCR image.

Исправление: используйте локальную сборку:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

### `"/frontend/dist": not found`

Причина: старый Dockerfile ожидал, что frontend уже собран на хосте.

Исправление: используйте обновленный Dockerfile и пересоберите image:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml build --no-cache
```

### `node: command not found` или `npm: command not found`

Причина: старые инструкции требовали ручную сборку на сервере.

Исправление: Node.js и npm на хосте не нужны. Сборка идет внутри Docker. Установите только Docker и Docker Compose plugin.

## Документация

- [Переменные окружения](docs/topor-balancer-env.md)
- [Конфиг балансировщика](docs/topor-balancer-config.md)
- [Расширенный деплой](docs/topor-balancer-deployment.md)
- [Admin UI](docs/topor-balancer-ui.md)
- [Admin API](docs/topor-balancer-admin-api.md)
- [Troubleshooting](docs/topor-balancer-troubleshooting.md)
- [Разработка и проверки](docs/topor-balancer-development.md)

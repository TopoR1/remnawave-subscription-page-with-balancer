# Remnawave Balancer by TopoR

Форк `remnawave/subscription-page` с балансировкой пользователей между техническими нодами одной публичной локации.

Обычный сценарий: установить Docker, запустить Docker Compose, открыть Admin UI, добавить ноды и опубликовать сервис через Caddy. JSON-конфиг для нормальной настройки через UI не нужен.

## Требования

Нужно:

- Ubuntu/Debian сервер или похожий Linux-сервер;
- Docker;
- Docker Compose plugin;
- доступ к Remnawave Panel;
- Remnawave API token;
- домен или поддомен, если сервис нужно открыть публично.

Не нужно:

- Node.js на сервере;
- npm на сервере;
- ручная сборка frontend;
- ручная сборка backend;
- GHCR/docker registry login.

Если Docker уже установлен, пропустите раздел установки Docker.

## Установка Docker

Команды для Ubuntu/Debian:

```bash
apt update
apt install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Проверка:

```bash
docker --version
docker compose version
```

Для других систем используйте официальную документацию Docker.

## Установка Caddy

Caddy не обязателен для локального запуска, но нужен, если вы хотите открыть Balancer через домен и HTTPS.

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
```

Проверка:

```bash
caddy version
systemctl status caddy
```

## Быстрый запуск

### 1. Скачать проект

```bash
git clone https://github.com/TopoR1/remnawave-subscription-page-with-balancer.git
cd remnawave-subscription-page-with-balancer
```

### 2. Создать `.env`

```bash
cp examples/topor-balancer.env.example .env
nano .env
```

Минимальная рекомендуемая настройка для database mode и Admin UI:

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

Пароль в `POSTGRES_PASSWORD` должен совпадать с паролем в `TOPOR_BALANCER_DATABASE_URL`.

Если поменять пароль после первого запуска, существующий Docker volume PostgreSQL сохранит старый пароль. Для тестового стенда проще пересоздать volume, для production - обновить пароль в PostgreSQL через `ALTER USER` или вернуть старый пароль в `TOPOR_BALANCER_DATABASE_URL`.

Проверьте, что compose подставил тот же пароль в PostgreSQL:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml config
```

`APP_PORT` - внутренний порт приложения в контейнере.  
`TOPOR_BALANCER_HOST_PORT` - порт на сервере.  
`REMNAWAVE_DOCKER_NETWORK` - Docker network, где находится Caddy container.

Пример выше означает:

```text
127.0.0.1:3011 на сервере -> 3010 внутри контейнера
```

Если обычный Remnawave Subscription Page уже использует `3010`, оставьте `APP_PORT=3010` и поменяйте только `TOPOR_BALANCER_HOST_PORT`, например на `3011`.

Если Caddy уже работает в Docker, узнайте его сеть и укажите ее в `REMNAWAVE_DOCKER_NETWORK`:

```bash
docker inspect caddy --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}'
```

Если Caddy еще нет, но вы хотите использовать сеть по умолчанию из примера:

```bash
docker network create remnawave-network
```

### 3. Запустить

```bash
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

Compose поднимет приложение, PostgreSQL и локально соберет Docker image из исходников.

### 4. Проверить контейнеры

```bash
docker ps
docker compose -f examples/docker-compose.topor-balancer.yml logs -f
```

### 5. Открыть Admin UI

Локально, если порт открыт наружу:

```text
http://server-ip:3011/admin/topor-balancer
```

Через Caddy:

```text
https://sub.example.com/admin/topor-balancer
```

Введите `TOPOR_BALANCER_ADMIN_TOKEN`.

### 6. Добавить ноды в UI

Откройте вкладку `Nodes`, нажмите `Add node` и заполните:

- `publicHostCode` - код публичной группы, например `fi_standard`;
- `publicName` - имя для пользователя, например `Finland`;
- `locationCode` - код локации, например `FI`;
- `planCode` - план, например `standard`;
- `technicalHostName` - точно как remark в VLESS после `#`;
- `weight`, `maxUsers`, `status`.

Если Remnawave отдает:

```text
vless://...#FI-STD-01
```

то `technicalHostName` должен быть:

```text
FI-STD-01
```

### 7. Проверить подписку

```bash
curl -A "v2rayNG/1.9.0" "https://sub.example.com/<shortUuid>"
```

Если ответ в base64:

```bash
curl -A "v2rayNG/1.9.0" "https://sub.example.com/<shortUuid>" | base64 -d
```

## Публикация через Docker Caddy

Если Caddy работает в Docker, рекомендуемый способ - подключить Balancer к той же Docker network и проксировать по имени контейнера.

Узнайте сеть Caddy:

```bash
docker inspect caddy --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}'
```

Укажите ее в `.env`:

```env
REMNAWAVE_DOCKER_NETWORK=<network_name>
```

Перезапустите compose:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

Проверьте доступ из Caddy container:

```bash
docker exec caddy sh -c "wget -S -O- --timeout=5 http://remnawave-subscription-page-with-balancer:3010/admin/topor-balancer 2>&1 | head -80"
```

Рекомендуемый Caddyfile:

```caddy
sub.example.com {
    reverse_proxy remnawave-subscription-page-with-balancer:3010 {
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-Host {host}
        header_up X-Real-IP {remote_host}
    }
}
```

Если Caddy установлен прямо на хосте, а не в Docker, можно использовать fallback:

```caddy
sub.example.com {
    reverse_proxy 127.0.0.1:3011
}
```

Откройте Caddyfile:

```bash
nano /etc/caddy/Caddyfile
```

Проверьте конфиг и перезагрузите Caddy:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
curl -I https://sub.example.com
```

Важно:

- DNS A-record для `sub.example.com` должен указывать на IP сервера;
- порты `80` и `443` должны быть открыты;
- Caddy сам выпустит HTTPS-сертификат, если DNS настроен правильно;
- если Caddy в Docker, не используйте `127.0.0.1:3011` внутри Caddy container: это localhost самого Caddy container, а не Balancer.

### Дополнительная защита Admin UI/API

Admin API уже требует `TOPOR_BALANCER_ADMIN_TOKEN`. Basic Auth в Caddy - дополнительный слой защиты.

Сгенерируйте bcrypt hash:

```bash
caddy hash-password
```

Пример Caddyfile:

```caddy
sub.example.com {
    @toporAdmin path /admin/topor-balancer* /api/topor-balancer*

    basicauth @toporAdmin {
        admin <bcrypt_hash>
    }

    reverse_proxy remnawave-subscription-page-with-balancer:3010 {
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-Host {host}
        header_up X-Real-IP {remote_host}
    }
}
```

Если включить Basic Auth, браузер сначала спросит логин и пароль, а потом Admin UI попросит `TOPOR_BALANCER_ADMIN_TOKEN`.

## Если порт занят

Ошибка:

```text
Bind for 127.0.0.1:3010 failed: port is already allocated
```

Проверьте занятый порт:

```bash
ss -ltnp | grep ':3010'
docker ps --format "table {{.Names}}\t{{.Ports}}"
```

Обычно нужно менять только внешний порт:

```env
TOPOR_BALANCER_HOST_PORT=3011
```

`APP_PORT` меняйте только если действительно нужно изменить порт внутри контейнера.

## Если Docker build падает

Пересоберите без cache:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml build --no-cache
docker compose -f examples/docker-compose.topor-balancer.yml up -d
```

Если ошибка `registry denied`, значит старый compose пытался тянуть GHCR image. Актуальный compose собирает локально и не требует registry login.

Если ошибка `frontend/dist not found`, значит старый Dockerfile ожидал frontend, собранный на хосте. Актуальный Dockerfile собирает frontend внутри Docker.

Если ошибка `ERESOLVE could not resolve`, обновите Dockerfile из репозитория: frontend build stage использует `npm ci --legacy-peer-deps` для dev-зависимостей ESLint. Node.js/npm на сервере все равно не нужны.

## Если PostgreSQL не принимает пароль

В логах:

```text
FATAL: password authentication failed for user "topor_balancer"
TopoR balancer database startup initialization failed
TopoR balancer will fail open with original responses.
```

PostgreSQL создает пользователя и пароль только при первом создании Docker volume. Если потом изменить `POSTGRES_PASSWORD` или пароль внутри `TOPOR_BALANCER_DATABASE_URL`, старая база продолжит ждать старый пароль.

Сравните env в контейнерах:

```bash
docker exec remnawave-subscription-page-with-balancer printenv | grep -E "TOPOR_BALANCER_DATABASE_URL|POSTGRES"
docker exec topor-balancer-postgres printenv | grep -E "POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB"
docker compose -f examples/docker-compose.topor-balancer.yml config
```

Для тестового стенда можно удалить volume:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml down
docker volume rm examples_topor-balancer-postgres-data
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

Для production не удаляйте volume, если важны assignments. Вместо этого обновите пароль пользователя в PostgreSQL через `ALTER USER` или верните в `TOPOR_BALANCER_DATABASE_URL` старый пароль.

## Обновление и остановка

```bash
git pull
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

```bash
docker compose -f examples/docker-compose.topor-balancer.yml down
```

## JSON-конфиг и hash mode

`topor-balancer.config.json` не нужен для обычной database/Admin UI установки.

Он нужен только для hash mode, импорта в БД или аварийного статического режима. Подробнее: [JSON-конфиг и hash mode](docs/topor-balancer-config.md).

## Разработка

Команды `npm build/test/lint` для разработчиков находятся здесь: [docs/topor-balancer-development.md](docs/topor-balancer-development.md).

## Документация

- [Переменные окружения](docs/topor-balancer-env.md)
- [Deployment](docs/topor-balancer-deployment.md)
- [Admin UI](docs/topor-balancer-ui.md)
- [Admin API](docs/topor-balancer-admin-api.md)
- [Troubleshooting](docs/topor-balancer-troubleshooting.md)
- [Static assets / Admin UI](docs/topor-balancer-asset-serving.md)

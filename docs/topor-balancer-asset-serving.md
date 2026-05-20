# Static assets / Admin UI

Admin UI использует тот же production frontend build, что и Subscription Page.

## Пути в Docker image

Frontend собирается внутри Docker:

```text
frontend/dist
```

В runtime image он копируется сюда:

```text
/opt/app/frontend/index.html
/opt/app/frontend/assets/*
```

Dockerfile дополнительно проверяет, что `index.html` и `assets` существуют. Если frontend build сломан, image не соберется.

## Как backend отдает файлы

В production backend ожидает frontend в:

```text
/opt/app/frontend
```

Ожидаемое поведение:

- `GET /admin/topor-balancer` возвращает `index.html`;
- `GET /admin/topor-balancer/*` возвращает `index.html` для SPA fallback;
- `GET /assets/*` возвращает реальные JS/CSS/favicon/font файлы;
- отсутствующие assets возвращают `404`, а не обрывают соединение;
- `/assets/*` не проходит через subscription proxy logic.

## Проверка внутри контейнера

```bash
docker exec remnawave-subscription-page-with-balancer sh -c "find /opt/app -maxdepth 4 -type f | grep -E 'index.html|assets|favicon' | head -80"
```

## Проверка через Caddy

```bash
curl -vk https://subs.topornet.com/admin/topor-balancer
curl -vk https://subs.topornet.com/assets/<real-asset-file>
```

Из Caddy-контейнера:

```bash
docker exec caddy wget -S -O- --timeout=5 http://remnawave-subscription-page-with-balancer:3010/admin/topor-balancer 2>&1 | head -80
```

Если Caddy работает в Docker, контейнер Caddy и контейнер Balancer должны быть в одной Docker network, иначе имя `remnawave-subscription-page-with-balancer` не будет резолвиться.

Найти сеть Caddy:

```bash
docker inspect caddy --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}'
```

Указать ее в `.env`:

```env
REMNAWAVE_DOCKER_NETWORK=<network_name>
```

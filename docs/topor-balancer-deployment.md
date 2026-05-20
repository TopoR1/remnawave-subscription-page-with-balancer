# Deployment

Рекомендуемый режим - database mode с PostgreSQL и настройкой через Admin UI.

## Установка

```bash
git clone https://github.com/TopoR1/remnawave-subscription-page-with-balancer.git
cd remnawave-subscription-page-with-balancer
cp examples/topor-balancer.env.example .env
nano .env
```

Если Caddy работает в Docker, узнайте его network:

```bash
docker inspect caddy --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}'
```

Укажите сеть в `.env`:

```env
REMNAWAVE_DOCKER_NETWORK=<network_name>
```

Запуск:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

PostgreSQL входит в compose по умолчанию.

## Caddy в Docker

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

Проверка из Caddy container:

```bash
docker exec caddy sh -c "wget -S -O- --timeout=5 http://remnawave-subscription-page-with-balancer:3010/admin/topor-balancer 2>&1 | head -80"
```

Если ответ `bad address`, Caddy и Balancer не в одной Docker network.

## Caddy на хосте

Если Caddy установлен прямо на сервере, а не в Docker, можно проксировать внешний host port:

```caddy
sub.example.com {
    reverse_proxy 127.0.0.1:3011
}
```

Не используйте `127.0.0.1:3011` внутри Docker Caddy: для Caddy container это его собственный localhost.

## Обновление

```bash
git pull
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

## Остановка

```bash
docker compose -f examples/docker-compose.topor-balancer.yml down
```

Чтобы удалить данные PostgreSQL, удаляйте volume вручную только после backup.

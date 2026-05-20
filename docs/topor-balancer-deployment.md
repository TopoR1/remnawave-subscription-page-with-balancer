# Deployment

Рекомендуемый режим - database mode с PostgreSQL и настройкой через Admin UI.

## Установка

```bash
git clone https://github.com/TopoR1/remnawave-subscription-page-with-balancer.git
cd remnawave-subscription-page-with-balancer
cp examples/topor-balancer.env.example .env
```

Отредактируйте `.env`, затем запустите:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

PostgreSQL входит в compose по умолчанию.

## Reverse proxy

Пример Caddy:

```caddy
sub.example.com {
    reverse_proxy 127.0.0.1:3011
}
```

Если Caddy тоже работает в Docker и проксирует по имени контейнера:

```caddy
sub.example.com {
    reverse_proxy remnawave-subscription-page-with-balancer:3010 {
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-Host {host}
        header_up X-Real-IP {remote_host}
    }
}
```

В этом случае Caddy и Balancer должны быть подключены к одной Docker network.

Admin API уже требует Bearer token. Дополнительная защита на reverse proxy рекомендуется.

## Обновление

```bash
git pull
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

## Остановка

```bash
docker compose -f examples/docker-compose.topor-balancer.yml down
```

Чтобы удалить данные PostgreSQL, удалите volume вручную только после backup.

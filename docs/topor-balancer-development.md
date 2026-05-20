# Разработка и проверки TopoR Balancer

Этот файл нужен разработчику. Для обычной установки используйте README и Docker Compose.

## Backend

```bash
cd backend
npm ci
npm run build
npm run test:topor-balancer
npm run lint
```

## Frontend

```bash
cd frontend
npm ci
npm run typecheck
npm run cb
```

## Docker-проверки

```bash
docker compose -f examples/docker-compose.topor-balancer.yml config
docker build -t remnawave-subscription-page-with-balancer:local .
```

## Нюансы

- Для production-установки Node.js/npm на хосте не нужны.
- `npm run cb` собирает frontend в `frontend/dist`.
- Dockerfile сам собирает backend и frontend внутри build stages.
- Некоторые npm-скрипты используют Unix-стиль env-переменных и на Windows могут требовать WSL или Linux-shell.

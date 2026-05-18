# Разработка и проверки TopoR Balancer

Этот файл нужен разработчику. Для обычной установки используйте README и Docker Compose.

## Backend

```bash
cd backend
npm run build
npm run test:topor-balancer
npm run lint
```

## Frontend

```bash
cd frontend
npm run typecheck
npm run cb
```

## Известные нюансы

- `frontend` stylelint может падать на существующих CSS-правилах, не связанных с поведением TopoR Balancer.
- Некоторые npm-скрипты используют Unix-стиль `NODE_ENV=...` и на Windows могут требовать `cross-env`, WSL или Linux-shell.
- Docker build и реальный запуск с Remnawave Panel проверяйте отдельно на целевом окружении.

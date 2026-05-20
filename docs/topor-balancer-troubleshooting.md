# Troubleshooting Remnawave Balancer by TopoR

Короткий список частых проблем.

## `error from registry: denied`

Причина: compose пытается скачать приватный или несуществующий GHCR image.

Исправление: используйте compose с локальной сборкой:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

GHCR можно использовать только опционально, если image уже опубликован и у вас есть доступ.

## `"/frontend/dist": not found`

Причина: старый Dockerfile ожидал, что frontend уже собран на хосте.

Исправление: используйте обновленный Dockerfile, где frontend собирается внутри Docker:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml build --no-cache
docker compose -f examples/docker-compose.topor-balancer.yml up -d
```

## `node: command not found` или `npm: command not found`

Причина: старые инструкции требовали ручную сборку frontend/backend на сервере.

Исправление: Node.js и npm на хосте не нужны. Установите только Docker и Docker Compose plugin, затем запускайте:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml up -d --build
```

## Balancer не меняет подписку

Проверьте:

- `TOPOR_BALANCER_ENABLED=true`
- `TOPOR_BALANCER_CONFIG_PATH=/opt/app/topor-balancer.config.json`
- файл `topor-balancer.config.json` примонтирован в контейнер
- подписка содержит строки `vless://`
- `technicalHostName` совпадает с remark после `#`

Для временной диагностики включите:

```env
TOPOR_BALANCER_DEBUG=true
```

## `technicalHostName` не совпадает с VLESS remark

Balancer сопоставляет ноду по remark:

```text
vless://...#FI-STD-01
```

Значит в конфиге должно быть:

```json
{
  "technicalHostName": "FI-STD-01"
}
```

Регистр, пробелы и символы должны совпадать.

## Admin API возвращает 404

Чаще всего не задан `TOPOR_BALANCER_ADMIN_TOKEN`.

Если токен пустой, Admin API специально отключается и возвращает `404 Not Found`. Заполните env и перезапустите контейнер.

## Admin API возвращает 401

Запрос идет без правильного Bearer header.

Пример:

```bash
curl -H "Authorization: Bearer <admin-token>" https://subscription.example.com/api/topor-balancer/health
```

## Database mode падает обратно в hash

Так происходит, если:

- `TOPOR_BALANCER_ASSIGNMENT_MODE=database`
- PostgreSQL недоступен или `TOPOR_BALANCER_DATABASE_URL` пустой
- `TOPOR_BALANCER_DB_FALLBACK_TO_HASH=true`

Для compose из репозитория строка подключения должна быть:

```env
TOPOR_BALANCER_DATABASE_URL=postgres://topor_balancer:change_me@topor-balancer-postgres:5432/topor_balancer
```

Запуск с PostgreSQL:

```bash
docker compose -f examples/docker-compose.topor-balancer.yml --profile database up -d --build
```

## Нет active нод

Если в группе нет нод со статусом `active`, balancer не выбирает новую ноду и сохраняет оригинальные ссылки этой группы.

Проверьте статусы в конфиге или Admin UI.

## Пользователь не остается на той же ноде

Для hash mode проверьте, что не менялись:

- `shortUuid`
- `publicHostCode`
- `planCode`
- список active нод
- веса нод

Для database mode проверьте доступность PostgreSQL и что пользователь не был переназначен вручную.

## Клиент получает HTML вместо подписки

Backend считает браузерные User-Agent веб-страницей и отдает UI. Для проверки подписки используйте небраузерный User-Agent:

```bash
curl -H "User-Agent: v2rayNG/1.9.0" https://subscription.example.com/<shortUuid>
```

## Проверка base64-подписки

Linux/macOS:

```bash
echo '<base64>' | base64 -d
```

PowerShell:

```powershell
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('<base64>'))
```

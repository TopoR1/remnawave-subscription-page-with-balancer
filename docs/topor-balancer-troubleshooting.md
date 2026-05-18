# Troubleshooting Remnawave Balancer by TopoR

Практический список частых проблем.

## Балансировщик не меняет подписку

Проверьте:

- `TOPOR_BALANCER_ENABLED=true`;
- `TOPOR_BALANCER_CONFIG_PATH` указывает на существующий JSON-файл;
- подписка содержит строки `vless://`;
- ответ не HTML и не JSON;
- `technicalHostName` совпадает с remark после `#`.

Включите временно:

```env
TOPOR_BALANCER_DEBUG=true
```

В логах ищите `TOPOR_BALANCER_DEBUG`: там видны формат ответа, количество VLESS-ссылок и выбранные ноды.

## technicalHostName не совпадает с VLESS remark

Балансировщик сопоставляет ноду по remark:

```text
vless://...#FI-STD-01
```

Значит в конфиге должно быть:

```json
{
  "technicalHostName": "FI-STD-01"
}
```

Регистр, пробелы и символы должны совпадать. Если remark закодирован, сначала посмотрите декодированное имя.

## Admin API возвращает 404

Чаще всего не задан `TOPOR_BALANCER_ADMIN_TOKEN`.

Если токен пустой, guard специально отключает Admin API и возвращает `404 Not Found`.

Проверьте env и перезапустите контейнер.

## Admin API возвращает 401

Токен задан, но запрос идет без правильного Bearer header.

Пример:

```bash
curl -H "Authorization: Bearer <admin-token>" https://subscription.example.com/api/topor-balancer/health
```

В UI выйдите и введите токен заново.

## Database mode падает обратно в hash

Так происходит, если:

- `TOPOR_BALANCER_ASSIGNMENT_MODE=database`;
- PostgreSQL недоступен или `TOPOR_BALANCER_DATABASE_URL` пустой;
- `TOPOR_BALANCER_DB_FALLBACK_TO_HASH=true`.

Проверьте строку подключения и доступность PostgreSQL. Если хотите не fallback, а явную ошибку с fail-open на оригинальную подписку, поставьте:

```env
TOPOR_BALANCER_DB_FALLBACK_TO_HASH=false
```

## Нет active нод

Если в группе нет `active` нод, балансировщик не выбирает новую ноду. Он сохраняет оригинальные ссылки этой группы, чтобы не сломать подписку.

Проверьте статусы в конфиге или в Admin UI.

## Пользователь не остается на той же ноде

Для hash mode:

- проверьте, что `shortUuid` одинаковый;
- не менялся `publicHostCode`;
- не менялся `planCode`;
- не менялся список активных нод или веса.

Для database mode:

- проверьте доступность PostgreSQL;
- проверьте, что пользователь не был переназначен вручную;
- проверьте, что старая нода не стала `disabled` или `dead`.

## Клиент получает HTML вместо подписки

Backend считает браузерные User-Agent веб-страницей и отдает UI подписки. Для проверки подписки используйте небраузерный User-Agent:

```bash
curl -H "User-Agent: v2rayNG/1.9.0" https://subscription.example.com/<shortUuid>
```

## Проверка base64-подписки

Если подписка выглядит как длинная base64-строка, декодируйте ее и проверьте наличие `vless://`.

Linux/macOS:

```bash
echo '<base64>' | base64 -d
```

PowerShell:

```powershell
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('<base64>'))
```

Балансировщик поддерживает base64 только если после декодирования внутри есть VLESS-ссылки.

## После поломки конфига подписка не пропала

Это ожидаемо. Балансировщик сделан fail-open: при ошибке обработки backend возвращает оригинальный ответ Remnawave.

Смотрите логи backend, исправляйте конфиг и перезапускайте контейнер, если конфиг загружается при старте в database mode.

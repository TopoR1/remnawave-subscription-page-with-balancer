# Admin UI Remnawave Balancer by TopoR

Admin UI находится по адресу:

```text
/admin/topor-balancer
```

Например:

```text
https://subscription.example.com/admin/topor-balancer
```

## Доступ

Для входа нужен `TOPOR_BALANCER_ADMIN_TOKEN`.

1. Задайте токен в env.
2. Перезапустите backend/контейнер.
3. Откройте `/admin/topor-balancer`.
4. Введите токен на странице.

UI хранит введенный токен в `localStorage` браузера и отправляет его в Admin API:

```http
Authorization: Bearer <token>
```

Если токен не настроен на backend, Admin API возвращает `404`, а UI покажет, что API отключен. Если токен неверный, будет `401`.

## Что показывает UI

### Health

Показывает:

- включен ли балансировщик;
- текущий assignment mode;
- загружен ли конфиг;
- доступна ли БД;
- количество нод;
- количество назначений;
- количество записанных запросов;
- последнюю ошибку, если backend ее вернул.

### Nodes

Показывает технические ноды из базы:

- `technicalHostName`;
- `publicHostCode`;
- `planCode`;
- `publicName`;
- `weight`;
- `maxUsers`;
- `assignedUsers`;
- `status`.

Доступны фильтры по поиску, статусу, плану и публичной группе.

Действия:

- `Enable` - ставит `active`;
- `Drain` - ставит `draining`;
- `Disable` - ставит `disabled`;
- `Edit` - меняет `publicName`, `weight`, `maxUsers`.

Эти действия работают через Admin API и требуют доступную PostgreSQL БД.

### Assignments

Показывает до 500 последних назначений из БД:

- `shortUuid`;
- `publicHostCode`;
- `planCode`;
- `technicalHostName`;
- даты создания и обновления.

Можно фильтровать по `shortUuid`, группе, плану и ноде.

Действие `Reassign` вручную переносит пользователя на выбранную активную ноду. Целевая нода должна иметь тот же `publicHostCode` и `planCode`.

### Requests

Показывает до 500 последних запросов, записанных в database mode:

- время;
- `shortUuid`;
- `userAgent`;
- формат ответа;
- количество входных и выходных VLESS-ссылок;
- статус;
- текст ошибки, если есть.

UI дополнительно скрывает чувствительные значения в текстовых полях: токены, subscription links и IP-адреса.

## Важные ограничения

- В hash mode нет реальных записей назначений, поэтому разделы `Assignments` и `Requests` полезны только при настроенной БД.
- Если `TOPOR_BALANCER_DATABASE_URL` пустой или PostgreSQL недоступен, API управления нодами вернет ошибку `503`.
- UI не меняет JSON-конфиг на диске. В database mode ноды загружаются из конфига в БД при старте и при обработке подписки.
- Для production лучше дополнительно закрыть `/admin/topor-balancer` и `/api/topor-balancer` на reverse proxy.

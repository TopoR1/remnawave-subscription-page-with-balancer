# Admin UI

Admin UI - основной способ настройки balancer в database mode.

Откройте:

```text
https://sub.example.com/admin/topor-balancer
```

или локально:

```text
http://127.0.0.1:3010/admin/topor-balancer
```

Введите `TOPOR_BALANCER_ADMIN_TOKEN`.

## Первый запуск

Если нод нет, UI покажет пустое состояние: `Добавьте первую группу/ноду`.

Нажмите `Add node` и заполните:

- `technicalHostName`
- `publicHostCode`
- `publicName`
- `locationCode`
- `planCode`
- `weight`
- `maxUsers`
- `status`

Группа формируется по `publicHostCode + planCode`. Несколько технических нод одной группы должны иметь одинаковые `publicHostCode` и `planCode`.

## Управление нодами

В UI можно:

- создать ноду;
- редактировать поля ноды;
- перевести ноду в `active`, `draining`, `disabled`;
- удалить ноду без назначений;
- смотреть assignments и requests;
- вручную переназначать пользователя на active-ноду той же группы.

Удаление ноды с assignments отклоняется API с `409 Conflict`.

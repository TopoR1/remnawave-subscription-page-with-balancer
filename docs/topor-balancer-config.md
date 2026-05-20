# JSON-конфиг TopoR Balancer

Обычная production-настройка делается через Admin UI и PostgreSQL. `topor-balancer.config.json` не нужен для старта database mode.

JSON-конфиг нужен только для:

- hash mode без базы;
- первичного импорта нод в БД;
- аварийного статического режима;
- продвинутых сценариев.

## Hash mode

```bash
cp examples/topor-balancer.config.example.json topor-balancer.config.json
```

В `.env`:

```env
TOPOR_BALANCER_ASSIGNMENT_MODE=hash
TOPOR_BALANCER_CONFIG_PATH=/opt/app/topor-balancer.config.json
TOPOR_BALANCER_DB_FALLBACK_TO_HASH=true
```

В compose добавьте mount:

```yaml
volumes:
  - ../topor-balancer.config.json:/opt/app/topor-balancer.config.json:ro
```

## Импорт в database mode

Если хотите один раз загрузить ноды из JSON:

```env
TOPOR_BALANCER_IMPORT_CONFIG_ON_START=true
TOPOR_BALANCER_CONFIG_PATH=/opt/app/topor-balancer.config.json
```

После успешного импорта лучше вернуть:

```env
TOPOR_BALANCER_IMPORT_CONFIG_ON_START=false
```

Иначе поля нод из JSON будут снова синхронизироваться при старте.

## Поля

- `publicHostCode` - код публичной группы.
- `publicName` - имя, которое увидит пользователь.
- `locationCode` - опциональный код локации.
- `planCode` - план/тариф.
- `technicalHostName` - точный remark технической VLESS-ноды после `#`.
- `weight` - вес ноды.
- `maxUsers` - условная емкость.
- `status` - `active`, `draining`, `disabled` или `dead`.

`technicalHostName` должен точно совпадать с VLESS remark:

```text
vless://...#FI-STD-01
```

```json
"technicalHostName": "FI-STD-01"
```

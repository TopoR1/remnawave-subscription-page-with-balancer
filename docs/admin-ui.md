# Admin UI

Admin UI is available at `/admin/topor-balancer`.

## Loading

The SPA is served by the backend, while runtime subscription-page config is loaded from `/assets/.app-config-v2.json`. That legacy endpoint is kept for compatibility. New TopoR-specific bootstrap data is available from `/api/topor-balancer/bootstrap`.

## Localization

Admin UI localization groundwork lives in `frontend/src/i18n/`.

- `ru.ts` is the default locale.
- `en.ts` is the optional English locale.
- `index.ts` exports `defaultLocale` and the locale map.

## Help Text

Balancing help text is centralized under `balancingHelp` in the locale files. The UI displays help for Sticky Assignment, Weighted Balancing, Health Checks, Failover, Node Weight, public host code, technical host name, and max users.

## Simple And Advanced Mode

The `Расширенные настройки` toggle keeps the first screen focused on essential node controls. Advanced mode exposes assignments, requests, diagnostic cards, and additional tuning columns.

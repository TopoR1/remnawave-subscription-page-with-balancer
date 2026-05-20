# Runtime frontend config

`/assets/.app-config-v2.json` is not a static file in this fork. The route is handled by Nest in `RootController` and delegated to `RuntimeConfigService`.

## Current flow

1. Frontend requests `/assets/.app-config-v2.json?v=<timestamp>`.
2. `checkAssetsCookieMiddleware` reads the `session` cookie and attaches JWT payload when possible.
3. `RuntimeConfigService` asks `SubpageConfigService` for the Remnawave subpage config using encrypted `session.su`.
4. If the session/config is missing or invalid, the endpoint returns safe fallback config.
5. The response is always `application/json`.

## Sources

- Primary source: Remnawave subscription page config fetched by `SubpageConfigService` during application bootstrap.
- Session selector: `session.su`, encrypted with `INTERNAL_JWT_SECRET`.
- Fallback source: built-in minimal config with `version: "1"` and locales `ru`, `en`.

## Diagnostics

Runtime config logs are tagged with `[ToporBalancerConfig]` and include config source, missing sources, schema version, locales, and serialization errors.

## Failure behavior

The endpoint must never crash the frontend. If config lookup or serialization fails, it logs the error and returns fallback JSON. The frontend also shows `Не удалось загрузить конфигурацию панели` with a retry button if validation or fetch still fails.

## Bootstrap API

`GET /api/topor-balancer/bootstrap` returns future bootstrap data:

```json
{
  "version": "1",
  "locale": "ru",
  "features": {},
  "settings": {},
  "hosts": [],
  "nodes": []
}
```

It currently reuses balancer data from PostgreSQL when available, otherwise from `TOPOR_BALANCER_CONFIG_PATH`.

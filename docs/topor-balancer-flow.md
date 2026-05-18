# Topor Balancer: subscription serving flow

## Entrypoints

- `backend/src/modules/root/root.controller.ts`
  - `GET /:shortUuid`
  - `GET /:shortUuid/:clientType`
- If `CUSTOM_SUB_PREFIX` is configured in `backend/src/main.ts`, the same routes are served below that prefix.
- `shortUuid` can also be a legacy Marzban subscription token when `MARZBAN_LEGACY_LINK_ENABLED=true`; `RootService.tryDecodeMarzbanLink()` resolves it to a Remnawave user and then to the user's `shortUuid`.

## Backend flow

1. `RootController.root()` rejects asset/locales-like requests and validates optional `clientType` against `REQUEST_TEMPLATE_TYPE_VALUES`.
2. `RootService.serveSubscriptionPage()` receives `clientIp`, Express request/response, `shortUuid`, and optional `clientType`.
3. Generic static-looking paths are dropped.
4. Optional Marzban legacy token decoding may replace the incoming token with the Remnawave `shortUuid`.
5. Browser user-agents are sent to `RootService.returnWebpage()`.
6. Non-browser requests are proxied to the Remnawave Panel through `AxiosService.getSubscription()`.

## Remnawave Panel API calls

- Final subscription body for non-browser clients:
  - `backend/src/common/axios/axios.service.ts`
  - `AxiosService.getSubscription()`
  - Panel path: `GET api/sub/:shortUuid` or `GET api/sub/:shortUuid/:clientType`
- Browser page data:
  - `AxiosService.getSubscriptionInfo()` calls the typed subscription-info endpoint from `@remnawave/backend-contract`.
  - `AxiosService.getSubpageConfig()` calls the typed subpage-config endpoint from `@remnawave/backend-contract`.

## Final response points

- Browser HTML page: `RootService.returnWebpage()` renders `index` and sends the rendered HTML.
- Subscription output: `RootService.serveSubscriptionPage()` copies non-ignored Panel response headers and returns `res.status(200).send(subscriptionDataResponse.response)`.
- Error/not-found paths generally destroy the socket and do not return a subscription body.

## Current response formats

- Browser HTML page: returned for user-agents matching `Mozilla`, `Chrome`, `Safari`, `Firefox`, `Opera`, `Edge`, `TelegramBot`, or `WhatsApp`.
- Plain subscription links: possible when Remnawave Panel returns raw text containing `vless://` links.
- Base64 subscription links: possible when Remnawave Panel returns base64 text that decodes to `vless://` links.
- JSON responses: possible when the Panel returns JSON or when Express serializes an object returned from Axios.
- HAPP/app-specific formats: optional `/:clientType` is accepted only when it is present in `REQUEST_TEMPLATE_TYPE_VALUES`; the backend does not build these formats itself and forwards the request to `api/sub/:shortUuid/:clientType` on the Panel.

## Optional debug logging

Set:

```env
TOPOR_BALANCER_DEBUG=true
```

When enabled, `RootService` emits one `[TOPOR_BALANCER_DEBUG]` log record before the response body is sent. The record includes:

- request path;
- user-agent;
- response content-type;
- response body byte length;
- detected response format;
- number of detected `vless://` links.

When `TOPOR_BALANCER_DEBUG` is false or unset, this debug code returns immediately and does not log.

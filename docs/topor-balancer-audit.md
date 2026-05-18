# TopoR Balancer Implementation Audit

Audit date: 2026-05-18  
Repository: `TopoR1/remnawave-subscription-page-with-balancer`  
Scope: implementation audit only; no feature implementation or behavior changes.

## Verification Summary

| Check | Status | Result |
| ---- | ------ | ------ |
| Backend build | ✅ Done | `npm.cmd run build` in `backend` completed successfully. |
| Backend start | ❓ Cannot verify | `npm.cmd run start:prod` is not Windows-compatible because it uses inline `NODE_ENV=...`; direct `node dist/src/main` started Nest but exited because the test `REMNAWAVE_PANEL_URL=https://example.com` was unreachable. |
| Backend TypeScript | ✅ Done | Covered by successful Nest build. |
| Backend lint | ❌ Missing | `npm.cmd run lint` failed with 43 formatting/import-order errors in TopoR and env/root integration files. |
| TopoR backend tests | ✅ Done | `npm.cmd run test:topor-balancer` passed 23/23 tests. |
| Frontend typecheck | ✅ Done | `npm.cmd run typecheck` completed successfully. |
| Frontend build | ⚠️ Partially done | `npm.cmd run start:build` fails on Windows due inline `NODE_ENV=production`; `npm.cmd run cb` Vite build completed successfully. |
| Frontend lint | ❌ Missing | `npm.cmd run lint` failed in stylelint with `NoFilesFoundError` for quoted `'**/*.css'` pattern on Windows. |
| Docker build | ❓ Cannot verify | Docker CLI is not installed in the audit environment. |
| Git status | ❓ Cannot verify | `git` CLI is not available in the audit environment. |

## 1. Project Integration

| Item | Status | Comment | Relevant files/functions/routes | Still needed |
| ---- | ------ | ------- | ------------------------------- | ------------ |
| Balancer code isolated from upstream code | ✅ Done | Backend balancer code is under a dedicated Nest module. | `backend/src/modules/topor-balancer/*`, `ToporBalancerModule` | Keep future work inside this module where possible. |
| Changes limited to clear integration points | ⚠️ Partially done | Main backend integration is one call from subscription flow, plus module import and admin route/page. There are also frontend route/layout changes. | `RootService.serveSubscriptionPage()` lines 134-144, `RootModule`, `RootController.getToporBalancerAdminPage()`, frontend router/layout | Keep future integration changes narrow and documented. |
| Dedicated balancer module/folder | ✅ Done | Dedicated module exists with service, parser, processors, DB repository, controller, guard, types, tests. | `backend/src/modules/topor-balancer` | None. |
| Existing behavior preserved when disabled | ⚠️ Partially done | `ToporBalancerService.process()` immediately returns original body when disabled. However `RootService` always sends status `200`, which appears to preserve existing local behavior but does not preserve upstream status. | `ToporBalancerService.process()` lines 93-100, `RootService.serveSubscriptionPage()` line 144 | Verify against upstream behavior and preserve upstream status if upstream exposes it. |
| No broad frontend/backend rewrite | ✅ Done | Changes are focused on root integration, balancer module, admin page, and docs. | `backend/src/modules/topor-balancer`, `frontend/src/pages/topor-balancer-admin` | None. |
| Application builds successfully | ⚠️ Partially done | Backend build and frontend Vite build pass. Full frontend `start:build` script is Windows-incompatible. | `backend/package.json`, `frontend/package.json` | Make scripts cross-platform with `cross-env` or document Linux-only command. |
| Application starts successfully | ❓ Cannot verify | Direct backend start reaches Nest startup but fails external Remnawave connectivity in audit environment. | `backend/dist/src/main`, `AxiosService` startup check | Verify in an environment with a reachable Remnawave Panel. |
| TypeScript errors | ✅ Done | Backend build and frontend `tsc --noEmit` passed. | Backend/frontend TS configs | None found by commands run. |
| Lint errors | ❌ Missing | Backend lint has 43 errors; frontend lint fails in stylelint glob. | TopoR module files, `config.schema.ts`, `root.service.ts`, frontend lint script | Fix formatting/import order and Windows stylelint glob. |

## 2. Environment Configuration

| Variable | Status | Default | Where read | Missing behavior | Documented | Still needed |
| -------- | ------ | ------- | ---------- | ---------------- | ---------- | ------------ |
| `TOPOR_BALANCER_ENABLED` | ✅ Done | `false` | `config.schema.ts` lines 36-39; `ToporBalancerService.isEnabled()` | Missing env becomes `false`; balancer disabled. | `.env.sample` | None. |
| `TOPOR_BALANCER_DEBUG` | ✅ Done | `false` | `config.schema.ts` lines 40-43; `RootService`; processors | Missing env becomes `false`; no debug logs. | `.env.sample`, `docs/topor-balancer-flow.md` | Avoid duplicate debug logs if both RootService and processor logging are enabled. |
| `TOPOR_BALANCER_CONFIG_PATH` | ✅ Done | `/opt/app/topor-balancer.config.json` | `config.schema.ts` lines 44-46; `ToporBalancerService.getConfigPath()` | Missing env uses default path. Missing file fails open during processing. | `.env.sample` | Add deployment mount documentation and example config. |
| `TOPOR_BALANCER_ASSIGNMENT_MODE` | ✅ Done | `hash` | `config.schema.ts` lines 47-50; `ToporBalancerService.getAssignmentMode()` | Missing env uses hash. Any value other than `database` becomes `hash`. | `.env.sample` | Consider validation warning for invalid values. |
| `TOPOR_BALANCER_DATABASE_URL` | ⚠️ Partially done | unset | `ToporBalancerService.processWithDatabase()`, `getOrCreateRepository()` | Missing DB URL makes DB mode fail; if fallback is enabled it falls back to hash, otherwise service fail-opens to original response. | `.env.sample`, Admin API docs mention DB error | Document strict mode behavior. |
| `TOPOR_BALANCER_DB_FALLBACK_TO_HASH` | ✅ Done | `true` | `config.schema.ts` lines 52-55; `ToporBalancerService.shouldFallbackToHash()` | Missing env becomes `true`. | `.env.sample` | None. |
| `TOPOR_BALANCER_ADMIN_TOKEN` | ✅ Done | unset | `ToporBalancerService.getAdminToken()`, `ToporBalancerAdminGuard.canActivate()` | Missing/empty token disables admin routes with 404. | `.env.sample`, `docs/topor-balancer-admin-api.md` | Consider documenting token generation and reverse-proxy protection. |

## 3. Config Loader

| Item / edge case | Status | Comment | Relevant files/functions | Still needed |
| ---------------- | ------ | ------- | ------------------------ | ------------ |
| `topor-balancer.config.json` supported | ⚠️ Partially done | Loader supports any JSON file path; no example file is present. Default path points to `/opt/app/topor-balancer.config.json`. | `loadToporBalancerConfigFromFile()` | Add example `topor-balancer.config.json`. |
| `TOPOR_BALANCER_CONFIG_PATH` respected | ✅ Done | Service reads configured path. | `ToporBalancerService.getConfigPath()` | None. |
| Config validation implemented | ⚠️ Partially done | Required strings, numeric node defaults, and status enum are validated. Cross-record duplicates are not validated. | `validateToporBalancerConfig()` | Add duplicate and semantic validation. |
| Required fields validated | ⚠️ Partially done | `publicHostCode`, `publicName`, `planCode`, and `technicalHostName` are validated; `locationCode` is optional in code despite checklist requiring it. | `normalizeLocation()`, `normalizeNode()` | Decide whether `locationCode` is required and enforce if needed. |
| Node defaults applied | ✅ Done | Defaults: weight 1, maxUsers 300, status active. | `normalizeNode()` | None. |
| Missing config file | ✅ Done | Read error bubbles to service and service returns original response. | `loadToporBalancerConfigFromFile()`, `ToporBalancerService.process()` | Log is clear enough, but could include path and fail-open outcome. |
| Invalid JSON | ✅ Done | `JSON.parse` throws; service catches and fail-opens. | `parseToporBalancerConfig()` | Add test coverage. |
| Empty locations | ⚠️ Partially done | Empty or absent locations are accepted and return no matched balancing. | `validateToporBalancerConfig()` | Decide whether empty config should warn. |
| Duplicated `technicalHostName` | ❌ Missing | Map/repository conflict means later config entries can override earlier ones; DB has unique technical host but no validation error. | `buildTechnicalNodeMap()`, DB `technical_host_name UNIQUE` | Add validator check. |
| Duplicated `publicHostCode` with different `planCode` | ❌ Missing | Hash grouping uses only `publicHostCode`, so same public code across plans can collapse incorrectly. DB assignment key includes plan, but processor grouping is public code only. | `selectNodesByPublicHostCode()` in hash and DB processors | Group by `publicHostCode + planCode`; validate duplicates. |
| Invalid status | ✅ Done | Validator rejects statuses outside active/draining/disabled/dead. | `readOptionalNodeStatus()` | None. |
| Invalid weight | ✅ Done | Config validation requires positive integer. | `readOptionalPositiveInteger()` | DB/UI allow decimal weight, so align config/UI expectations. |
| Invalid maxUsers | ✅ Done | Config validation requires positive integer. | `readOptionalPositiveInteger()` | None. |

## 4. Subscription Flow Integration

| Item | Status | Comment | Relevant files/functions | Still needed |
| ---- | ------ | ------- | ------------------------ | ------------ |
| Exact backend call location | ✅ Done | Called after upstream subscription response headers are copied and before sending response. | `RootService.serveSubscriptionPage()` lines 119-144 | None. |
| Processes outgoing subscription responses | ✅ Done | Passes Remnawave response body through `ToporBalancerService.process()`. | `RootService.serveSubscriptionPage()` | None. |
| Receives `shortUuid` | ✅ Done | Uses original or decoded Marzban `shortUuidLocal`. | `RootService.serveSubscriptionPage()` | None. |
| Receives content type | ⚠️ Partially done | Reads `res.getHeader('content-type')` after copied headers. If upstream content-type was ignored or absent, parser has only body detection. | `RootService.serveSubscriptionPage()` | Confirm upstream header copy includes content type in all cases. |
| Receives user-agent/path | ✅ Done | Both passed for logging/debug/DB request logging. | `RootService.serveSubscriptionPage()` | None. |
| Preserves original status code | ❌ Missing | Response is always `res.status(200)`. | `RootService.serveSubscriptionPage()` line 144 | Preserve upstream status if available from `AxiosService.getSubscription()`. |
| Preserves headers where possible | ✅ Done | Copies upstream headers except ignored headers before balancing. | `RootService.serveSubscriptionPage()` lines 119-126 | None. |
| Avoids HTML/static frontend responses | ✅ Done | Browser responses go through `returnWebpage()` and not the balancer; static-looking paths are dropped. Parser also returns HTML unchanged. | `isBrowser()`, `returnWebpage()`, `detectSubscriptionFormat()` | None. |
| Avoids JSON unless supported | ✅ Done | Parser detects JSON and processors return unchanged. Object bodies are not stringified for balancing. | `stringifySupportedBody()`, `detectSubscriptionFormat()` | None. |
| Disabled output identical | ⚠️ Partially done | Body is returned exactly for string/Buffer/object when disabled. Headers/status behavior is outside balancer and should be compared with upstream. | `ToporBalancerService.process()` | Add regression test against disabled full HTTP response. |
| Processing failure returns original | ✅ Done | Service wraps processing in try/catch and returns original `input.body`. | `ToporBalancerService.process()` | None. |

## 5. Subscription Format Detection

| Format | Status | Detection function | Tests | Behavior when unsupported/incomplete |
| ------ | ------ | ------------------ | ----- | ------------------------------------ |
| Plain VLESS links | ✅ Done | `detectSubscriptionFormat()`, `containsVlessLink()` | Tests lines 204, 244 | Parsed and balanced. |
| Base64 subscription | ✅ Done | `tryDecodeBase64Subscription()` | Tests lines 169, 265 | Decoded, balanced, re-encoded. |
| HTML | ✅ Done | Content-type or `looksLikeHtml()` | Test line 189 | Returned unchanged. |
| JSON | ✅ Done | Content-type or `looksLikeJson()` | Test line 197 | Returned unchanged. |
| Unknown body | ✅ Done | Falls through to `unknown` | Covered indirectly | Returned unchanged. |
| Invalid base64 | ✅ Done | Regex/length check and try/catch returns null | Covered indirectly by malformed tests | Returned unchanged; no crash expected. |

## 6. VLESS+REALITY Parser

| Item | Status | Comment | Relevant files/functions | Still needed |
| ---- | ------ | ------- | ------------------------ | ------------ |
| Detects `vless://` links | ✅ Done | Extractor filters lines starting with `vless://`. | `extractVlessLinks()` | None. |
| Parses UUID | ✅ Done | Uses `URL.username`. | `parseVlessLink()` | None. |
| Parses host | ✅ Done | Uses `URL.hostname`. | `parseVlessLink()` | None. |
| Parses port | ✅ Done | Converts `URL.port` to number. | `parseVlessLink()` | None. |
| Parses query params | ✅ Done | Manual parser preserves decoded key/value map. | `parseQueryParams()` | None. |
| Parses remark after `#` | ✅ Done | `parseRemark()` decodes hash. | `parseRemark()` | None. |
| Preserves query params | ✅ Done | Remark replacement slices before hash and leaves query string intact. | `replaceVlessRemark()` | None. |
| Preserves `security=reality` | ✅ Done | Params are not rewritten; parser exposes `security`. | `parseVlessLink()` | None. |
| Preserves `sni` | ✅ Done | Params are not rewritten; parser exposes `sni`. | `parseVlessLink()` | None. |
| Preserves `pbk` | ✅ Done | Params are not rewritten; parser exposes `pbk`. | `parseVlessLink()` | None. |
| Preserves `sid` | ✅ Done | Params are not rewritten; parser exposes `sid`. | `parseVlessLink()` | None. |
| Preserves `fp` | ⚠️ Partially done | Query params are preserved, but `ParsedVlessLink` does not expose a first-class `fp` field. | `parseVlessLink()`, `ParsedVlessLink` | Add typed `fp` if callers need it. |
| Preserves `flow` | ✅ Done | Params are not rewritten; parser exposes `flow`. | `parseVlessLink()` | None. |
| Preserves `type` | ✅ Done | Params are not rewritten; parser exposes `type`. | `parseVlessLink()` | None. |
| Safely handles malformed links | ✅ Done | Parser returns null; replacement leaves malformed links unchanged. | `parseVlessLink()`, `replaceVlessRemark()` | None. |
| Leaves non-VLESS unchanged | ✅ Done | Extractor ignores; filter keeps unmatched/non-VLESS lines. | `filterSubscriptionBody()` | None. |

## 7. Technical Host Grouping

| Item | Status | Comment | Relevant files/functions | Still needed |
| ---- | ------ | ------- | ------------------------ | ------------ |
| Maps `technicalHostName` to config node | ✅ Done | Hash map and DB map use `technicalHostName`. | `buildTechnicalNodeMap()` | Add duplicate validation. |
| Matches VLESS links by remark | ✅ Done | Matching requires parsed `remark` equal to configured technical host. | `collectMatchingLines()` | None. |
| Groups multiple technical hosts under one `publicHostCode` | ✅ Done | Grouping is by public host code. | `selectNodesByPublicHostCode()` | Include `planCode` to avoid cross-plan collision. |
| Supports `publicName` replacement | ✅ Done | Kept node remark is replaced with configured public name. | `replaceVlessRemark()`, `filterSubscriptionBody()` | None. |
| Leaves unknown links unchanged | ✅ Done | Unknown VLESS and non-VLESS lines are pushed unchanged. | `filterSubscriptionBody()` | None. |
| Removes duplicate technical nodes from same public host | ✅ Done | Keeps only one selected public host code. | `keptSelectedPublicHostCodes` in filter | None. |
| Returns exactly one selected node per `publicHostCode` | ⚠️ Partially done | Does this when active candidate exists. If no active candidate exists, all known links for that host are removed, not original fail-open for that group. | Hash/DB `filterSubscriptionBody()` | Decide safer behavior when no candidate exists. |
| Example FI-STD-01/02/03 -> one FI link | ✅ Done | Covered by hash test. | Test line 204 | None. |

## 8. Hash-Based Sticky Mode

| Item | Status | Comment | Relevant files/functions | Still needed |
| ---- | ------ | ------- | ------------------------ | ------------ |
| Hash assignment mode implemented | ✅ Done | Default assignment mode is hash. | `processSubscriptionWithHashBalancer()` | None. |
| Deterministic selection | ✅ Done | Uses SHA-256 of `shortUuid:publicHostCode`. | `selectWeightedNode()`, `hashToBigInt()` | None. |
| Same `shortUuid + publicHostCode` returns same node | ✅ Done | Covered by test. | Test line 244 | None. |
| Different users distribute across nodes | ⚠️ Partially done | Hashing should distribute; no explicit distribution quality test. | `selectWeightedNode()` | Add statistical/unit distribution test. |
| Disabled/dead nodes excluded | ✅ Done | Hash candidates filter only `status === 'active'`, so disabled/dead excluded. | `selectNodesByPublicHostCode()` | None. |
| Draining nodes excluded for new hash selections | ✅ Done | Only active nodes are candidates. | `selectNodesByPublicHostCode()` | None. |
| Weight supported in hash mode | ✅ Done | Weighted cursor uses integer weights. | `selectWeightedNode()`, `getNodeWeight()` | Config only accepts integer weights; UI accepts decimal in DB mode. |
| Only one node exists | ✅ Done | Single active candidate is selected. | `selectWeightedNode()` | Add direct test. |
| No active nodes exist | ⚠️ Partially done | No crash, but matching links for that public host are dropped instead of returning original host group. | `selectNodesByPublicHostCode()`, `filterSubscriptionBody()` | Prefer preserving original lines or fail-open per group. |
| No database required | ✅ Done | Hash mode uses config only. | `processSubscriptionWithHashBalancer()` | None. |

## 9. Database Assignment Mode

| Item | Status | Comment | Relevant files/functions | Still needed |
| ---- | ------ | ------- | ------------------------ | ------------ |
| Database mode implemented | ✅ Done | Service selects database processor when mode is `database`. | `ToporBalancerService.processWithDatabase()` | None. |
| Database library | ✅ Done | Uses `pg` dynamically via `createRequire`. | `ToporBalancerPostgresRepository` | None. |
| Schema initialization | ✅ Done | Creates required tables and indexes on init and processing. | `initializeSchema()` | Consider migrations for future schema changes. |
| `topor_balancer_nodes` table | ⚠️ Partially done | Required fields exist, but `updated_at` is not returned in admin node type/mapper. | `initializeSchema()`, `mapAdminNodeRow()` | Add `updatedAt` to backend response if UI expects it. |
| `topor_balancer_assignments` table | ✅ Done | Includes unique `(short_uuid, public_host_code, plan_code)`. | `initializeSchema()` | None. |
| `topor_balancer_requests` table | ⚠️ Partially done | Required core fields exist, but no `status` or `error` fields. UI has optional columns that backend never sends. | `initializeSchema()`, `recordRequest()` | Add status/error if intended. |
| Existing assignment reused | ✅ Done | Existing active/draining assignment is selected. | `findExistingUsableAssignment()` | None. |
| Active node kept | ✅ Done | Existing active node is in allowed statuses. | `findExistingUsableAssignment()` | None. |
| Draining node kept for existing assignment | ✅ Done | Existing draining node is allowed. | `findExistingUsableAssignment()`; test line 393 | None. |
| Disabled/dead force reassignment | ✅ Done | Existing query allows only active/draining; new selection active-only. | `findExistingUsableAssignment()`, `selectLeastLoadedActiveNode()`; test line 410 | None. |
| New assignment selects lowest load ratio | ✅ Done | Orders by `COUNT(assignments) / maxUsers * weight`. | `selectLeastLoadedActiveNode()`; test line 427 | Verify formula matches intended weighting semantics. |
| Race conditions handled | ✅ Done | Uses transaction, advisory lock, and unique upsert. | `getOrCreateAssignment()`, `upsertAssignment()`; test line 446 | None. |
| DB unavailable fallback | ✅ Done | Falls back to hash if configured; otherwise top-level service fail-opens. | `processWithDatabase()` | Add integration test with actual failed `pg` connection. |
| Duplicate assignments prevented | ✅ Done | Unique constraint and upsert. | `initializeSchema()`, `upsertAssignment()` | None. |
| Does not assign disabled/dead | ✅ Done | New selection requires active. | `selectLeastLoadedActiveNode()` | Manual reassignment currently does not enforce active. |
| Manual reassignment safety | ⚠️ Partially done | UI only offers active targets, but backend `reassign()` accepts any matching node regardless of status. | `ToporBalancerPostgresRepository.reassign()` | Enforce active status server-side. |

## 10. Node Statuses

| Status | Runtime behavior | Status | Relevant files/functions | Still needed |
| ------ | ---------------- | ------ | ------------------------ | ------------ |
| `active` | Allowed for new and existing users. | ✅ Done | Hash candidate filter; DB existing/new queries | None. |
| `draining` | Hash excludes; DB keeps only existing assignments. | ✅ Done | `selectNodesByPublicHostCode()`, `findExistingUsableAssignment()` | None. |
| `disabled` | Hash excludes; DB forces reassignment. | ✅ Done | Hash active-only filter; DB active/draining existing query | Backend manual reassign should reject disabled target. |
| `dead` | Hash excludes; DB forces reassignment. | ✅ Done | Hash active-only filter; DB active/draining existing query | Add Admin API convenience route if needed; PATCH supports status. |
| UI can change status | ⚠️ Partially done | UI has enable/drain/disable actions and edit status is not direct; no dead action except PATCH could be coded manually. | Admin page lines 1153-1180 | Add dead action if operationally needed. |
| Admin API can change status | ✅ Done | PATCH accepts any enum; drain/enable/disable routes exist. | `ToporBalancerAdminController` | Add explicit dead route if desired. |

## 11. Fail-Open Safety

| Failure case | Status | Comment | Relevant files/functions | Still needed |
| ------------ | ------ | ------- | ------------------------ | ------------ |
| Config loading fails | ✅ Done | Service catches and returns original body. | `ToporBalancerService.process()`; test line 341 | None. |
| Parser throws | ✅ Done | Parser errors bubble to service catch; malformed links return null locally. | `parseVlessLink()`, `process()` | Add explicit parser-throw test. |
| DB fails | ✅ Done | DB mode falls back to hash or throws to outer fail-open. | `processWithDatabase()`, `process()` | Add real DB failure integration test. |
| Assignment fails | ✅ Done | Any thrown assignment error returns original response through service catch. | `processWithDatabase()`, `process()` | None. |
| Unexpected body format | ✅ Done | Unsupported formats return unchanged; non-string/non-Buffer bodies return unchanged. | `stringifySupportedBody()`, processors | None. |
| Errors logged without exposing secrets | ⚠️ Partially done | Logs errors and debug includes `shortUuid`, `userAgent`, path, selected technical hosts. It does not log subscription body, but user identifiers may be sensitive. | `ToporBalancerService.process()`, `logDebugInfo()` | Review log privacy and redact/debug-gate identifiers if needed. |
| Users receive original upstream subscription on balancer failure | ✅ Done | Top-level service catch returns original response. | `ToporBalancerService.process()` | None. |

## 12. Admin API

All current admin routes use `@UseGuards(ToporBalancerAdminGuard)` at controller level. The guard requires `Authorization: Bearer <TOPOR_BALANCER_ADMIN_TOKEN>` and returns 404 when token is not configured.

| Route | Status | Auth | Request body / query | Response | Validation/error handling | Relevant files |
| ----- | ------ | ---- | -------------------- | -------- | ------------------------- | -------------- |
| `GET /api/topor-balancer/health` | ✅ Done | Bearer token | none | `enabled`, `assignmentMode`, `configLoaded`, `databaseConnected`, `nodeCount`, `assignmentCount` | Catches config/DB errors internally as false values. | `ToporBalancerAdminController.health()`, `ToporBalancerService.getAdminHealth()` |
| `GET /api/topor-balancer/summary` | ❌ Missing | n/a | n/a | n/a | Not implemented. Health partly overlaps. | n/a |
| `GET /api/topor-balancer/nodes` | ✅ Done | Bearer token | none | node list with `assignedUsers` | 503 if DB unavailable via service. | `nodes()`, `listAdminNodes()` |
| `PATCH /api/topor-balancer/nodes/:id` | ⚠️ Partially done | Bearer token | optional `weight`, `maxUsers`, `status`, `publicName` | updated node | Only status enum is validated in service; weight/maxUsers/publicName are not strongly validated server-side. Invalid status returns 404 instead of 400. | `updateNode()`, `validateNodeUpdate()` |
| `POST /api/topor-balancer/nodes/:id/drain` | ✅ Done | Bearer token | none | updated node | 404 missing node; 503 DB unavailable. | `drainNode()` |
| `POST /api/topor-balancer/nodes/:id/enable` | ✅ Done | Bearer token | none | updated node | 404 missing node; 503 DB unavailable. | `enableNode()` |
| `POST /api/topor-balancer/nodes/:id/disable` | ✅ Done | Bearer token | none | updated node | 404 missing node; 503 DB unavailable. | `disableNode()` |
| `GET /api/topor-balancer/assignments` | ✅ Done | Bearer token | optional `shortUuid`, `publicHostCode`, `planCode`, `nodeId` | up to 500 assignments | DB errors propagate as 500/503. | `assignments()`, repository `listAssignments()` |
| `POST /api/topor-balancer/reassign` | ⚠️ Partially done | Bearer token | `shortUuid`, `publicHostCode`, `planCode`, `technicalHostName` | assignment | No DTO validation; backend does not enforce active target status. | `reassign()`, repository `reassign()` |
| `GET /api/topor-balancer/requests` | ✅ Done | Bearer token | optional `shortUuid` | up to 500 requests | DB errors propagate as 500/503. | `requests()`, repository `listRequests()` |

Security notes:

- ✅ Admin token is required for implemented routes.
- ✅ Admin routes are disabled when token is missing.
- ✅ API docs state Remnawave tokens are not returned.
- ⚠️ Admin API exposes `shortUuid`, technical host names, user agent, and assignment data to token holders. This is expected for admin, but should be treated as sensitive.
- ⚠️ No request DTO validation is implemented for admin bodies beyond status enum.

## 13. Admin UI

| Item | Status | Comment | Relevant files/routes | Still needed |
| ---- | ------ | ------- | --------------------- | ------------ |
| `/admin/topor-balancer` route | ✅ Done | Backend renders SPA index; frontend router has route. | `RootController.getToporBalancerAdminPage()`, `router.tsx` | None. |
| Token login | ✅ Done | Password input stores token and enters admin view. | Admin page token state/actions | None. |
| Token stored in localStorage | ✅ Done | Uses `toporBalancerAdminToken`. | Admin page lines 250, 324 | Consider sessionStorage option for stricter security. |
| Sends `Authorization: Bearer` | ✅ Done | `fetchAdminJson()` adds Authorization header. | Admin page line 352 | None. |
| Logout | ✅ Done | Clears localStorage and state. | Admin page line 331 | None. |
| Handles 401/403 | ✅ Done | Clears token and shows invalid token state. | `handleAuthFailure()` | None. |
| Shows Admin API disabled state | ✅ Done | 404 maps to disabled state. | `handleDisabledApi()` | None. |
| Shows backend unavailable state | ⚠️ Partially done | Generic API errors show notifications/messages; no dedicated backend-down panel. | `loadHealth()`, `loadNodes()`, etc. | Add explicit offline state. |
| Overview page/tab | ⚠️ Partially done | Status cards exist above tabs, but no Overview tab. Tabs default to Nodes. | Admin page lines 664-719 and 1033-1039 | Add Overview tab if required. |
| Nodes page/tab | ✅ Done | Nodes tab lists expected node fields and actions. | Admin page lines 1036, 1041+ | Backend does not provide `updatedAt`. |
| Assignments page/tab | ✅ Done | Assignments tab lists fields and manual reassign. | Admin page lines 1037, 1212+ | None. |
| Requests page/tab | ⚠️ Partially done | Requests tab exists; UI has status/error columns, but backend request rows do not include them. | Admin page lines 1038, 1338+ | Add backend fields or remove UI columns. |
| Settings page/tab | ❌ Missing | No settings tab found. | Admin page tabs lines 1033-1039 | Implement read-only settings view if required. |
| Overview metrics | ⚠️ Partially done | Shows enabled, assignmentMode, databaseConnected, configLoaded, nodeCount, assignmentCount; requestCount and lastError only if backend provides them, but backend does not. | `statusCards`, `ToporBalancerAdminHealth` | Add backend `requestCount` and `lastError` if needed. |
| Nodes fields | ⚠️ Partially done | UI expects all requested fields including `updatedAt`; backend does not return `updatedAt`. | `ToporBalancerNode`, `mapAdminNodeRow()` | Add `updatedAt` mapping. |
| Node actions | ✅ Done | enable/drain/disable with confirmation for disable. | Admin page lines 1153-1180, 1488+ | Add confirmation for drain if considered dangerous. |
| Editing weight/maxUsers/publicName | ✅ Done | Modal allows editing these fields. | Admin page line 721+, 1480+ | Backend validation needed. |
| Assignments fields | ⚠️ Partially done | UI derives publicName from loaded node; assignment API does not include publicName directly. | `listAssignments()`, UI `getAssignmentNode()` | Include publicName in API or keep UI dependency documented. |
| Requests fields | ⚠️ Partially done | Core fields exist; status/error absent. | DB request table, UI request type | Add status/error in DB/API or remove columns. |
| UI contains balancing logic | ✅ Done | UI only calls backend API and filters display data. | `fetchAdminJson()` | None. |
| Dangerous confirmations | ⚠️ Partially done | Disable and manual reassign use modals; enable/drain are immediate. | UI modal/actions | Add confirmation for drain/reassign already present; consider enable confirmation unnecessary. |
| Sensitive data display | ⚠️ Partially done | UI redacts userAgent/token-like text and subscription links, but displays shortUuid and technical host names. | `redactSensitiveText()` | Confirm whether shortUuid should be masked. |

## 14. Tests

Test command: `npm.cmd run test:topor-balancer` from `backend`. Result: ✅ 23/23 passed.

| Area | Status | Test files / lines | Still needed |
| ---- | ------ | ------------------ | ------------ |
| Config validation | ❌ Missing | No direct config validator tests found. | Required/missing fields, duplicates, invalid JSON, invalid status/weight/maxUsers. |
| Format detection | ✅ Done | `topor-balancer-subscription.parser.spec.ts` lines 169, 189, 197, 282 | Add unknown-body case. |
| Base64 decode/encode | ✅ Done | Test line 169 and hash base64 test line 265 | Add invalid base64 explicit test. |
| VLESS parser | ✅ Done | Tests lines 116, 138, 154, 178 | Add `fp` assertion if typed. |
| Remark replacement | ✅ Done | Test line 138 | None. |
| Hash sticky selection | ✅ Done | Test line 244 | Add one-node/no-active/distribution tests. |
| Grouping/filtering | ✅ Done | Test line 204 | Add publicHostCode collision with different planCode. |
| Database assignment selection | ✅ Done | Tests lines 362, 377, 427 | Add real Postgres integration if possible. |
| Disabled/dead reassignment | ✅ Done | Test line 410 | Add manual reassign status validation test after fix. |
| Draining behavior | ✅ Done | Test line 393 | None. |
| Admin API auth | ⚠️ Partially done | Guard unit tests lines 469, 483 | Add controller/e2e route tests for 404/401. |
| UI auth flow | ❌ Missing | No frontend tests found. | Add React/UI tests for login, logout, 401/404 handling. |

## 15. Build and Deployment

| Item | Status | Comment | Relevant files | Still needed |
| ---- | ------ | ------- | -------------- | ------------ |
| Docker build works | ❓ Cannot verify | Docker CLI is not installed. | `Dockerfile` | Verify in Docker-capable environment. |
| Dockerfile updated if needed | ⚠️ Partially done | Dockerfile copies backend build and frontend dist, but does not mention/configure balancer config mount. `pg` is in backend dependencies, so DB mode dependency is included. | `Dockerfile` | Document build order and config mount. |
| docker-compose updated if needed | ⚠️ Partially done | Compose uses env file only; no config volume or DB service documented. | `docker-compose.yml`, `docker-compose-prod.yml` | Add optional config mount and Postgres example. |
| New env variables documented | ⚠️ Partially done | Present in `.env.sample`; detailed behavior only partly documented. | `.env.sample`, docs | Add deployment docs/env block. |
| Config mount documented | ❌ Missing | No mount docs found. | docs | Add mount instructions. |
| Database container documented | ❌ Missing | No DB compose/docs found. | docs/compose | Add Postgres example for database mode. |
| Caddy/Nginx routing documented | ❌ Missing | No reverse-proxy docs for admin route. | docs | Add proxy examples if required. |
| `/admin/topor-balancer` protection documented | ⚠️ Partially done | Admin API token is documented; UI/reverse-proxy protection is not. | `docs/topor-balancer-admin-api.md` | Document UI access considerations. |
| `docs/topor-balancer-audit.md` | ✅ Done | This file. | docs | Keep updated after fixes. |
| `docs/topor-balancer-admin-api.md` | ✅ Done | Existing route docs. | docs | Sync missing `/summary` route decision. |
| `docs/topor-balancer-ui.md` | ❌ Missing | Not present. | docs | Add UI docs. |
| Example `topor-balancer.config.json` | ❌ Missing | Not present. | repo/docs | Add example config. |
| Example env block | ⚠️ Partially done | `.env.sample` includes env keys. | `.env.sample` | Add docs with mode-specific examples. |

## 16. Manual Verification Plan

Use a reachable Remnawave Panel and a test user `shortUuid`. Replace placeholders before running.

1. Run disabled:

```powershell
$env:TOPOR_BALANCER_ENABLED='false'
$env:REMNAWAVE_PANEL_URL='https://panel.example.com'
$env:REMNAWAVE_API_TOKEN='<token>'
$env:INTERNAL_JWT_SECRET='<secret>'
npm.cmd run build
node dist/src/main
```

Verify `GET http://localhost:3010/<shortUuid>` matches upstream output byte-for-byte where headers/status allow.

2. Run enabled hash mode:

```powershell
$env:TOPOR_BALANCER_ENABLED='true'
$env:TOPOR_BALANCER_ASSIGNMENT_MODE='hash'
$env:TOPOR_BALANCER_CONFIG_PATH='C:\path\to\topor-balancer.config.json'
node dist/src/main
```

3. Test plain VLESS subscription:

```powershell
curl.exe -H "User-Agent: v2rayNG/1.9.0" http://localhost:3010/<shortUuid>
```

Confirm only configured matching technical hosts are grouped and renamed.

4. Test base64 subscription:

Request a client/profile that returns base64, then decode output:

```powershell
$body = curl.exe -H "User-Agent: ClashMeta" http://localhost:3010/<shortUuid>
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($body))
```

5. One public host with one node:

Use config with one location and one node. Confirm that one link remains and remark equals `publicName`.

6. One public host with multiple nodes:

Use `FI-STD-01`, `FI-STD-02`, `FI-STD-03` under one `publicHostCode`. Confirm output has one FI link.

7. Same `shortUuid` twice:

Call the same URL twice and compare selected technical host in debug logs or output remark before replacement in a test harness. It should be stable while config is unchanged.

8. Two different `shortUuid`s:

Call two users and verify selections can differ across technical nodes.

9. Disabled node:

Set node status `disabled` in config/hash mode or Admin API/database mode. Confirm it is not newly selected.

10. Dead node:

Set node status `dead`. Confirm it is not selected and existing DB assignment is reassigned.

11. Draining node:

In DB mode, create an assignment to a node, mark it `draining`, and confirm same user keeps it while new users do not receive it.

12. Admin API with valid token:

```powershell
curl.exe -H "Authorization: Bearer <admin-token>" http://localhost:3010/api/topor-balancer/health
```

13. Admin API with invalid token:

```powershell
curl.exe -i -H "Authorization: Bearer wrong" http://localhost:3010/api/topor-balancer/health
```

Expect `401`.

14. Admin UI login:

Open `http://localhost:3010/admin/topor-balancer`, paste token, verify health/nodes/assignments/requests load.

15. Node status change from UI:

Use Nodes tab actions `Drain`, `Disable`, `Enable`; verify API state and assignment behavior.

16. Manual reassignment:

In Assignments tab, choose an active target and confirm reassignment. Verify subsequent subscription returns the selected node group.

## 17. Risk Report

### Critical risks

| Risk | Affected files | Reproduce/verify | Suggested fix |
| ---- | -------------- | ---------------- | ------------- |
| No critical runtime-start blocker was confirmed in audited code. | n/a | Backend build passed; direct start reached Nest and failed only because audit panel URL was unreachable. | Verify startup in real deployment. |

### High risks

| Risk | Affected files | Reproduce/verify | Suggested fix |
| ---- | -------------- | ---------------- | ------------- |
| Hash grouping by `publicHostCode` can collapse different plans using the same public host code. | `topor-balancer-hash.processor.ts`, `topor-balancer-database.processor.ts` | Configure two locations with same `publicHostCode` and different `planCode`; output can keep only one. | Group and deduplicate by `publicHostCode + planCode`, and validate duplicates. |
| No active nodes for a matched public host drops all matched technical links instead of preserving original response for that host. | Hash/DB `filterSubscriptionBody()` | Mark all nodes under a public host as disabled/dead and request subscription. | Fail open per group: keep original matched lines when no safe selected node exists. |
| Admin PATCH/reassign lacks strong server-side validation. | `topor-balancer-admin.controller.ts`, `topor-balancer.service.ts`, `topor-balancer-database.repository.ts` | Send invalid `weight`, `maxUsers`, empty `publicName`, or reassign to disabled/dead node. | Add DTO/schema validation and enforce active target for manual reassignment. |

### Medium risks

| Risk | Affected files | Reproduce/verify | Suggested fix |
| ---- | -------------- | ---------------- | ------------- |
| Lint is failing. | Multiple TopoR backend files | Run `npm.cmd run lint` in backend. | Apply formatter/import-order fixes. |
| Frontend scripts are not cross-platform on Windows. | `frontend/package.json`, `backend/package.json` | Run `npm.cmd run start:build` or `start:prod` on Windows. | Use `cross-env` or document Linux-only scripts. |
| Admin UI expects fields backend does not provide (`updatedAt` for nodes, request `status/error`, health `requestCount/lastError`). | Admin page, backend types/repository/service | Load UI in DB mode and inspect empty/unknown columns. | Align API contract and UI. |
| Config validator does not catch duplicate technical hosts or public host/plan collisions. | `topor-balancer-config.validator.ts` | Add duplicate entries to config. | Add cross-location validation. |
| Deployment docs are incomplete. | `docs`, compose files | Look for config mount, DB, reverse proxy instructions. | Add deployment/admin UI docs and examples. |

### Low risks

| Risk | Affected files | Reproduce/verify | Suggested fix |
| ---- | -------------- | ---------------- | ------------- |
| `fp` is preserved in raw query but not exposed as typed parser field. | `ParsedVlessLink`, parser | Parse a link with `fp=chrome`; inspect returned object. | Add `fp?: string` if needed by callers/tests. |
| Debug logs include user identifiers and selected technical hosts. | Processors, `RootService.logToporBalancerDebug()` | Enable `TOPOR_BALANCER_DEBUG=true` and inspect logs. | Redact or document debug log sensitivity. |
| Docker build could not be verified locally. | Dockerfile/compose | Run in Docker-capable environment. | Add CI build check. |

## 18. Final Summary

| Area | Status | Comment |
| ---- | ------ | ------- |
| Backend integration | ⚠️ Partially done | Clean integration point and fail-open service exist; upstream status is not preserved and startup needs real-panel verification. |
| VLESS parsing | ✅ Done | Conservative parser supports VLESS+REALITY fields and remark replacement without rewriting query params. |
| Hash balancing | ⚠️ Partially done | Sticky weighted hash works for active nodes; publicHostCode-only grouping and no-active behavior need hardening. |
| Database assignments | ⚠️ Partially done | Schema, sticky assignments, draining behavior, and race handling exist; manual reassignment and API contract need validation polish. |
| Admin API | ⚠️ Partially done | Most requested routes exist and are token-protected; `/summary` is missing and body validation is weak. |
| Admin UI | ⚠️ Partially done | Usable token login, nodes, assignments, requests exist; no Settings tab, no Overview tab, and some fields are not backed by API. |
| Tests | ⚠️ Partially done | TopoR backend tests pass and cover core parser/hash/DB/guard behavior; config, UI, and HTTP route tests are missing. |
| Deployment docs | ❌ Missing | Env sample and Admin API docs exist, but config mount, DB mode, UI docs, reverse proxy guidance, and example config are missing. |

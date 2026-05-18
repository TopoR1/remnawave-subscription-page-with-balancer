# TopoR Balancer Production-Safety Fixes

Date: 2026-05-18

## Fixed Items

### 1. Composite public group key

Hash and database processors now group, select, and deduplicate nodes by:

```text
publicHostCode:planCode
```

This prevents plans such as `fi:standard` and `fi:game` from collapsing into one output group when they share a public host code.

Changed files:

- `backend/src/modules/topor-balancer/topor-balancer-hash.processor.ts`
- `backend/src/modules/topor-balancer/topor-balancer-database.processor.ts`
- `backend/src/modules/topor-balancer/topor-balancer-subscription.parser.spec.ts`

### 2. Preserve links when no active node exists

When a matched group has no safe active candidate, both hash and database modes now preserve the original matched links for that group instead of silently removing them.

The debug payload can include warnings such as:

```text
No active TopoR balancer node for fi:standard; preserving original links.
```

Changed files:

- `backend/src/modules/topor-balancer/types.ts`
- `backend/src/modules/topor-balancer/topor-balancer-hash.processor.ts`
- `backend/src/modules/topor-balancer/topor-balancer-database.processor.ts`
- `backend/src/modules/topor-balancer/topor-balancer-subscription.parser.spec.ts`

### 3. Config validation hardening

The config validator now rejects:

- duplicate `technicalHostName`;
- duplicate `publicHostCode + planCode` location groups.

Existing required-field and invalid-node-value validation is now covered by tests.

Changed files:

- `backend/src/modules/topor-balancer/topor-balancer-config.validator.ts`
- `backend/src/modules/topor-balancer/topor-balancer-subscription.parser.spec.ts`

### 4. Admin API validation

`PATCH /api/topor-balancer/nodes/:id` now rejects invalid values with `400 Bad Request`:

- `weight` must be a finite number greater than `0`;
- `maxUsers` must be an integer greater than or equal to `1`;
- `publicName` must be non-empty when provided;
- `status` must be one of `active`, `draining`, `disabled`, `dead`.

Manual reassignment now validates required string fields and rejects reassignment to mismatched or non-active nodes. The repository query also enforces `status = 'active'` for reassignment targets.

Changed files:

- `backend/src/modules/topor-balancer/topor-balancer.service.ts`
- `backend/src/modules/topor-balancer/topor-balancer-database.repository.ts`
- `backend/src/modules/topor-balancer/topor-balancer-subscription.parser.spec.ts`

### 5. Admin API/UI contract alignment

The backend now provides fields the Admin UI already expected:

- node `createdAt` and `updatedAt`;
- request `status` and `errorMessage`;
- health `requestCount` and optional `lastError`.

Schema initialization is idempotent and adds request columns with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

Changed files:

- `backend/src/modules/topor-balancer/types.ts`
- `backend/src/modules/topor-balancer/topor-balancer.service.ts`
- `backend/src/modules/topor-balancer/topor-balancer-database.repository.ts`
- `docs/topor-balancer-admin-api.md`

### 6. Lint cleanup

Backend lint formatting/import-order issues were fixed with the existing backend lint fixer.

The frontend stylelint script was changed from single-quoted to escaped double-quoted glob syntax so it works on Windows.

Changed files:

- `frontend/package.json`
- backend files touched by `npm.cmd run lint:fix`

## Tests Added

Added backend tests for:

- hash mode composite grouping with same `publicHostCode` and different `planCode`;
- database mode composite grouping with same `publicHostCode` and different `planCode`;
- hash mode preserving original links when all matched nodes are disabled/dead/draining;
- database mode preserving original links when no active candidate exists;
- config validation required fields;
- duplicate `technicalHostName`;
- duplicate `publicHostCode + planCode`;
- invalid status, weight, and maxUsers;
- invalid JSON loader path via `parseToporBalancerConfig`;
- invalid node update values;
- unsafe manual reassignment.

## Commands Run

From `backend`:

```powershell
npm.cmd run test:topor-balancer
npm.cmd run build
npm.cmd run lint
npm.cmd run lint:fix
npm.cmd run lint
npm.cmd run test:topor-balancer
```

From `frontend`:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run cb
```

## Results

| Check | Result |
| ---- | ------ |
| Backend build | ✅ Passed |
| Backend TopoR tests | ✅ Passed, 32/32 |
| Backend lint | ✅ Passed |
| Frontend typecheck | ✅ Passed |
| Frontend build (`npm.cmd run cb`) | ✅ Passed |
| Frontend lint | ⚠️ Runs now, but fails on existing CSS stylelint violations unrelated to TopoR Balancer behavior. |

## Remaining Known Issues

- Frontend stylelint reports existing CSS issues, mostly `rgba` vs `rgb` notation and one keyframe naming/empty-line rule. These are broad styling cleanups outside this production-safety pass.
- `npm.cmd run start:build` and backend `start:prod` still use inline Unix-style environment variables in package scripts; `npm.cmd run cb` and direct backend build were used for verification on Windows.
- Docker build and real Remnawave Panel startup were not verified in this pass.

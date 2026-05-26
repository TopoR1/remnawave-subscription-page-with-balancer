#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
IMAGE_TAG="${TOPOR_RELEASE_IMAGE_TAG:-topor-balancer-release-check:local}"
APP_PORT="${TOPOR_RELEASE_APP_PORT:-18082}"
MOCK_PORT="${TOPOR_RELEASE_MOCK_PORT:-18081}"
CONTAINER_NAME="${TOPOR_RELEASE_CONTAINER_NAME:-topor-balancer-release-check}"
RUN_DOCKER_SMOKE="${TOPOR_RELEASE_DOCKER_SMOKE:-1}"

tmp_dir="${TMPDIR:-/tmp}/topor-balancer-release-check.$$"
mock_pid=""

green() {
    printf '\033[32m%s\033[0m\n' "$1"
}

red() {
    printf '\033[31m%s\033[0m\n' "$1"
}

yellow() {
    printf '\033[33m%s\033[0m\n' "$1"
}

info() {
    printf '\n== %s ==\n' "$1"
}

cleanup() {
    if [ -n "$mock_pid" ]; then
        kill "$mock_pid" >/dev/null 2>&1 || true
    fi

    if command -v docker >/dev/null 2>&1; then
        docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    fi
    rm -rf "$tmp_dir"
}

trap cleanup EXIT INT TERM

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        red "FAIL: required command not found: $1"
        exit 2
    fi
}

run_step() {
    title="$1"
    shift

    info "$title"
    "$@"
}

run_npm() {
    directory="$1"
    shift

    (
        cd "$directory"
        npm "$@"
    )
}

http_code() {
    url="$1"
    body_file="$2"
    shift 2

    curl -fsS \
        --connect-timeout 5 \
        --max-time 30 \
        -o "$body_file" \
        -w '%{http_code}' \
        "$@" \
        "$url"
}

assert_contains() {
    file="$1"
    pattern="$2"
    message="$3"

    if grep -Eiq "$pattern" "$file"; then
        green "OK: $message"
    else
        red "FAIL: $message"
        printf '%s\n' "Expected pattern: $pattern"
        sed -n '1,80p' "$file" 2>/dev/null || true
        exit 1
    fi
}

assert_not_contains() {
    file="$1"
    pattern="$2"
    message="$3"

    if grep -Eiq "$pattern" "$file"; then
        red "FAIL: $message"
        grep -Ein "$pattern" "$file" | tail -20 || true
        exit 1
    fi

    green "OK: $message"
}

wait_for_http() {
    url="$1"
    body_file="$2"
    attempts="${3:-30}"
    count=1

    while [ "$count" -le "$attempts" ]; do
        code="$(http_code "$url" "$body_file" 2>/dev/null || true)"
        if [ "$code" = "200" ]; then
            return 0
        fi

        sleep 1
        count=$((count + 1))
    done

    return 1
}

write_smoke_files() {
    mkdir -p "$tmp_dir"

    cat > "$tmp_dir/topor-balancer.config.json" <<'JSON'
{
  "enabled": true,
  "locations": [
    {
      "publicHostCode": "fi_standard",
      "publicName": "Finland Standard",
      "locationCode": "FI",
      "planCode": "standard",
      "nodes": [
        {
          "technicalHostName": "FI-STD-01",
          "weight": 1,
          "maxUsers": 300,
          "status": "active"
        },
        {
          "technicalHostName": "FI-STD-02",
          "weight": 1,
          "maxUsers": 300,
          "status": "disabled"
        },
        {
          "technicalHostName": "FI-STD-03",
          "weight": 1,
          "maxUsers": 300,
          "status": "dead"
        }
      ]
    }
  ]
}
JSON

    cat > "$tmp_dir/mock-remnawave.mjs" <<'JS'
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const port = Number(process.argv[2]);
const standardFixture = readFileSync(process.argv[3], 'utf8');
const unsupportedFixture = readFileSync(process.argv[4], 'utf8');
const disabledDeadFixture = [
  'vless://44444444-4444-4444-8444-000000000002@fi-std-02.example.com:443?security=reality&type=tcp&sni=example.com&pbk=key&sid=sid#FI-STD-02',
  'vless://44444444-4444-4444-8444-000000000003@fi-std-03.example.com:443?security=reality&type=tcp&sni=example.com&pbk=key&sid=sid#FI-STD-03',
].join('\n');
const subpageConfigUuid = '00000000-0000-0000-0000-000000000000';
const subpageConfig = {
  version: '1',
  locales: ['ru', 'en'],
  brandingSettings: {
    title: 'Release Check',
    logoUrl: 'https://example.invalid/logo.svg',
    supportUrl: 'https://example.invalid/support',
  },
  uiConfig: {
    subscriptionInfoBlockType: 'hidden',
    installationGuidesBlockType: 'minimal',
  },
  baseSettings: {
    metaTitle: 'Release Check',
    metaDescription: 'Release Check',
    showConnectionKeys: false,
    hideGetLinkButton: false,
  },
  baseTranslations: {
    active: { en: 'Active', ru: 'Активна' },
    bandwidth: { en: 'Bandwidth', ru: 'Трафик' },
    connectionKeysHeader: { en: 'Connection keys', ru: 'Ключи подключения' },
    copyLink: { en: 'Copy link', ru: 'Скопировать ссылку' },
    expired: { en: 'Expired', ru: 'Истекла' },
    expires: { en: 'Expires', ru: 'Истекает' },
    expiresIn: { en: 'Expires in', ru: 'Истекает через' },
    getLink: { en: 'Get link', ru: 'Получить ссылку' },
    indefinitely: { en: 'Indefinitely', ru: 'Бессрочно' },
    inactive: { en: 'Inactive', ru: 'Неактивна' },
    installationGuideHeader: { en: 'Installation guide', ru: 'Инструкция по установке' },
    linkCopied: { en: 'Link copied', ru: 'Ссылка скопирована' },
    linkCopiedToClipboard: {
      en: 'Subscription link copied to clipboard',
      ru: 'Ссылка подписки скопирована в буфер обмена',
    },
    name: { en: 'Name', ru: 'Название' },
    scanQrCode: { en: 'Scan QR code', ru: 'Сканировать QR-код' },
    scanQrCodeDescription: {
      en: 'Scan this QR code from the app',
      ru: 'Сканируйте этот QR-код из приложения',
    },
    scanToImport: { en: 'Scan to import', ru: 'Сканируйте для импорта' },
    status: { en: 'Status', ru: 'Статус' },
    unknown: { en: 'Unknown', ru: 'Неизвестно' },
  },
  svgLibrary: {},
  platforms: {},
};

const json = (response, body) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const text = (response, body) => {
  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(body);
};

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (url.pathname === '/api/system/metadata') {
    json(response, {
      response: {
        version: '2.4.0-release-check',
        build: { time: '2026-01-01T00:00:00.000Z', number: 'release-check' },
        git: {
          backend: {
            commitSha: 'release-check',
            branch: 'release-check',
            commitUrl: 'https://example.invalid/release-check',
          },
          frontend: {
            commitSha: 'release-check',
            commitUrl: 'https://example.invalid/release-check',
          },
        },
      },
    });
    return;
  }

  if (url.pathname === '/api/subscription-page-configs/') {
    json(response, {
      response: {
        total: 1,
        configs: [
          {
            uuid: subpageConfigUuid,
            viewPosition: 0,
            name: 'Release Check',
            config: subpageConfig,
          },
        ],
      },
    });
    return;
  }

  if (url.pathname === `/api/subscription-page-configs/${subpageConfigUuid}`) {
    json(response, {
      response: {
        uuid: subpageConfigUuid,
        viewPosition: 0,
        name: 'Release Check',
        config: subpageConfig,
      },
    });
    return;
  }

  if (url.pathname === '/api/hosts/' || url.pathname === '/api/nodes/') {
    json(response, { response: [] });
    return;
  }

  if (url.pathname.startsWith('/api/sub/unsupported-app')) {
    text(response, unsupportedFixture);
    return;
  }

  if (url.pathname.startsWith('/api/sub/disabled-dead')) {
    text(response, disabledDeadFixture);
    return;
  }

  if (url.pathname.startsWith('/api/sub/')) {
    text(response, standardFixture);
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not found', path: url.pathname }));
}).listen(port, '127.0.0.1', () => {
  console.log(`mock Remnawave listening on ${port}`);
});
JS
}

run_docker_smoke() {
    require_command docker
    require_command curl
    require_command node

    write_smoke_files

    info "Runtime image assets"
    docker run --rm --entrypoint sh "$IMAGE_TAG" -c '
        test -f /opt/app/frontend/index.html
        test -d /opt/app/frontend/assets
        test -n "$(find /opt/app/frontend/assets -type f | head -1)"
    '
    green "OK: frontend assets exist in runtime image"

    info "Mocked Remnawave"
    node "$tmp_dir/mock-remnawave.mjs" \
        "$MOCK_PORT" \
        "$ROOT_DIR/fixtures/subscriptions/v2raytun-standard.decoded.txt" \
        "$ROOT_DIR/fixtures/subscriptions/app-not-supported.base64.txt" \
        > "$tmp_dir/mock-remnawave.log" 2>&1 &
    mock_pid="$!"
    sleep 1

    info "Runtime container"
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker run -d \
        --name "$CONTAINER_NAME" \
        --add-host=host.docker.internal:host-gateway \
        -p "127.0.0.1:${APP_PORT}:3010" \
        -v "$tmp_dir/topor-balancer.config.json:/opt/app/topor-balancer.config.json:ro" \
        -e APP_PORT=3010 \
        -e REMNAWAVE_PANEL_URL="http://host.docker.internal:${MOCK_PORT}" \
        -e REMNAWAVE_API_TOKEN=release-check-token \
        -e INTERNAL_JWT_SECRET=release-check-internal-jwt-secret \
        -e TOPOR_BALANCER_ENABLED=true \
        -e TOPOR_BALANCER_CONFIG_PATH=/opt/app/topor-balancer.config.json \
        -e TOPOR_BALANCER_ASSIGNMENT_MODE=hash \
        -e TOPOR_BALANCER_ADMIN_TOKEN=release-check-admin-token \
        "$IMAGE_TAG" >/dev/null

    admin_body="$tmp_dir/admin.html"
    if ! wait_for_http "http://127.0.0.1:${APP_PORT}/admin/topor-balancer" "$admin_body" 45; then
        red "FAIL: Nest app did not start or /admin/topor-balancer did not become ready"
        docker logs "$CONTAINER_NAME" --tail=200 || true
        exit 1
    fi
    green "OK: Nest app starts"

    logs="$tmp_dir/container.log"
    docker logs "$CONTAINER_NAME" > "$logs" 2>&1 || true
    assert_not_contains "$logs" 'SQLSTATE[[:space:]]*42601|SQLSTATE.*42601|code[:=][[:space:]]*'\''?42601'\''?' "no SQLSTATE 42601 in runtime logs"
    assert_not_contains "$logs" 'Connection to Remnawave Panel failed|Nest can'\''t resolve dependencies|Error in serveSubscriptionPage' "no known startup/runtime fatal log pattern"

    assert_contains "$admin_body" '<html|<!doctype html|<script|<link' "/admin/topor-balancer returns HTML"

    config_body="$tmp_dir/runtime-config.json"
    config_code="$(http_code "http://127.0.0.1:${APP_PORT}/assets/.app-config-v2.json" "$config_body" || true)"
    if [ "$config_code" != "200" ]; then
        red "FAIL: /assets/.app-config-v2.json returned HTTP $config_code"
        sed -n '1,80p' "$config_body" 2>/dev/null || true
        exit 1
    fi
    assert_contains "$config_body" '^[[:space:]]*\{' "/assets/.app-config-v2.json returns JSON"

    raw_body="$tmp_dir/raw-subscription.txt"
    raw_code="$(http_code "http://127.0.0.1:${APP_PORT}/release-check" "$raw_body" -A 'v2rayNG/1.9.0' || true)"
    if [ "$raw_code" != "200" ]; then
        red "FAIL: raw subscription fixture returned HTTP $raw_code"
        docker logs "$CONTAINER_NAME" --tail=200 || true
        exit 1
    fi
    assert_contains "$raw_body" 'Finland%20Standard|Finland Standard' "raw subscription fixture returns processed output"
    assert_not_contains "$raw_body" 'App%20not%20supported|App not supported|0\.0\.0\.0:1' "processed fixture is not unsupported-app fallback"

    disabled_body="$tmp_dir/disabled-dead.txt"
    disabled_code="$(http_code "http://127.0.0.1:${APP_PORT}/disabled-dead" "$disabled_body" -A 'v2rayNG/1.9.0' || true)"
    if [ "$disabled_code" = "502" ] || [ "$disabled_code" = "500" ] || [ -z "$disabled_code" ]; then
        red "FAIL: disabled/dead node fixture produced HTTP ${disabled_code:-no response}"
        docker logs "$CONTAINER_NAME" --tail=200 || true
        exit 1
    fi
    green "OK: disabled/dead node fixture did not produce 502"

    unsupported_body="$tmp_dir/unsupported-app.txt"
    unsupported_code="$(http_code "http://127.0.0.1:${APP_PORT}/unsupported-app" "$unsupported_body" -A 'UnknownClient/0.0' || true)"
    if [ "$unsupported_code" != "200" ]; then
        red "FAIL: unsupported-app fixture returned HTTP $unsupported_code"
        exit 1
    fi
    assert_contains "$unsupported_body" 'App%20not%20supported|App not supported|0\.0\.0\.0:1' "App not supported fallback is detected"

    docker logs "$CONTAINER_NAME" > "$logs" 2>&1 || true
    assert_not_contains "$logs" 'SQLSTATE[[:space:]]*42601|SQLSTATE.*42601|code[:=][[:space:]]*'\''?42601'\''?' "no SQLSTATE 42601 after smoke requests"
}

require_command npm
require_command node

printf '%s\n' "TopoR Balancer release check"
printf 'Project: %s\n' "$ROOT_DIR"
printf 'Image: %s\n' "$IMAGE_TAG"

run_step "1. Backend build" run_npm "$ROOT_DIR/backend" run build
run_step "2. Frontend build" run_npm "$ROOT_DIR/frontend" run cb
run_step "3. Backend tests" run_npm "$ROOT_DIR/backend" test
run_step "4. TopoR Balancer unit tests" run_npm "$ROOT_DIR/backend" run test:topor-balancer
run_step "5. TopoR Balancer e2e tests" run_npm "$ROOT_DIR/backend" run test:topor-balancer:e2e
run_step "6. Docker build" docker build -t "$IMAGE_TAG" "$ROOT_DIR"

if [ "$RUN_DOCKER_SMOKE" = "1" ]; then
    run_step "7. Docker smoke with mocked Remnawave" run_docker_smoke
else
    yellow "WARN: Docker smoke skipped because TOPOR_RELEASE_DOCKER_SMOKE=$RUN_DOCKER_SMOKE"
fi

printf '\n'
green "PASS: TopoR Balancer release check passed. This build is ready."

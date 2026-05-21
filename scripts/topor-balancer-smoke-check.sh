#!/usr/bin/env sh
set -u

DOMAIN="${1:-}"
ADMIN_TOKEN="${2:-}"
CADDY_CONTAINER="${3:-caddy}"
APP_CONTAINER="${4:-remnawave-subscription-page-with-balancer}"
APP_PORT="${APP_PORT:-}"

failures=0
tmp_dir="${TMPDIR:-/tmp}/topor-balancer-smoke-check.$$"

mkdir -p "$tmp_dir"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

red() {
    printf '\033[31m%s\033[0m\n' "$1"
}

green() {
    printf '\033[32m%s\033[0m\n' "$1"
}

yellow() {
    printf '\033[33m%s\033[0m\n' "$1"
}

info() {
    printf '-> %s\n' "$1"
}

ok() {
    green "OK: $1"
}

fail() {
    failures=$((failures + 1))
    red "FAIL: $1"
    if [ "${2:-}" ]; then
        printf '%s\n' "$2"
    fi
}

usage() {
    cat <<EOF
Usage:
  $0 <domain> <admin-token> [caddy-container] [app-container]

Example:
  $0 subs.topornet.com "\$TOPOR_BALANCER_ADMIN_TOKEN"

Defaults:
  caddy-container: ${CADDY_CONTAINER}
  app-container:   ${APP_CONTAINER}
EOF
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        fail "Не найдена команда: $1"
        exit 1
    fi
}

strip_scheme() {
    printf '%s' "$1" | sed -E 's#^https?://##; s#/$##'
}

http_get() {
    url="$1"
    output_file="$2"
    headers_file="$3"
    shift 3

    curl -k -L -sS \
        --connect-timeout 8 \
        --max-time 20 \
        -D "$headers_file" \
        -o "$output_file" \
        -w '%{http_code}' \
        "$@" \
        "$url"
}

container_http_probe() {
    container="$1"
    url="$2"

    docker exec "$container" sh -c '
        url="$1"
        if command -v wget >/dev/null 2>&1; then
            wget -S -O /dev/null --timeout=8 "$url" 2>&1
        elif command -v curl >/dev/null 2>&1; then
            curl -sS -o /dev/null -D - --connect-timeout 8 --max-time 20 "$url"
        else
            echo "Neither wget nor curl exists in container"
            exit 127
        fi
    ' sh "$url" 2>&1
}

if [ -z "$DOMAIN" ] || [ -z "$ADMIN_TOKEN" ]; then
    usage
    exit 2
fi

require_command docker
require_command curl

DOMAIN="$(strip_scheme "$DOMAIN")"
BASE_URL="https://${DOMAIN}"

printf '%s\n' "TopoR Balancer smoke-check"
printf '%s\n' "Domain: ${DOMAIN}"
printf '%s\n' "App container: ${APP_CONTAINER}"
printf '%s\n' "Caddy container: ${CADDY_CONTAINER}"
printf '\n'

info "1/8 Проверяю, что app container запущен"
container_state="$(docker inspect -f '{{.State.Running}}' "$APP_CONTAINER" 2>&1 || true)"
if [ "$container_state" = "true" ]; then
    ok "контейнер ${APP_CONTAINER} запущен"
else
    fail "backend crash / container не запущен" "$container_state"
fi

info "2/8 Проверяю NestJS startup marker в логах"
if docker logs "$APP_CONTAINER" --tail=300 2>&1 | grep -Fq "Nest application successfully started"; then
    ok "Nest application successfully started найден в логах"
else
    fail "backend crash / NestJS не дошел до успешного старта" \
        "Посмотрите: docker logs ${APP_CONTAINER} --tail=200"
fi

if [ -z "$APP_PORT" ]; then
    APP_PORT="$(docker exec "$APP_CONTAINER" sh -c 'printf "%s" "${APP_PORT:-3010}"' 2>/dev/null || printf '3010')"
fi

info "3/8 Проверяю, что app container слушает APP_PORT=${APP_PORT}"
port_check_output="$(
    docker exec "$APP_CONTAINER" node -e "
        const net = require('node:net');
        const port = Number(process.env.APP_PORT || '${APP_PORT}');
        const socket = net.createConnection({ host: '127.0.0.1', port });
        socket.setTimeout(4000);
        socket.once('connect', () => { socket.end(); process.exit(0); });
        socket.once('timeout', () => { console.error('timeout connecting to 127.0.0.1:' + port); socket.destroy(); process.exit(2); });
        socket.once('error', (error) => { console.error(error.message); process.exit(1); });
    " 2>&1
)"
if [ $? -eq 0 ]; then
    ok "порт ${APP_PORT} открыт внутри ${APP_CONTAINER}"
else
    fail "backend crash / app port closed" "$port_check_output"
fi

info "4/8 Проверяю доступ из Caddy container к app container"
internal_url="http://${APP_CONTAINER}:${APP_PORT}/admin/topor-balancer"
caddy_probe_output="$(container_http_probe "$CADDY_CONTAINER" "$internal_url")"
if printf '%s' "$caddy_probe_output" | grep -Eiq 'HTTP/[0-9.]+[[:space:]]+[0-9]{3}|HTTP[[:space:]]+[0-9]{3}'; then
    ok "Caddy получил HTTP-ответ от ${internal_url}"
else
    if printf '%s' "$caddy_probe_output" | grep -Eiq 'bad address|could not resolve|Name does not resolve|no such host'; then
        fail "Docker network issue / Caddy не резолвит app container" "$caddy_probe_output"
    elif printf '%s' "$caddy_probe_output" | grep -Eiq 'connection refused|Connection refused|Failed to connect'; then
        fail "Caddy proxy issue / app container найден, но порт закрыт" "$caddy_probe_output"
    else
        fail "Caddy proxy issue / нет HTTP-ответа от app container" "$caddy_probe_output"
    fi
fi

info "5/8 Проверяю runtime config через домен"
runtime_body="$tmp_dir/runtime-config.json"
runtime_headers="$tmp_dir/runtime-config.headers"
runtime_code="$(http_get "${BASE_URL}/assets/.app-config-v2.json" "$runtime_body" "$runtime_headers" || true)"
if [ "$runtime_code" = "200" ] && grep -Eq '^[[:space:]]*[\{\[]' "$runtime_body"; then
    ok "runtime config вернул 200 JSON"
else
    fail "runtime config issue / /assets/.app-config-v2.json не вернул 200 JSON" \
        "HTTP=${runtime_code}
$(head -40 "$runtime_headers" 2>/dev/null)
$(head -20 "$runtime_body" 2>/dev/null)"
fi

info "6/8 Проверяю Admin UI через домен"
admin_body="$tmp_dir/admin.html"
admin_headers="$tmp_dir/admin.headers"
admin_code="$(http_get "${BASE_URL}/admin/topor-balancer" "$admin_body" "$admin_headers" || true)"
if [ "$admin_code" = "200" ] && grep -Eiq '<html|<!doctype html|<script|<link' "$admin_body"; then
    ok "Admin UI вернул 200 HTML"
else
    fail "Caddy proxy issue / Admin UI не вернул 200 HTML" \
        "HTTP=${admin_code}
$(head -40 "$admin_headers" 2>/dev/null)
$(head -20 "$admin_body" 2>/dev/null)"
fi

info "7/8 Проверяю один JS/CSS asset из Admin HTML"
asset_path="$(
    sed -nE 's/.*<(script|link)[^>]+(src|href)="([^"]+\.(js|css))[^"]*".*/\3/p' "$admin_body" |
        grep -E '^/|^https?://' |
        head -1
)"
if [ -z "$asset_path" ]; then
    fail "asset serving issue / не удалось найти JS/CSS asset в HTML"
else
    case "$asset_path" in
        http://*|https://*) asset_url="$asset_path" ;;
        /*) asset_url="${BASE_URL}${asset_path}" ;;
        *) asset_url="${BASE_URL}/${asset_path}" ;;
    esac

    asset_body="$tmp_dir/asset.body"
    asset_headers="$tmp_dir/asset.headers"
    asset_code="$(http_get "$asset_url" "$asset_body" "$asset_headers" || true)"

    if [ "$asset_code" = "200" ]; then
        ok "asset ${asset_path} вернул 200"
    else
        fail "asset serving issue / asset не вернул 200" \
            "URL=${asset_url}
HTTP=${asset_code}
$(head -40 "$asset_headers" 2>/dev/null)"
    fi
fi

info "8/8 Проверяю Admin API health с Bearer token"
health_body="$tmp_dir/health.json"
health_headers="$tmp_dir/health.headers"
health_code="$(http_get "${BASE_URL}/api/topor-balancer/health" "$health_body" "$health_headers" -H "Authorization: Bearer ${ADMIN_TOKEN}" || true)"
if [ "$health_code" = "200" ] && grep -Eq '^[[:space:]]*\{' "$health_body"; then
    ok "Admin API health вернул 200 JSON"
else
    if [ "$health_code" = "401" ] || [ "$health_code" = "403" ] || [ "$health_code" = "404" ]; then
        fail "Admin API/token issue / health не доступен с переданным токеном" \
            "HTTP=${health_code}
$(head -40 "$health_headers" 2>/dev/null)
$(head -20 "$health_body" 2>/dev/null)"
    else
        fail "backend/runtime issue / health не вернул 200 JSON" \
            "HTTP=${health_code}
$(head -40 "$health_headers" 2>/dev/null)
$(head -20 "$health_body" 2>/dev/null)"
    fi
fi

printf '\n'
if [ "$failures" -eq 0 ]; then
    ok "Smoke-check пройден полностью"
    exit 0
fi

yellow "Smoke-check завершен с ошибками: ${failures}"
exit 1

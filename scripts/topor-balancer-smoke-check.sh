#!/usr/bin/env sh
set -u

DOMAIN="${1:-}"
SHORT_UUID="${2:-}"
USER_AGENT="${3:-}"

APP_CONTAINER="${APP_CONTAINER:-remnawave-subscription-page-with-balancer}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-topor-balancer-postgres}"
CADDY_CONTAINER="${CADDY_CONTAINER:-caddy}"
APP_PORT="${APP_PORT:-3010}"
RECENT_LOG_LINES="${RECENT_LOG_LINES:-500}"

failures=0
probable_causes=""
tmp_dir="${TMPDIR:-/tmp}/topor-balancer-smoke-check.$$"

mkdir -p "$tmp_dir"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

usage() {
    cat <<EOF
Usage:
  $0 <domain> <shortUuid> <userAgent>

Example:
  $0 subs.topornet.com Wf7tBzo8X8R8Z0dG "v2raytun/windows"

Optional environment overrides:
  APP_CONTAINER=${APP_CONTAINER}
  POSTGRES_CONTAINER=${POSTGRES_CONTAINER}
  CADDY_CONTAINER=${CADDY_CONTAINER}
  APP_PORT=${APP_PORT}
  TOPOR_BALANCER_ADMIN_TOKEN=<token>
EOF
}

strip_scheme() {
    printf '%s' "$1" | sed -E 's#^https?://##; s#/$##'
}

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

ok() {
    green "OK: $1"
}

add_cause() {
    cause="$1"

    if ! printf '%s\n' "$probable_causes" | grep -Fxq "$cause"; then
        probable_causes="${probable_causes}
${cause}"
    fi
}

fail() {
    failures=$((failures + 1))
    red "FAIL: $1"
    add_cause "$2"

    if [ "${3:-}" ]; then
        printf '%s\n' "$3"
    fi
}

warn() {
    yellow "WARN: $1"
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        red "FAIL: required command not found: $1"
        exit 2
    fi
}

container_running() {
    docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || true
}

container_health() {
    docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || true
}

http_get() {
    url="$1"
    output_file="$2"
    headers_file="$3"
    shift 3

    curl -k -L -sS \
        --connect-timeout 10 \
        --max-time 30 \
        -D "$headers_file" \
        -o "$output_file" \
        -w '%{http_code}' \
        "$@" \
        "$url"
}

content_type() {
    headers_file="$1"
    awk 'BEGIN{IGNORECASE=1} /^content-type:/ {print $0}' "$headers_file" |
        tail -1 |
        sed -E 's/^[Cc]ontent-[Tt]ype:[[:space:]]*//'
}

container_http_probe() {
    container="$1"
    url="$2"

    docker exec "$container" sh -c '
        url="$1"
        if command -v wget >/dev/null 2>&1; then
            wget -S -O /dev/null --timeout=10 "$url" 2>&1
        elif command -v curl >/dev/null 2>&1; then
            curl -sS -o /dev/null -D - --connect-timeout 10 --max-time 30 "$url"
        else
            echo "Neither wget nor curl exists in container"
            exit 127
        fi
    ' sh "$url" 2>&1
}

decode_with_base64() {
    input_file="$1"
    output_file="$2"
    normalized_file="$tmp_dir/base64.normalized"

    tr -d '[:space:]' < "$input_file" > "$normalized_file"

    if command -v base64 >/dev/null 2>&1; then
        if base64 -d "$normalized_file" > "$output_file" 2>/dev/null; then
            return 0
        fi
        if base64 -D "$normalized_file" > "$output_file" 2>/dev/null; then
            return 0
        fi
    fi

    if command -v openssl >/dev/null 2>&1; then
        if openssl base64 -d -A -in "$normalized_file" -out "$output_file" 2>/dev/null; then
            return 0
        fi
    fi

    return 1
}

prepare_subscription_plaintext() {
    input_file="$1"
    output_file="$2"

    if grep -aq 'vless://' "$input_file"; then
        cp "$input_file" "$output_file"
        printf '%s' "plain"
        return 0
    fi

    if decode_with_base64 "$input_file" "$output_file" && grep -aq 'vless://' "$output_file"; then
        printf '%s' "base64"
        return 0
    fi

    cp "$input_file" "$output_file"
    printf '%s' "unknown"
    return 0
}

print_remarks() {
    plain_file="$1"
    remarks_file="$tmp_dir/remarks.raw"

    grep -aEo 'vless://[^[:space:]]+' "$plain_file" |
        sed -n 's/^.*#//p' > "$remarks_file"

    if [ ! -s "$remarks_file" ]; then
        printf '%s\n' "(none)"
        return
    fi

    if command -v python3 >/dev/null 2>&1; then
        python3 - "$remarks_file" <<'PY'
import sys
from urllib.parse import unquote
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    print(unquote(line.rstrip("\n")))
PY
    else
        cat "$remarks_file"
    fi
}

json_summary() {
    json_file="$1"

    if command -v python3 >/dev/null 2>&1; then
        python3 - "$json_file" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8", errors="replace") as f:
    data = json.load(f)

fields = [
    "status",
    "totalVlessLinks",
    "matchedTechnicalLinks",
    "rewrittenLinksCount",
    "selectedNodes",
    "warnings",
]

for field in fields:
    value = data.get(field)
    if value is None and field == "rewrittenLinksCount":
        value = data.get("rewrittenLinksCount", 0)
    print(f"{field}: {json.dumps(value, ensure_ascii=False)}")

matched_groups = data.get("matchedGroups") or []
if matched_groups:
    print("matchedGroups:")
    for group in matched_groups:
        print(
            "  - "
            + json.dumps(
                {
                    "publicHostCode": group.get("publicHostCode"),
                    "planCode": group.get("planCode"),
                    "selectedTechnicalHostName": group.get("selectedTechnicalHostName"),
                    "rewrittenLinksCount": group.get("rewrittenLinksCount"),
                    "unchangedReasons": group.get("unchangedReasons"),
                },
                ensure_ascii=False,
            )
        )
PY
    else
        sed -n '1,80p' "$json_file"
    fi
}

if [ -z "$DOMAIN" ] || [ -z "$SHORT_UUID" ] || [ -z "$USER_AGENT" ]; then
    usage
    exit 2
fi

require_command docker
require_command curl
require_command grep
require_command sed
require_command awk

DOMAIN="$(strip_scheme "$DOMAIN")"
BASE_URL="https://${DOMAIN}"

printf '%s\n' "TopoR Balancer production smoke-check"
printf 'Domain: %s\n' "$DOMAIN"
printf 'shortUuid: %s\n' "$SHORT_UUID"
printf 'User-Agent: %s\n' "$USER_AGENT"
printf 'App container: %s\n' "$APP_CONTAINER"
printf 'Postgres container: %s\n' "$POSTGRES_CONTAINER"
printf 'Caddy container: %s\n' "$CADDY_CONTAINER"

info "1. Docker containers"
if [ "$(container_running "$APP_CONTAINER")" = "true" ]; then
    ok "${APP_CONTAINER} is running"
else
    fail "${APP_CONTAINER} is not running" "backend startup issue" \
        "Check: docker logs ${APP_CONTAINER} --tail=200"
fi

postgres_running="$(container_running "$POSTGRES_CONTAINER")"
postgres_health="$(container_health "$POSTGRES_CONTAINER")"
if [ "$postgres_running" = "true" ] && [ "$postgres_health" = "healthy" ]; then
    ok "${POSTGRES_CONTAINER} is running and healthy"
else
    fail "${POSTGRES_CONTAINER} is not healthy" "balancer DB error" \
        "running=${postgres_running:-unknown} health=${postgres_health:-unknown}
Check: docker logs ${POSTGRES_CONTAINER} --tail=200"
fi

if [ "$(container_running "$CADDY_CONTAINER")" = "true" ]; then
    ok "${CADDY_CONTAINER} is running"
else
    fail "${CADDY_CONTAINER} is not running" "Caddy proxy issue" \
        "Check: docker logs ${CADDY_CONTAINER} --tail=200"
fi

info "2. App startup logs"
app_logs="$tmp_dir/app.logs"
docker logs "$APP_CONTAINER" --tail="$RECENT_LOG_LINES" > "$app_logs" 2>&1 || true

if grep -Fq "Nest application successfully started" "$app_logs"; then
    ok "startup marker found"
else
    fail "startup marker is missing" "backend startup issue" \
        "Expected log line: Nest application successfully started"
fi

bad_app_patterns="Nest can't resolve dependencies|TopoR database balancer failed|TopoR database assignment selection failed|code: '42601'|code=42601|Error in serveSubscriptionPage"
if grep -E "$bad_app_patterns" "$app_logs" >/dev/null 2>&1; then
    fail "bad backend log pattern found" "backend startup issue" \
        "$(grep -En "$bad_app_patterns" "$app_logs" | tail -20)"
    if grep -Eq "42601|TopoR database balancer failed" "$app_logs"; then
        add_cause "balancer DB error"
    fi
else
    ok "no known bad backend log patterns found"
fi

info "3. Caddy DNS/network to backend"
internal_url="http://${APP_CONTAINER}:${APP_PORT}/admin/topor-balancer"
caddy_probe_output="$(container_http_probe "$CADDY_CONTAINER" "$internal_url")"
printf '%s\n' "$caddy_probe_output" > "$tmp_dir/caddy-probe.out"

if printf '%s' "$caddy_probe_output" | grep -Eiq 'HTTP/[0-9.]+[[:space:]]+[0-9]{3}|HTTP[[:space:]]+[0-9]{3}'; then
    ok "Caddy got an HTTP response from ${internal_url}"
else
    if printf '%s' "$caddy_probe_output" | grep -Eiq 'bad address|could not resolve|Name does not resolve|no such host'; then
        fail "Caddy cannot resolve backend container" "Docker network issue" "$caddy_probe_output"
    elif printf '%s' "$caddy_probe_output" | grep -Eiq 'connection refused|Failed to connect'; then
        fail "Caddy can resolve backend but connection is refused" "Caddy proxy issue" "$caddy_probe_output"
    elif printf '%s' "$caddy_probe_output" | grep -Eiq 'timeout|timed out'; then
        fail "Caddy backend probe timed out" "Docker network issue" "$caddy_probe_output"
    else
        fail "Caddy did not get an HTTP response from backend" "Caddy proxy issue" "$caddy_probe_output"
    fi
fi

info "4. Admin UI"
admin_body="$tmp_dir/admin.html"
admin_headers="$tmp_dir/admin.headers"
admin_code="$(http_get "${BASE_URL}/admin/topor-balancer" "$admin_body" "$admin_headers" || true)"
admin_type="$(content_type "$admin_headers")"

if [ "$admin_code" = "200" ] && printf '%s' "$admin_type" | grep -Eiq 'text/html' && grep -Eiq '<html|<!doctype html|<script|<link' "$admin_body"; then
    ok "Admin UI returned 200 HTML"
else
    fail "Admin UI did not return 200 HTML" "Caddy proxy issue" \
        "HTTP=${admin_code}
Content-Type=${admin_type}
$(head -40 "$admin_headers" 2>/dev/null)
$(head -20 "$admin_body" 2>/dev/null)"
fi

info "5. Runtime config"
runtime_body="$tmp_dir/runtime-config.json"
runtime_headers="$tmp_dir/runtime-config.headers"
runtime_code="$(http_get "${BASE_URL}/assets/.app-config-v2.json" "$runtime_body" "$runtime_headers" || true)"
runtime_type="$(content_type "$runtime_headers")"

if [ "$runtime_code" = "200" ] && printf '%s' "$runtime_type" | grep -Eiq 'application/json' && grep -Eq '^[[:space:]]*[\{\[]' "$runtime_body"; then
    ok "runtime config returned 200 application/json"
else
    fail "runtime config did not return 200 application/json" "runtime config issue" \
        "HTTP=${runtime_code}
Content-Type=${runtime_type}
$(head -40 "$runtime_headers" 2>/dev/null)
$(head -20 "$runtime_body" 2>/dev/null)"
fi

info "6. Raw subscription"
raw_body="$tmp_dir/raw-subscription.body"
raw_headers="$tmp_dir/raw-subscription.headers"
raw_code="$(http_get "${BASE_URL}/${SHORT_UUID}" "$raw_body" "$raw_headers" -A "$USER_AGENT" || true)"

if [ "$raw_code" = "200" ]; then
    ok "raw subscription returned HTTP 200"
else
    cause="raw subscription issue"
    if [ "$raw_code" = "500" ] || [ "$raw_code" = "502" ]; then
        cause="raw subscription issue"
    fi
    fail "raw subscription returned HTTP ${raw_code}" "$cause" \
        "$(head -40 "$raw_headers" 2>/dev/null)
$(head -20 "$raw_body" 2>/dev/null)"
fi

info "7. Subscription decode"
plain_body="$tmp_dir/subscription.decoded"
subscription_format="$(prepare_subscription_plaintext "$raw_body" "$plain_body")"
vless_count="$(grep -aEo 'vless://' "$plain_body" | wc -l | awk '{print $1}')"

printf 'format: %s\n' "$subscription_format"
printf 'vlessLinks: %s\n' "$vless_count"
printf '%s\n' "remarks:"
print_remarks "$plain_body"

if [ "$vless_count" -eq 0 ]; then
    fail "subscription contains no VLESS links" "raw subscription issue" \
        "$(head -30 "$plain_body" 2>/dev/null)"
fi

if grep -aEq 'vless://[^[:space:]]*@0\.0\.0\.0:1.*#App%20not%20supported|vless://[^[:space:]]*@0\.0\.0\.0:1.*#App not supported' "$plain_body"; then
    fail "App not supported fallback detected" "unsupported app fallback" \
        "The upstream returned vless://...@0.0.0.0:1#App not supported for User-Agent: ${USER_AGENT}"
fi

info "8. Balancer diagnostics"
admin_token="${TOPOR_BALANCER_ADMIN_TOKEN:-}"
if [ -z "$admin_token" ] && [ "$(container_running "$APP_CONTAINER")" = "true" ]; then
    admin_token="$(docker exec "$APP_CONTAINER" sh -c 'printf "%s" "${TOPOR_BALANCER_ADMIN_TOKEN:-}"' 2>/dev/null || true)"
fi

if [ -z "$admin_token" ]; then
    warn "TOPOR_BALANCER_ADMIN_TOKEN is not available; skipping protected diagnostics endpoint"
else
    diagnostics_body="$tmp_dir/diagnostics.json"
    diagnostics_headers="$tmp_dir/diagnostics.headers"
    diagnostics_payload="$tmp_dir/diagnostics-payload.json"
    if command -v python3 >/dev/null 2>&1; then
        python3 - "$SHORT_UUID" "$USER_AGENT" > "$diagnostics_payload" <<'PY'
import json
import sys
print(json.dumps({"shortUuid": sys.argv[1], "userAgent": sys.argv[2]}))
PY
    else
        safe_short_uuid="$(printf '%s' "$SHORT_UUID" | sed 's/\\/\\\\/g; s/"/\\"/g')"
        safe_user_agent="$(printf '%s' "$USER_AGENT" | sed 's/\\/\\\\/g; s/"/\\"/g')"
        cat > "$diagnostics_payload" <<EOF
{"shortUuid":"${safe_short_uuid}","userAgent":"${safe_user_agent}"}
EOF
    fi
    diagnostics_code="$(curl -k -L -sS \
        --connect-timeout 10 \
        --max-time 60 \
        -D "$diagnostics_headers" \
        -o "$diagnostics_body" \
        -w '%{http_code}' \
        -H "Authorization: Bearer ${admin_token}" \
        -H "Content-Type: application/json" \
        --data @"$diagnostics_payload" \
        "${BASE_URL}/api/topor-balancer/diagnostics/subscription" || true)"

    if [ "$diagnostics_code" = "200" ] && grep -Eq '^[[:space:]]*\{' "$diagnostics_body"; then
        ok "diagnostics endpoint returned 200 JSON"
        json_summary "$diagnostics_body"

        if grep -Eq '"status"[[:space:]]*:[[:space:]]*"unsupported_app"' "$diagnostics_body"; then
            fail "diagnostics status is unsupported_app" "unsupported app fallback"
        fi
        if grep -Eq '"matchedTechnicalLinks"[[:space:]]*:[[:space:]]*0' "$diagnostics_body"; then
            fail "diagnostics matchedTechnicalLinks is 0" "no matched technicalHostName"
        fi
        if grep -Eq '42601|TopoR database balancer failed' "$diagnostics_body"; then
            fail "diagnostics contain database error marker" "balancer DB error"
        fi
    else
        fail "diagnostics endpoint did not return 200 JSON" "backend startup issue" \
            "HTTP=${diagnostics_code}
$(head -40 "$diagnostics_headers" 2>/dev/null)
$(head -20 "$diagnostics_body" 2>/dev/null)"
    fi
fi

info "9. Recent Caddy logs"
caddy_logs="$tmp_dir/caddy.logs"
docker logs "$CADDY_CONTAINER" --tail="$RECENT_LOG_LINES" > "$caddy_logs" 2>&1 || true
caddy_bad_patterns='EOF|502|dial tcp|timeout|connection refused'

if grep -Eiq "$caddy_bad_patterns" "$caddy_logs"; then
    fail "bad Caddy log pattern found" "Caddy proxy issue" \
        "$(grep -Ein "$caddy_bad_patterns" "$caddy_logs" | tail -30)"
else
    ok "no recent Caddy EOF/502/dial/timeout/refused patterns found"
fi

printf '\n'
printf '%s\n' "Summary"
printf '%s\n' "-------"

if [ "$failures" -eq 0 ]; then
    green "PASS: Balancer looks production-ready."
    exit 0
fi

red "FAIL: Balancer smoke-check found ${failures} issue(s)."
printf '%s\n' "Probable cause(s):"
printf '%s\n' "$probable_causes" |
    sed '/^[[:space:]]*$/d; s/^/- /'
exit 1

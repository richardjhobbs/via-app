#!/bin/bash
# RRG domain reputation monitor.
# Checks realrealgenuine.com against 5 DNS resolvers every run, compares to
# last state, posts a Telegram alert on change. Intended to run via cron on
# the VPS so Richard knows the moment Cisco Umbrella or Quad9 flip us clean.
set -euo pipefail

DOMAIN="realrealgenuine.com"
EXPECTED_IP="89.167.89.219"
STATE_FILE="/home/agent/logs/rrg-rep.state"
LOG_FILE="/home/agent/logs/rrg-rep.log"
ENV_FILE="/home/agent/apps/rrg/.env.local"
TG_CHAT_ID="798889754"

TG_BOT_TOKEN="$(grep -E '^TG_BOT_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"')"

# Resolver map: label -> ip. Order matters in the log output.
RESOLVERS=(
  "cloudflare:1.1.1.1"
  "google:8.8.8.8"
  "quad9_filtered:9.9.9.9"
  "quad9_unfiltered:9.9.9.10"
  "umbrella:208.67.222.222"
)

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
current=""
summary=""

# Single dig probe. Returns first IPv4-looking line, empty if no answer.
# Exit code 0 = answered (possibly with NXDOMAIN/empty). Non-zero = network
# error (timeout, refused). Errors are kept off stdout via 2>/dev/null and
# the awk filter so transient dig stderr never leaks into the result.
probe() {
  local resolver="$1"
  dig "@$resolver" "$DOMAIN" +short +time=5 +tries=1 2>/dev/null \
    | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ { print; exit }'
}

transient=0
for entry in "${RESOLVERS[@]}"; do
  label="${entry%%:*}"
  resolver="${entry##*:}"

  # First probe + timeout-aware retry. dig itself returns non-zero on
  # connection failure, which we want to distinguish from a clean NXDOMAIN.
  rc=0
  result="$(probe "$resolver")" || rc=$?
  if [ $rc -ne 0 ] && [ -z "$result" ]; then
    sleep 2
    rc=0
    result="$(probe "$resolver")" || rc=$?
  fi

  if [ $rc -ne 0 ] && [ -z "$result" ]; then
    # Real network/timeout error after retry. Not a classifier verdict.
    status="TRANSIENT_ERROR"
    transient=1
  elif [ -z "$result" ]; then
    status="BLOCKED_NXDOMAIN"
  elif [ "$result" = "$EXPECTED_IP" ]; then
    status="CLEAN"
  else
    # Valid IPv4 answer that is not ours, e.g. Umbrella's hit-phish page.
    status="BLOCKED_$result"
  fi

  current="${current}${label}=${status};"
  summary="${summary}  ${label}: ${status}\n"
done

# Append every run to the log so we have a timeline.
printf '[%s] %s\n' "$ts" "$current" >> "$LOG_FILE"

# Compare to previous state.
prev=""
if [ -f "$STATE_FILE" ]; then
  prev="$(cat "$STATE_FILE")"
fi

# Suppress alerts when ANY resolver came back TRANSIENT_ERROR. Network
# blips are not reputation events, and alerting on them trains the eye to
# ignore real changes. State file is also NOT updated, so the next clean
# run will compare against the last known stable state.
if [ "$current" != "$prev" ] && [ "$transient" -eq 0 ]; then
  echo "$current" > "$STATE_FILE"

  # Skip Telegram alert on the very first run (no prior state to compare).
  if [ -n "$prev" ] && [ -n "$TG_BOT_TOKEN" ]; then
    msg="🔔 RRG reputation state changed at ${ts}%0A%0ABefore:%0A$(printf '%s' "$prev" | sed 's/;/%0A/g')%0A%0AAfter:%0A$(printf '%s' "$current" | sed 's/;/%0A/g')"
    curl -s -o /dev/null -X POST \
      "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TG_CHAT_ID}" \
      -d "text=${msg}" \
      -d "parse_mode=HTML" || true
  fi
fi

# Stdout summary is handy when running manually.
printf '[%s] RRG reputation\n%b' "$ts" "$summary"

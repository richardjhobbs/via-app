#!/bin/bash
# update-vps-env.sh — Safely update a SINGLE env var on VPS without overwriting others.
# Usage: ./scripts/update-vps-env.sh KEY VALUE
# Example: ./scripts/update-vps-env.sh NEXT_PUBLIC_VIA_CONTRACT_ADDRESS 0x1234...
#
# NEVER use: scp .env.local agent@VPS:.env.local  ← destroys VPS-only secrets

set -e

KEY="$1"
VALUE="$2"
VPS="agent@89.167.89.219"
ENV_FILE="/home/agent/apps/rrg/.env.local"
SSH_KEY="$HOME/.ssh/id_ed25519"

if [ -z "$KEY" ] || [ -z "$VALUE" ]; then
  echo "Usage: $0 KEY VALUE"
  exit 1
fi

echo "Updating $KEY on VPS..."

# Update in place with sed, or append if key doesn't exist
ssh -i "$SSH_KEY" "$VPS" "
  if grep -q '^${KEY}=' ${ENV_FILE}; then
    sed -i 's|^${KEY}=.*|${KEY}=${VALUE}|' ${ENV_FILE}
    echo '  Updated existing key'
  else
    echo '${KEY}=${VALUE}' >> ${ENV_FILE}
    echo '  Added new key'
  fi
  grep '^${KEY}=' ${ENV_FILE} | sed 's/=.*/=***REDACTED***/'
"

echo "Done. Remember to restart rrg-app if needed."

#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--yes" ]]; then
  echo "Usage: $0 --yes" >&2
  echo "This invalidates all production recommendation caches and restarts the backend." >&2
  exit 1
fi

if [[ ! -f .env.ec2 ]]; then
  echo ".env.ec2 was not found. Run this command from the repository root on EC2." >&2
  exit 1
fi

compose=(docker compose --env-file .env.ec2 -f compose.ec2.yaml)

"${compose[@]}" --profile operations run --rm clear-recommendation-cache --yes
"${compose[@]}" restart backend
"${compose[@]}" ps backend

echo "Production recommendation caches were cleared; generation history was preserved."

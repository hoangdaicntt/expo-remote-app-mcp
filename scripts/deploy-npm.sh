#!/usr/bin/env bash
set -euo pipefail

PACKAGES=(
  "expo-remote-app-mcp"
  "expo-remote-app-bridge"
)

NPM_USERCONFIG=""
PUBLISH_ARGS=()
if [[ -n "${NPM_OTP:-}" ]]; then
  PUBLISH_ARGS+=("--otp=${NPM_OTP}")
fi

cleanup() {
  if [[ -n "${NPM_USERCONFIG}" && -f "${NPM_USERCONFIG}" ]]; then
    rm -f "${NPM_USERCONFIG}"
  fi
}
trap cleanup EXIT

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "Skipping npm login check for dry run."
elif [[ -n "${NPM_TOKEN:-}" ]]; then
  echo "Using NPM_TOKEN for publishing."
  NPM_USERCONFIG="$(mktemp)"
  printf '//registry.npmjs.org/:_authToken=%s\n' "${NPM_TOKEN}" > "${NPM_USERCONFIG}"
  export NPM_CONFIG_USERCONFIG="${NPM_USERCONFIG}"
else
  echo "Checking npm login..."
  npm whoami >/dev/null
fi

echo "Running typecheck..."
npm run typecheck

echo "Running build..."
npm run build

for package_name in "${PACKAGES[@]}"; do
  echo "Packing ${package_name}..."
  npm pack --dry-run -w "${package_name}"
done

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "Dry run complete. No packages were published."
  exit 0
fi

for package_name in "${PACKAGES[@]}"; do
  echo "Publishing ${package_name}..."
  publish_command=(npm publish -w "${package_name}")

  if [[ ${#PUBLISH_ARGS[@]} -gt 0 ]]; then
    publish_command+=("${PUBLISH_ARGS[@]}")
  fi

  "${publish_command[@]}"
done

echo "Done."

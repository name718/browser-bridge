#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/didi/Desktop/my-project/browser-bridge-1"
REGISTRY="https://registry.npmjs.org/"
TMP_DIR="/private/tmp"

SHARED_VERSION="0.1.2"
EXTENSION_VERSION="0.1.2"
MCP_VERSION="0.1.4"

cd "$ROOT"

source "$HOME/.nvm/nvm.sh"
nvm use 22.22.1

set_package_version() {
  local package_dir="$1"
  local version="$2"
  local current

  cd "$package_dir"
  current="$(node -p "require('./package.json').version")"
  if [[ "$current" == "$version" ]]; then
    echo "    skip $(basename "$package_dir"): already $version"
    return
  fi

  npm version "$version" --no-git-tag-version
}

npm_version_exists() {
  local package_name="$1"
  local version="$2"

  npm view "$package_name@$version" version --registry="$REGISTRY" >/dev/null 2>&1
}

echo "==> Bump versions"
set_package_version "$ROOT/packages/shared" "$SHARED_VERSION"
set_package_version "$ROOT/packages/extension" "$EXTENSION_VERSION"
set_package_version "$ROOT/packages/mcp-server" "$MCP_VERSION"

cd "$ROOT"
perl -0pi -e "s/\"version\": \"[^\"]+\"/\"version\": \"$EXTENSION_VERSION\"/" packages/extension/public/manifest.json
perl -0pi -e "s/browser-bridge-extension-[0-9]+\.[0-9]+\.[0-9]+\.zip/browser-bridge-extension-$EXTENSION_VERSION.zip/g" README.md packages/mcp-server/README.md packages/shared/README.md

echo "==> Install"
pnpm install --no-frozen-lockfile

echo "==> Typecheck"
pnpm typecheck

echo "==> Build all"
pnpm build

echo "==> Build release extension zip"
mkdir -p "$ROOT/release"
ditto -c -k --sequesterRsrc --keepParent "$ROOT/packages/extension/dist" "$ROOT/release/browser-bridge-extension-$EXTENSION_VERSION.zip"

echo "==> Verify extension zip version"
unzip -p "$ROOT/release/browser-bridge-extension-$EXTENSION_VERSION.zip" dist/manifest.json | grep "\"version\": \"$EXTENSION_VERSION\""

echo "==> Verify README download links"
if command -v rg >/dev/null 2>&1; then
  rg "browser-bridge-extension-$EXTENSION_VERSION\.zip" "$ROOT/README.md" "$ROOT/packages/mcp-server/README.md" "$ROOT/packages/shared/README.md"
else
  grep -n "browser-bridge-extension-$EXTENSION_VERSION\.zip" "$ROOT/README.md" "$ROOT/packages/mcp-server/README.md" "$ROOT/packages/shared/README.md"
fi

echo "==> Pack shared"
cd "$ROOT/packages/shared"
pnpm pack --pack-destination "$TMP_DIR"

echo "==> Pack mcp-server"
cd "$ROOT/packages/mcp-server"
pnpm pack --pack-destination "$TMP_DIR"

SHARED_TGZ="$TMP_DIR/majuntao-1-browser-bridge-shared-$SHARED_VERSION.tgz"
MCP_TGZ="$TMP_DIR/majuntao-1-browser-bridge-mcp-server-$MCP_VERSION.tgz"

echo "==> Verify packed files exist"
test -f "$SHARED_TGZ"
test -f "$MCP_TGZ"

echo "==> Check packed mcp-server dependency"
tar -xOf "$MCP_TGZ" package/package.json | grep "\"@majuntao-1/browser-bridge-shared\": \"$SHARED_VERSION\""

echo "==> Check npm auth"
npm whoami --registry="$REGISTRY"

echo "==> Publish shared"
if npm_version_exists "@majuntao-1/browser-bridge-shared" "$SHARED_VERSION"; then
  echo "    skip shared: @majuntao-1/browser-bridge-shared@$SHARED_VERSION already exists"
else
  cd "$ROOT/packages/shared"
  npm publish --access public --registry="$REGISTRY"
fi

echo "==> Publish mcp-server"
if npm_version_exists "@majuntao-1/browser-bridge-mcp-server" "$MCP_VERSION"; then
  echo "    skip mcp-server: @majuntao-1/browser-bridge-mcp-server@$MCP_VERSION already exists"
else
  cd "$ROOT/packages/mcp-server"
  npm publish --access public --registry="$REGISTRY"
fi

echo "==> Done"
echo "Published: @majuntao-1/browser-bridge-shared@$SHARED_VERSION"
echo "Published: @majuntao-1/browser-bridge-mcp-server@$MCP_VERSION"
echo "Extension zip: $ROOT/release/browser-bridge-extension-$EXTENSION_VERSION.zip"

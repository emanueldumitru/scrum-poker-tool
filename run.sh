#!/usr/bin/env bash
# Scrum Poker: one command to install, build and start the app.
#
#   ./run.sh           Share on your network: colleagues on the same office LAN/Wi-Fi or VPN
#                      can join with the "Your network" / "VPN" links printed at startup.
#   ./run.sh --local   Only this computer can open it.
#   ./run.sh --dev     Development mode with hot reload (this computer only).
#
# Options via environment, e.g.  PORT=4000 ./run.sh   (see .env.example for all settings)
set -euo pipefail
cd "$(dirname "$0")"

mode=network
for arg in "$@"; do
  case "$arg" in
    --local) mode=local ;;
    --dev) mode=dev ;;
    -h | --help)
      sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (see ./run.sh --help)" >&2
      exit 1
      ;;
  esac
done

# --- Node.js 22.18+ ------------------------------------------------------------------
# Accept `node` from PATH, otherwise the newest suitable nvm install (works even when nvm is
# only lazy-loaded by the interactive shell and `node` is not on PATH).
node_ok() {
  "$1" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)' 2>/dev/null
}
node_candidates() {
  ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/v*/bin/node 2>/dev/null | sort -rV # newest nvm install first
  ls -d "$HOME/.volta/bin/node" "$HOME/.asdf/shims/node" /opt/homebrew/bin/node /usr/local/bin/node 2>/dev/null
}
node_bin=""
if command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then
  node_bin="$(command -v node)"
else
  while IFS= read -r candidate; do
    if node_ok "$candidate"; then
      node_bin="$candidate"
      break
    fi
  done < <(node_candidates)
fi
if [ -z "$node_bin" ]; then
  echo "Scrum Poker needs Node.js 22.18 or newer: https://nodejs.org (or: nvm install 24)" >&2
  exit 1
fi
export PATH="$(dirname "$node_bin"):$PATH"

# --- Dependencies (only when missing or package-lock.json changed) ----------------------
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installing dependencies…"
  npm ci --include=dev --no-audit --no-fund --loglevel=error
fi

# --- Web client build (only when missing or older than the sources) ---------------------
if [ "$mode" != dev ]; then
  if [ ! -f dist/client/index.html ] ||
    [ -n "$(find src/client src/shared vite.config.ts package-lock.json -newer dist/client/index.html -print -quit 2>/dev/null)" ]; then
    echo "Building the web client…"
    npm run build --silent >/dev/null
  fi
fi

# --- Start (exec: Ctrl+C goes straight to the server, which saves games and exits cleanly) ---
case "$mode" in
  dev) exec node --watch src/server/index.ts --dev ;;
  local) HOST="${HOST:-127.0.0.1}" exec node src/server/index.ts ;;
  network) exec node src/server/index.ts ;;
esac

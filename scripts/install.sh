#!/usr/bin/env sh
set -e

REPO="pankyada/base"
INSTALL_DIR="$HOME/.local/bin"
HARNESS_DIR="$HOME/.harness"
PROFILE_DIR="$HARNESS_DIR/profiles"
BASE_URL="https://github.com/${REPO}/releases/latest/download"
NO_INIT=0

for ARG in "$@"; do
  case "${ARG}" in
    --no-init) NO_INIT=1 ;;
    *) echo "Unknown option: ${ARG}" >&2; exit 1 ;;
  esac
done

OS=$(uname -s)
ARCH=$(uname -m)

case "${OS}" in
  Darwin)
    case "${ARCH}" in
      arm64)
        SUFFIX="macos-arm64"
        TUI_SUFFIX="darwin-arm64"
        ;;
      x86_64)
        SUFFIX="macos-x64"
        TUI_SUFFIX="darwin-amd64"
        ;;
      *)
        echo "Unsupported macOS architecture: ${ARCH}"
        exit 1
        ;;
    esac
    ;;
  Linux)
    case "${ARCH}" in
      x86_64)
        SUFFIX="linux-x64"
        TUI_SUFFIX="linux-amd64"
        ;;
      *)
        echo "Unsupported Linux architecture: ${ARCH}"
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Unsupported OS: ${OS}"
    exit 1
    ;;
esac

mkdir -p "${INSTALL_DIR}" "${HARNESS_DIR}"

echo "Installing harness to ${INSTALL_DIR}..."

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo "Using gh CLI to download release assets..."
  gh release download -R "${REPO}" -p "harness-${SUFFIX}" -p "harness-server-${SUFFIX}" -p "harness-tui-${TUI_SUFFIX}" -p "harness-profiles.tar.gz" --dir "${INSTALL_DIR}" --clobber
  mv "${INSTALL_DIR}/harness-${SUFFIX}" "${INSTALL_DIR}/harness"
  mv "${INSTALL_DIR}/harness-server-${SUFFIX}" "${INSTALL_DIR}/harness-server"
  mv "${INSTALL_DIR}/harness-tui-${TUI_SUFFIX}" "${INSTALL_DIR}/harness-tui"
else
  echo "Using curl to download release assets..."
  CURL_OPTS="-fsSL"
  if [ -n "${GITHUB_TOKEN}" ]; then
    CURL_AUTH="-H \"Authorization: token ${GITHUB_TOKEN}\""
  elif [ -n "${GH_TOKEN}" ]; then
    CURL_AUTH="-H \"Authorization: token ${GH_TOKEN}\""
  else
    CURL_AUTH=""
  fi
  
  eval "curl ${CURL_OPTS} ${CURL_AUTH} \"${BASE_URL}/harness-${SUFFIX}\" -o \"${INSTALL_DIR}/harness\""
  eval "curl ${CURL_OPTS} ${CURL_AUTH} \"${BASE_URL}/harness-server-${SUFFIX}\" -o \"${INSTALL_DIR}/harness-server\""
  eval "curl ${CURL_OPTS} ${CURL_AUTH} \"${BASE_URL}/harness-tui-${TUI_SUFFIX}\" -o \"${INSTALL_DIR}/harness-tui\""
  eval "curl ${CURL_OPTS} ${CURL_AUTH} \"${BASE_URL}/harness-profiles.tar.gz\" -o \"${INSTALL_DIR}/harness-profiles.tar.gz\""
fi

chmod +x "${INSTALL_DIR}/harness" "${INSTALL_DIR}/harness-server" "${INSTALL_DIR}/harness-tui"

if [ ! -f "${PROFILE_DIR}/coding.yaml" ]; then
  tar -xzf "${INSTALL_DIR}/harness-profiles.tar.gz" -C "${HARNESS_DIR}"
  echo "Installed default profiles to ${PROFILE_DIR}"
else
  echo "Keeping existing profiles in ${PROFILE_DIR}"
fi
rm -f "${INSTALL_DIR}/harness-profiles.tar.gz"

echo ""
echo "Installed:"
echo "  harness        → ${INSTALL_DIR}/harness"
echo "  harness-server → ${INSTALL_DIR}/harness-server"
echo "  harness-tui    → ${INSTALL_DIR}/harness-tui"
echo ""
echo "Make sure ${INSTALL_DIR} is in your PATH."
echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
echo ""
"${INSTALL_DIR}/harness-server" --version

if [ "${NO_INIT}" -eq 0 ] && [ -t 0 ]; then
  exec "${INSTALL_DIR}/harness" init
fi

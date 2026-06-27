#!/usr/bin/env sh
set -e

REPO="pankyada/base"
INSTALL_DIR="$HOME/.local/bin"
BASE_URL="https://github.com/${REPO}/releases/latest/download"

OS=$(uname -s)
ARCH=$(uname -m)

case "${OS}" in
  Darwin)
    case "${ARCH}" in
      arm64)
        SUFFIX="macos-arm64"
        ;;
      x86_64)
        SUFFIX="macos-x64"
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

mkdir -p "${INSTALL_DIR}"

echo "Installing harness to ${INSTALL_DIR}..."

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo "Using gh CLI to download release assets..."
  gh release download -R "${REPO}" -p "harness-${SUFFIX}" -p "harness-server-${SUFFIX}" -p "harness-tui-${SUFFIX}" --dir "${INSTALL_DIR}" --clobber
  mv "${INSTALL_DIR}/harness-${SUFFIX}" "${INSTALL_DIR}/harness"
  mv "${INSTALL_DIR}/harness-server-${SUFFIX}" "${INSTALL_DIR}/harness-server"
  mv "${INSTALL_DIR}/harness-tui-${SUFFIX}" "${INSTALL_DIR}/harness-tui"
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
  eval "curl ${CURL_OPTS} ${CURL_AUTH} \"${BASE_URL}/harness-tui-${SUFFIX}\" -o \"${INSTALL_DIR}/harness-tui\""
fi

chmod +x "${INSTALL_DIR}/harness" "${INSTALL_DIR}/harness-server" "${INSTALL_DIR}/harness-tui"

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

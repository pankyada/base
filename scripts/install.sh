#!/usr/bin/env sh
set -e

REPO="pankyada/base"
INSTALL_DIR="$HOME/.local/bin"
BASE_URL="https://github.com/${REPO}/releases/latest/download"

OS=$(uname -s)
ARCH=$(uname -m)

case "${OS}" in
  Darwin)
    SERVER_BIN="harness-server"
    ;;
  Linux)
    case "${ARCH}" in
      x86_64)
        SERVER_BIN="harness-server-linux-x64"
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

curl -fsSL "${BASE_URL}/harness" -o "${INSTALL_DIR}/harness"
curl -fsSL "${BASE_URL}/${SERVER_BIN}" -o "${INSTALL_DIR}/harness-server"
curl -fsSL "${BASE_URL}/harness-tui" -o "${INSTALL_DIR}/harness-tui"

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

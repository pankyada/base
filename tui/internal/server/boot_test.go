package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServerBinaryPathUsesPlatformExecutableSuffix(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "harness-tui.exe")
	if got, want := serverBinaryPath(executable, "windows"), filepath.Join(dir, "harness-server.exe"); got != want {
		t.Fatalf("windows binary path = %q, want %q", got, want)
	}
	if got, want := serverBinaryPath("/usr/local/bin/harness-tui", "linux"), "/usr/local/bin/harness-server"; got != want {
		t.Fatalf("unix binary path = %q, want %q", got, want)
	}
}

func TestServerCommandPrefersInstalledSiblingOverCheckoutSource(t *testing.T) {
	repo := t.TempDir()
	if err := os.WriteFile(filepath.Join(repo, "pnpm-workspace.yaml"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	devEntry := filepath.Join(repo, "src", "server", "index.ts")
	if err := os.MkdirAll(filepath.Dir(devEntry), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(devEntry, nil, 0o600); err != nil {
		t.Fatal(err)
	}

	binDir := t.TempDir()
	executable := filepath.Join(binDir, "harness-tui")
	serverBinary := serverBinaryPath(executable, "darwin")
	if err := os.WriteFile(serverBinary, nil, 0o700); err != nil {
		t.Fatal(err)
	}

	name, args, root := serverCommandFor("profiles/coding.yaml", executable, repo, "darwin")
	if name != serverBinary {
		t.Fatalf("command = %q, want installed sibling %q", name, serverBinary)
	}
	if len(args) != 1 || args[0] != "profiles/coding.yaml" {
		t.Fatalf("args = %#v, want profile path", args)
	}
	if root != repo {
		t.Fatalf("root = %q, want checkout %q", root, repo)
	}
}

func TestServerCommandUsesSourceWhenSiblingBinaryIsMissing(t *testing.T) {
	repo := t.TempDir()
	if err := os.WriteFile(filepath.Join(repo, "pnpm-workspace.yaml"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	devEntry := filepath.Join(repo, "src", "server", "index.ts")
	if err := os.MkdirAll(filepath.Dir(devEntry), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(devEntry, nil, 0o600); err != nil {
		t.Fatal(err)
	}

	executable := filepath.Join(t.TempDir(), "harness-tui")
	name, args, root := serverCommandFor("profiles/coding.yaml", executable, repo, "darwin")
	if name != "tsx" {
		t.Fatalf("command = %q, want tsx dev command", name)
	}
	if len(args) != 2 || args[0] != devEntry || args[1] != "profiles/coding.yaml" {
		t.Fatalf("args = %#v, want source entry and profile", args)
	}
	if root != repo {
		t.Fatalf("root = %q, want checkout %q", root, repo)
	}
}

func TestServerCommandIgnoresNonExecutableUnixSibling(t *testing.T) {
	repo := t.TempDir()
	if err := os.WriteFile(filepath.Join(repo, "pnpm-workspace.yaml"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	devEntry := filepath.Join(repo, "src", "server", "index.ts")
	if err := os.MkdirAll(filepath.Dir(devEntry), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(devEntry, nil, 0o600); err != nil {
		t.Fatal(err)
	}

	executable := filepath.Join(t.TempDir(), "harness-tui")
	serverBinary := serverBinaryPath(executable, "darwin")
	if err := os.WriteFile(serverBinary, nil, 0o600); err != nil {
		t.Fatal(err)
	}

	name, args, _ := serverCommandFor("", executable, repo, "darwin")
	if name != "tsx" || len(args) != 1 || args[0] != devEntry {
		t.Fatalf("command = %q args = %#v, want tsx source entry", name, args)
	}
}

func TestServerCommandUsesWindowsSiblingName(t *testing.T) {
	repo := t.TempDir()
	if err := os.WriteFile(filepath.Join(repo, "pnpm-workspace.yaml"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	devEntry := filepath.Join(repo, "src", "server", "index.ts")
	if err := os.MkdirAll(filepath.Dir(devEntry), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(devEntry, nil, 0o600); err != nil {
		t.Fatal(err)
	}

	executable := filepath.Join(t.TempDir(), "harness-tui.exe")
	serverBinary := serverBinaryPath(executable, "windows")
	if err := os.WriteFile(serverBinary, nil, 0o700); err != nil {
		t.Fatal(err)
	}

	name, _, _ := serverCommandFor("", executable, repo, "windows")
	if name != serverBinary {
		t.Fatalf("command = %q, want Windows sibling %q", name, serverBinary)
	}
}

func TestProbeHealthy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
		}
	}))
	defer srv.Close()
	port := strings.TrimPrefix(srv.URL, "http://127.0.0.1:")
	if !probeHealth(port) {
		t.Fatal("expected healthy")
	}
}

func TestProbeUnhealthy(t *testing.T) {
	if probeHealth("59999") {
		t.Fatal("expected unhealthy on closed port")
	}
}

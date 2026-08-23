package server

import (
	"net/http"
	"net/http/httptest"
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

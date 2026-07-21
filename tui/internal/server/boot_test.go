package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

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

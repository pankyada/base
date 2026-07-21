// Package server bootstraps the Node harness server, mirroring src/tui/bootstrap.ts.
package server

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

// Result reports whether we spawned the server and how to stop it.
type Result struct {
	SpawnedByUs bool
	Cleanup     func()
}

func probeHealth(port string) bool {
	client := http.Client{Timeout: time.Second}
	resp, err := client.Get("http://localhost:" + port + "/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

// findRepoRoot walks up from dir looking for pnpm-workspace.yaml, else package.json.
func findRepoRoot(dir string) string {
	d := dir
	for {
		if _, err := os.Stat(filepath.Join(d, "pnpm-workspace.yaml")); err == nil {
			return d
		}
		parent := filepath.Dir(d)
		if parent == d {
			break
		}
		d = parent
	}
	d = dir
	for {
		if _, err := os.Stat(filepath.Join(d, "package.json")); err == nil {
			return d
		}
		parent := filepath.Dir(d)
		if parent == d {
			break
		}
		d = parent
	}
	return dir
}

// serverCommand returns dev (tsx) vs prod (harness-server binary) invocation.
func serverCommand() (string, []string, string) {
	exe, _ := os.Executable()
	root := findRepoRoot(filepath.Dir(exe))
	wd, _ := os.Getwd()
	if root == filepath.Dir(exe) {
		root = findRepoRoot(wd)
	}
	devEntry := filepath.Join(root, "src", "server", "index.ts")
	if _, err := os.Stat(devEntry); err == nil {
		return "tsx", []string{devEntry}, root
	}
	return filepath.Join(filepath.Dir(exe), "harness-server"), nil, root
}

// EnsureServer probes /health and spawns the server if it is not already up.
func EnsureServer(port string) (Result, error) {
	if probeHealth(port) {
		return Result{SpawnedByUs: false, Cleanup: func() {}}, nil
	}

	cmdName, args, root := serverCommand()
	cmd := exec.Command(cmdName, args...)
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "HARNESS_PORT="+port)
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return Result{}, fmt.Errorf("failed to start %q: %w", cmdName, err)
	}

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(250 * time.Millisecond)
		if probeHealth(port) {
			cleanup := func() {
				_ = cmd.Process.Signal(syscall.SIGTERM)
				done := make(chan struct{})
				go func() { _ = cmd.Wait(); close(done) }()
				select {
				case <-done:
				case <-time.After(2 * time.Second):
					_ = cmd.Process.Kill()
				}
			}
			return Result{SpawnedByUs: true, Cleanup: cleanup}, nil
		}
	}

	_ = cmd.Process.Kill()
	return Result{}, fmt.Errorf(
		"harness server failed to become healthy within 10s on port %s — "+
			"check that %q is on your PATH and the profile is valid", port, cmdName)
}

// Package server bootstraps the Node harness server, mirroring src/tui/bootstrap.ts.
package server

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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
// ok is false if neither was found before reaching the filesystem root.
func findRepoRoot(dir string) (root string, ok bool) {
	d := dir
	for {
		if _, err := os.Stat(filepath.Join(d, "pnpm-workspace.yaml")); err == nil {
			return d, true
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
			return d, true
		}
		parent := filepath.Dir(d)
		if parent == d {
			break
		}
		d = parent
	}
	return dir, false
}

func serverBinaryPath(executable, goos string) string {
	name := "harness-server"
	if goos == "windows" {
		name += ".exe"
	}
	return filepath.Join(filepath.Dir(executable), name)
}

func serverBinaryAvailable(path, goos string) bool {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	return goos == "windows" || info.Mode().Perm()&0o111 != 0
}

// serverCommand returns dev (tsx) vs prod (harness-server binary) invocation.
func serverCommand(profile string) (string, []string, string) {
	exe, _ := os.Executable()
	wd, _ := os.Getwd()
	return serverCommandFor(profile, exe, wd, runtime.GOOS)
}

func serverCommandFor(profile, executable, workingDir, goos string) (string, []string, string) {
	root, ok := findRepoRoot(filepath.Dir(executable))
	if !ok {
		if r, ok2 := findRepoRoot(workingDir); ok2 {
			root = r
		}
	}

	serverBinary := serverBinaryPath(executable, goos)
	if serverBinaryAvailable(serverBinary, goos) {
		args := []string{}
		if profile != "" {
			args = append(args, profile)
		}
		return serverBinary, args, root
	}

	devEntry := filepath.Join(root, "src", "server", "index.ts")
	if _, err := os.Stat(devEntry); err == nil {
		args := []string{devEntry}
		if profile != "" {
			args = append(args, profile)
		}
		return "tsx", args, root
	}
	args := []string{}
	if profile != "" {
		args = append(args, profile)
	}
	return serverBinary, args, root
}

// EnsureServer probes /health and spawns the server if it is not already up.
func EnsureServer(port string, profiles ...string) (Result, error) {
	if probeHealth(port) {
		return Result{SpawnedByUs: false, Cleanup: func() {}}, nil
	}

	profile := ""
	if len(profiles) > 0 {
		profile = profiles[0]
	}
	// root locates the harness checkout (for picking tsx-dev vs. the bundled
	// binary, and finding the dev entrypoint) — it is NOT where the spawned
	// server should run. The server's cwd drives $CWD-relative profile paths
	// (working_dir, artifact_dir) and skill discovery, so it must be the
	// directory the user actually launched harness-tui from, not the repo
	// root or the installed binary's directory.
	cmdName, args, _ := serverCommand(profile)
	wd, err := os.Getwd()
	if err != nil {
		return Result{}, fmt.Errorf("failed to determine working directory: %w", err)
	}
	cmd := exec.Command(cmdName, args...)
	cmd.Dir = wd
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
	_ = cmd.Wait()
	return Result{}, fmt.Errorf(
		"harness server failed to become healthy within 10s on port %s — "+
			"check that %q is on your PATH and the profile is valid", port, cmdName)
}

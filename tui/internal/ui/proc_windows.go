//go:build windows

package ui

import "os/exec"

// Windows has no process groups in the POSIX sense; the child is killed
// directly. Release builds target darwin and linux, so this exists to keep
// `go build` working for contributors on Windows.
func setProcessGroup(command *exec.Cmd) {}

func killProcessGroup(command *exec.Cmd) {
	_ = command.Process.Kill()
}

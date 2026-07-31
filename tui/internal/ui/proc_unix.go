//go:build !windows

package ui

import (
	"os/exec"
	"syscall"
	"time"
)

// setProcessGroup puts the task's shell in its own process group so the whole
// tree — the shell and everything it spawns — can be signalled as a unit.
func setProcessGroup(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// killProcessGroup asks the group to stop, then insists. A dev server usually
// exits on SIGTERM; anything still alive after the grace period is killed so a
// stuck process cannot hold its port past the button press.
func killProcessGroup(command *exec.Cmd) {
	pid := command.Process.Pid
	if err := syscall.Kill(-pid, syscall.SIGTERM); err != nil {
		_ = command.Process.Signal(syscall.SIGTERM)
	}
	go func() {
		time.Sleep(3 * time.Second)
		if err := syscall.Kill(-pid, syscall.SIGKILL); err != nil {
			_ = command.Process.Kill()
		}
	}()
}

package ui

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

type localResultMsg struct {
	Command, Output string
	Code            int
	Err             error
}

func runLocalCommand(command, workingDir string) (tea.Cmd, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	return func() tea.Msg {
		defer cancel()
		timeoutCtx, timeoutCancel := context.WithTimeout(ctx, 30*time.Second)
		defer timeoutCancel()
		cmd := exec.CommandContext(timeoutCtx, "sh", "-c", command)
		cmd.Dir = workingDir
		output, err := cmd.CombinedOutput()
		code := 0
		if exit, ok := err.(*exec.ExitError); ok {
			code = exit.ExitCode()
		}
		if timeoutCtx.Err() != nil {
			code := 124
			if ctx.Err() != nil {
				code = 130
			}
			return localResultMsg{Command: command, Output: "command interrupted", Code: code, Err: timeoutCtx.Err()}
		}
		return localResultMsg{Command: command, Output: strings.TrimSpace(string(output)), Code: code, Err: err}
	}, cancel
}

func localView(result localResultMsg) string {
	return StAccent.Render("LOCAL ") + StDim.Render(result.Command) + fmt.Sprintf(" (exit %d)\n%s", result.Code, result.Output)
}

package ui

import (
	"context"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// GitState is the snapshot of the working tree the rail renders. Zero value
// means "not looked at yet" — Checked distinguishes that from "looked, and
// this is not a repository".
type GitState struct {
	Repo      bool
	Branch    string
	Upstream  string
	Ahead     int
	Behind    int
	Staged    int
	Unstaged  int
	Untracked int
	Conflicts int
	Err       string
	Checked   bool
}

// Dirty reports whether the tree has any change at all, staged or not.
func (g GitState) Dirty() bool {
	return g.Staged+g.Unstaged+g.Untracked+g.Conflicts > 0
}

type gitStatusMsg struct{ State GitState }

type gitActionMsg struct {
	Action string
	Output string
	Code   int
	Err    error
}

// gitEnv disables every interactive credential path. A `git push` that decides
// to ask for a password would otherwise hang forever behind the alt-screen
// with no way for the user to answer it.
func gitEnv() []string {
	return []string{"GIT_TERMINAL_PROMPT=0", "GIT_ASKPASS=", "SSH_ASKPASS=", "GIT_OPTIONAL_LOCKS=0"}
}

func runGit(dir string, timeout time.Duration, args ...string) (string, int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), gitEnv()...)
	output, err := cmd.CombinedOutput()
	code := 0
	if exit, ok := err.(*exec.ExitError); ok {
		code = exit.ExitCode()
	} else if err != nil {
		code = -1
	}
	return strings.TrimRight(string(output), "\n"), code, err
}

// gitStatusCmd refreshes the rail's git section. It never surfaces an error
// notice: a missing git binary or a non-repository working dir simply means
// the section renders as unavailable.
func gitStatusCmd(dir string) tea.Cmd {
	return func() tea.Msg {
		output, code, err := runGit(dir, 5*time.Second, "status", "--porcelain=v2", "--branch")
		if err != nil && code != 0 {
			state := GitState{Checked: true}
			if !strings.Contains(strings.ToLower(output), "not a git repository") {
				state.Err = firstLine(output)
			}
			return gitStatusMsg{State: state}
		}
		return gitStatusMsg{State: parseGitStatus(output)}
	}
}

// gitActionCmd runs one git subcommand for a rail button. The generous timeout
// covers network operations (push/pull/fetch) which are the slow ones.
func gitActionCmd(action, dir string, args ...string) tea.Cmd {
	return func() tea.Msg {
		output, code, err := runGit(dir, 3*time.Minute, args...)
		return gitActionMsg{Action: action, Output: output, Code: code, Err: err}
	}
}

// parseGitStatus reads `git status --porcelain=v2 --branch` output.
//
//	# branch.head main
//	# branch.upstream origin/main
//	# branch.ab +2 -1
//	1 .M N... path        (ordinary change; XY = staged, unstaged)
//	2 R. N... new<TAB>old (rename)
//	u UU N... path        (unmerged)
//	? path                (untracked)
func parseGitStatus(output string) GitState {
	state := GitState{Repo: true, Checked: true, Branch: "(detached)"}
	for _, line := range strings.Split(output, "\n") {
		switch {
		case strings.HasPrefix(line, "# branch.head "):
			state.Branch = strings.TrimSpace(strings.TrimPrefix(line, "# branch.head "))
		case strings.HasPrefix(line, "# branch.upstream "):
			state.Upstream = strings.TrimSpace(strings.TrimPrefix(line, "# branch.upstream "))
		case strings.HasPrefix(line, "# branch.ab "):
			for _, field := range strings.Fields(strings.TrimPrefix(line, "# branch.ab ")) {
				value, err := strconv.Atoi(strings.TrimLeft(field, "+-"))
				if err != nil {
					continue
				}
				if strings.HasPrefix(field, "+") {
					state.Ahead = value
				} else if strings.HasPrefix(field, "-") {
					state.Behind = value
				}
			}
		case strings.HasPrefix(line, "1 "), strings.HasPrefix(line, "2 "):
			fields := strings.Fields(line)
			if len(fields) < 2 || len(fields[1]) < 2 {
				continue
			}
			if fields[1][0] != '.' {
				state.Staged++
			}
			if fields[1][1] != '.' {
				state.Unstaged++
			}
		case strings.HasPrefix(line, "u "):
			state.Conflicts++
		case strings.HasPrefix(line, "? "):
			state.Untracked++
		}
	}
	return state
}

func firstLine(text string) string {
	if index := strings.IndexByte(text, '\n'); index >= 0 {
		return text[:index]
	}
	return text
}

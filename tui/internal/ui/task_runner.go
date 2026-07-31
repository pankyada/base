package ui

import (
	"bufio"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// taskOutputCap bounds what one task keeps in memory. A dev server left
// running all afternoon must not grow the TUI's heap without limit.
const taskOutputCap = 500

// outputBuffer is a bounded, concurrency-safe line ring. The reader goroutine
// appends; the Bubble Tea update loop snapshots it on each frame.
type outputBuffer struct {
	mu      sync.Mutex
	lines   []string
	dropped int
}

func (b *outputBuffer) Append(line string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.lines = append(b.lines, line)
	if len(b.lines) > taskOutputCap {
		b.dropped += len(b.lines) - taskOutputCap
		b.lines = b.lines[len(b.lines)-taskOutputCap:]
	}
}

// Tail returns the last n lines, oldest first.
func (b *outputBuffer) Tail(n int) []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	if n <= 0 || n > len(b.lines) {
		n = len(b.lines)
	}
	tail := make([]string, n)
	copy(tail, b.lines[len(b.lines)-n:])
	return tail
}

func (b *outputBuffer) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.lines) + b.dropped
}

// TaskRun is one live (or just-finished) task process.
type TaskRun struct {
	ID      string
	Label   string
	Command string
	Started time.Time
	Done    bool
	Code    int
	Err     error
	buffer  *outputBuffer
	process *exec.Cmd
}

// Elapsed is the wall time the task has been (or was) running.
func (r *TaskRun) Elapsed() time.Duration {
	if r.Started.IsZero() {
		return 0
	}
	return time.Since(r.Started)
}

// Tail exposes the buffered output for rendering.
func (r *TaskRun) Tail(n int) []string { return r.buffer.Tail(n) }

type taskExitMsg struct {
	ID   string
	Code int
	Err  error
}

// startTask launches a task and returns the handle plus the command that waits
// for it. The process is started synchronously so its output starts flowing
// into the buffer immediately, before the first frame that renders it.
func startTask(task Task, workingDir string) (*TaskRun, tea.Cmd, error) {
	command := exec.Command("sh", "-c", task.Command)
	command.Dir = workingDir
	setProcessGroup(command)

	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, nil, err
	}
	// Point stderr at the same pipe writer so build warnings and errors land in
	// the buffer interleaved with stdout, in the order they were produced.
	command.Stderr = command.Stdout

	run := &TaskRun{
		ID:      task.ID,
		Label:   task.Label,
		Command: task.Command,
		Started: time.Now(),
		buffer:  &outputBuffer{},
		process: command,
	}
	if err := command.Start(); err != nil {
		return nil, nil, err
	}
	go drainInto(stdout, run.buffer)

	return run, func() tea.Msg {
		waitErr := command.Wait()
		code := 0
		if exit, ok := waitErr.(*exec.ExitError); ok {
			code = exit.ExitCode()
		} else if waitErr != nil {
			code = -1
		}
		return taskExitMsg{ID: task.ID, Code: code, Err: waitErr}
	}, nil
}

// Stop terminates the task's whole process group. `sh -c "pnpm dev"` spawns
// children; killing only the shell would leave the dev server holding its port.
func (r *TaskRun) Stop() {
	if r == nil || r.process == nil || r.process.Process == nil {
		return
	}
	killProcessGroup(r.process)
}

func drainInto(reader io.Reader, buffer *outputBuffer) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		buffer.Append(strings.TrimRight(scanner.Text(), "\r"))
	}
}

// taskRunView renders a task's live output as a transcript block.
func taskRunView(run *TaskRun, lines, width int) string {
	header := StTeal.Render("TASK ") + StText.Render(run.Label)
	switch {
	case !run.Done:
		header += StDim.Render(fmt.Sprintf(" · running %.0fs", run.Elapsed().Seconds()))
	case run.Code == 0:
		header += StOK.Render(" · ✓ exit 0")
	default:
		header += StErr.Render(fmt.Sprintf(" · ✗ exit %d", run.Code))
	}
	header += StFaint.Render("  " + truncate(run.Command, maxInt(8, width/3)))

	body := run.Tail(lines)
	if len(body) == 0 {
		body = []string{"(no output yet)"}
	}
	rendered := make([]string, 0, len(body))
	for _, line := range body {
		rendered = append(rendered, StDim.Render(truncate(line, maxInt(8, width-2))))
	}
	return header + "\n" + strings.Join(rendered, "\n")
}

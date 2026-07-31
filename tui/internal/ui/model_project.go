package ui

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// taskTailLines is how much of a task's output the transcript block shows.
// The full stream stays in the task's buffer; this is the readable window.
const taskTailLines = 14

// railShown reports whether the rail is currently on screen. Clicks and hit
// maps are only meaningful when it is.
func (m Model) railShown() bool { return m.railVisible && m.width >= 100 }

// clickRail resolves a click inside the rail against the hit map recorded by
// the most recent reflow.
func (m Model) clickRail(x, y int) (tea.Model, tea.Cmd) {
	for _, hit := range m.railHits {
		if hit.Y == y && x >= hit.X1 && x < hit.X2 {
			return m.railAction(hit.Action)
		}
	}
	return m, nil
}

// railAction runs one rail button. Actions are strings so the rail can declare
// its own buttons without the model needing an enum per section.
func (m Model) railAction(action string) (tea.Model, tea.Cmd) {
	if taskID, ok := strings.CutPrefix(action, "task:"); ok {
		cmd := m.toggleTask(taskID)
		m.reflow()
		return m, cmd
	}
	switch action {
	case "tasks:detect":
		m.openTaskEditor(TasksJSON(DetectTasks(m.workingDir)))
		m.notices.Add(NoticeInfo, "detected tasks from project files", "review, then ^s to save", "nothing is written until you save")
		m.reflow()
		return m, nil
	case "tasks:edit":
		m.openTaskEditor(TasksJSON(m.tasks))
		m.reflow()
		return m, nil
	case "tasks:ask":
		m.askAgentForTasks()
		return m, nil
	}
	if gitAction, ok := strings.CutPrefix(action, "git:"); ok {
		cmd := m.startGitAction(gitAction, "")
		m.reflow()
		return m, cmd
	}
	return m, nil
}

// ─── git ─────────────────────────────────────────────────────────────────

// gitNeedsConfirm lists the actions that reach outside the working tree or
// rewrite the index in a way the user cannot trivially undo. They arm on the
// first press and only run on the second.
var gitNeedsConfirm = map[string]string{
	"push": "publishes local commits to the remote",
	"pull": "merges remote commits into the working tree",
}

// startGitAction validates and launches one git action. Callers reflow.
func (m *Model) startGitAction(action, args string) tea.Cmd {
	if m.git.Checked && !m.git.Repo && action != "refresh" && action != "status" {
		m.notices.Add(NoticeWarn, "not a git repository", m.workingDir, "")
		return nil
	}
	if m.gitBusy != "" {
		m.notices.Add(NoticeInfo, "git busy", m.gitBusy+" still running", "")
		return nil
	}
	if reason, needs := gitNeedsConfirm[action]; needs && m.gitConfirm != action {
		m.gitConfirm = action
		m.notices.Add(NoticeWarn, "confirm git "+action, reason, "press "+action+" again to run it")
		return nil
	}
	m.gitConfirm = ""

	start := func(name string, argv ...string) tea.Cmd {
		m.gitBusy = name
		return gitActionCmd(name, m.workingDir, argv...)
	}
	switch action {
	case "refresh", "status":
		return gitStatusCmd(m.workingDir)
	case "stage":
		return start("stage", "add", "-A")
	case "unstage":
		return start("unstage", "reset")
	case "commit":
		message := strings.TrimSpace(args)
		if message == "" {
			// The button cannot invent a commit message, so it hands the
			// composer back pre-filled rather than opening a modal the user
			// then has to retype the message into.
			m.composer.input.SetValue("/git commit ")
			m.composer.syncHeight()
			m.notices.Add(NoticeInfo, "commit message?", "type it after /git commit", "enter commits the staged changes")
			return nil
		}
		return start("commit", "commit", "-m", message)
	case "push":
		return start("push", "push")
	case "pull":
		return start("pull", "pull", "--ff-only")
	case "fetch":
		return start("fetch", "fetch", "--all")
	case "diff":
		return start("diff", "diff", "--stat", "HEAD")
	case "log":
		return start("log", "log", "--oneline", "--decorate", "-n", "15")
	}
	m.notices.Add(NoticeError, "unknown git action", action, "stage · unstage · commit · push · pull · fetch · diff · log · status")
	return nil
}

// gitReportsOutput lists the read-only actions whose whole point is what they
// print — those land in the transcript instead of a one-line notice.
var gitReportsOutput = map[string]bool{"diff": true, "log": true}

func (m Model) handleGitAction(msg gitActionMsg) (tea.Model, tea.Cmd) {
	m.gitBusy = ""
	switch {
	case gitReportsOutput[msg.Action] && msg.Code == 0:
		body := msg.Output
		if strings.TrimSpace(body) == "" {
			body = "(no output)"
		}
		m.appendLocalTurn("git "+msg.Action, body, msg.Code)
	case msg.Code == 0:
		detail := firstLine(msg.Output)
		if detail == "" {
			detail = "done"
		}
		m.notices.Add(NoticeInfo, "git "+msg.Action, detail, "")
	default:
		m.notices.Add(NoticeError, "git "+msg.Action+" failed", firstLine(msg.Output), "")
		if strings.TrimSpace(msg.Output) != "" {
			m.appendLocalTurn("git "+msg.Action, msg.Output, msg.Code)
		}
	}
	m.reflow()
	return m, gitStatusCmd(m.workingDir)
}

func (m *Model) appendLocalTurn(command, output string, code int) {
	m.transcript.Turns = append(m.transcript.Turns, Turn{
		Role: "local",
		Text: localView(localResultMsg{Command: command, Output: output, Code: code}),
		Time: time.Now().Format("15:04"),
	})
	m.follow = true
}

// ─── tasks ───────────────────────────────────────────────────────────────

func (m Model) findTask(id string) (Task, bool) {
	for _, task := range m.tasks {
		if task.ID == id {
			return task, true
		}
	}
	return Task{}, false
}

// taskStates is what the rail needs to draw each task's button.
func (m Model) taskStates() map[string]TaskStatus {
	states := make(map[string]TaskStatus, len(m.taskRuns))
	for id, run := range m.taskRuns {
		states[id] = TaskStatus{
			Running:  !run.Done,
			Finished: run.Done,
			Code:     run.Code,
			Elapsed:  fmt.Sprintf("%.0fs", run.Elapsed().Seconds()),
		}
	}
	return states
}

// toggleTask starts a task, or stops it when it is already running — the same
// button does both, matching how the row reads ("▸ dev" vs "◐ dev · stop").
func (m *Model) toggleTask(id string) tea.Cmd {
	if run, ok := m.taskRuns[id]; ok && !run.Done {
		run.Stop()
		m.notices.Add(NoticeInfo, "stopping task", run.Label, "")
		return nil
	}
	task, ok := m.findTask(id)
	if !ok {
		m.notices.Add(NoticeError, "unknown task", id, "/tasks edit to configure")
		return nil
	}
	// Tasks run project shell commands, so they answer to the same trust gate
	// as `!` local commands rather than sidestepping it via a button.
	if m.approvalMode == "strict" {
		m.notices.Add(NoticeWarn, "task blocked", "strict mode does not run shell commands", "switch to bash or danger")
		return nil
	}
	run, cmd, err := startTask(task, m.workingDir)
	if err != nil {
		m.notices.Add(NoticeError, "task failed to start", err.Error(), task.Command)
		return nil
	}
	m.taskRuns[id] = run
	m.transcript.Turns = append(m.transcript.Turns, Turn{
		Role:   "task",
		TaskID: id,
		Time:   time.Now().Format("15:04"),
		Text:   taskRunView(run, taskTailLines, m.contentWidth()),
	})
	m.follow = true
	return cmd
}

func (m Model) handleTaskExit(msg taskExitMsg) (tea.Model, tea.Cmd) {
	run, ok := m.taskRuns[msg.ID]
	if !ok {
		return m, nil
	}
	run.Done = true
	run.Code = msg.Code
	run.Err = msg.Err
	if msg.Code == 0 {
		m.notices.Add(NoticeInfo, "task finished", run.Label+" · exit 0", "")
	} else {
		m.notices.Add(NoticeError, "task failed", fmt.Sprintf("%s · exit %d", run.Label, msg.Code), "output is in the transcript")
	}
	m.reflow()
	// A task that touched the tree (build artifacts, generated files) changes
	// what git has to say, so refresh rather than waiting for the poll.
	return m, gitStatusCmd(m.workingDir)
}

// syncTaskTurns refreshes the transcript blocks of live tasks from their
// output buffers. Called from reflow, so it tracks the spinner tick.
func (m *Model) syncTaskTurns() {
	if len(m.taskRuns) == 0 {
		return
	}
	width := m.contentWidth()
	for index := range m.transcript.Turns {
		turn := &m.transcript.Turns[index]
		if turn.Role != "task" || turn.TaskID == "" {
			continue
		}
		if run, ok := m.taskRuns[turn.TaskID]; ok {
			turn.Text = taskRunView(run, taskTailLines, width)
		}
	}
}

// openTaskEditor drops the tasks overlay straight into edit mode on a document.
func (m *Model) openTaskEditor(document string) {
	m.openOverlay("tasks")
	m.taskEditing = true
	m.taskEditorError = ""
	m.taskEditor.SetValue(document)
	m.taskEditor.Focus()
}

// saveTaskEditor validates and persists the edited document.
func (m *Model) saveTaskEditor() {
	tasks, err := ParseTaskFile([]byte(m.taskEditor.Value()))
	if err != nil {
		m.taskEditorError = "invalid JSON: " + err.Error()
		return
	}
	if err := SaveTasks(m.workingDir, tasks); err != nil {
		m.taskEditorError = "write failed: " + err.Error()
		return
	}
	m.tasks = tasks
	m.tasksDetected = false
	m.taskEditing = false
	m.taskEditorError = ""
	m.taskEditor.Blur()
	m.notices.Add(NoticeInfo, "tasks saved", taskConfigPath(m.workingDir), fmt.Sprintf("%d task(s)", len(tasks)))
}

// askAgentForTasks hands the job to the model. It goes through the normal
// message path so the request and the file write both show up in the
// transcript rather than happening invisibly.
func (m *Model) askAgentForTasks() {
	m.startMessage("Inspect this project and write " + taskConfigPath(m.workingDir) +
		" describing how to build, run, serve and test it.\n\nUse exactly this schema, one entry per useful command, ids lowercase and unique:\n\n" +
		TaskSchemaHint + "\n\nBase the commands on the real manifests in the repo (package.json scripts, Makefile, go.mod, Cargo.toml, etc). Then tell me what you configured.")
}

// contentWidth is the transcript's usable width — the terminal minus the rail
// column when it is shown, minus the scrollbar gutter.
func (m Model) contentWidth() int {
	width := maxInt(1, m.width)
	if m.railShown() {
		width -= railWidth
	}
	return maxInt(1, width-1)
}

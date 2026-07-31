package ui

import (
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"harness-tui/internal/prefs"
)

// projectModel is a model sized for the rail, pointed at a scratch directory.
func projectModel(t *testing.T, tasks []Task) Model {
	t.Helper()
	m := NewModel(&recordingSender{}, "coding", "tester", prefs.Preferences{})
	m.width, m.height = 120, 40
	m.railVisible = true
	m.workingDir = t.TempDir()
	m.tasks = tasks
	m.approvalMode = "danger"
	m.reflow()
	return m
}

// clickRailAction drives a real mouse release over the rail button carrying
// the given action, exercising the same coordinate math the terminal does.
func clickRailAction(t *testing.T, m Model, action string) (Model, tea.Cmd) {
	t.Helper()
	for _, hit := range m.railHits {
		if hit.Action != action {
			continue
		}
		topBarHeight := lipgloss.Height(topBar(m.profile, m.sessionID, m.connected, m.running, m.frame, time.Now(), m.width))
		updated, cmd := m.Update(tea.MouseMsg{
			X:      m.width - railWidth + railBorder + railPadding + hit.X1,
			Y:      topBarHeight + hit.Y,
			Action: tea.MouseActionRelease,
			Button: tea.MouseButtonLeft,
		})
		return updated.(Model), cmd
	}
	t.Fatalf("no rail button for %q in %+v", action, m.railHits)
	return m, nil
}

func TestRailClickStartsATask(t *testing.T) {
	m := projectModel(t, []Task{{ID: "hello", Label: "hello", Command: "echo hello-from-task", Kind: "build"}})

	m, cmd := clickRailAction(t, m, "task:hello")
	run, ok := m.taskRuns["hello"]
	if !ok {
		t.Fatal("clicking a task should start it")
	}
	if cmd == nil {
		t.Fatal("a started task must return a command that waits for it")
	}

	// The transcript gets a live block for the run.
	found := false
	for _, turn := range m.transcript.Turns {
		if turn.Role == "task" && turn.TaskID == "hello" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a task turn in the transcript, got %+v", m.transcript.Turns)
	}

	exit, _ := cmd().(taskExitMsg)
	if exit.ID != "hello" || exit.Code != 0 {
		t.Fatalf("task exit = %+v, want hello/0", exit)
	}
	updated, _ := m.Update(exit)
	m = updated.(Model)
	if !run.Done || run.Code != 0 {
		t.Fatalf("run not finalised: done=%v code=%d", run.Done, run.Code)
	}
	if output := strings.Join(run.Tail(10), "\n"); !strings.Contains(output, "hello-from-task") {
		t.Fatalf("task output not captured: %q", output)
	}
	if !strings.Contains(stripANSI(m.transcript.Render(80, 0)), "exit 0") {
		t.Fatal("finished task should report its exit code in the transcript")
	}
}

func TestTaskCapturesStderrAndNonZeroExit(t *testing.T) {
	m := projectModel(t, []Task{{ID: "boom", Label: "boom", Command: "echo bad-thing >&2; exit 7"}})
	m, cmd := clickRailAction(t, m, "task:boom")
	exit := cmd().(taskExitMsg)
	if exit.Code != 7 {
		t.Fatalf("exit code = %d, want 7", exit.Code)
	}
	updated, _ := m.Update(exit)
	m = updated.(Model)
	if output := strings.Join(m.taskRuns["boom"].Tail(10), "\n"); !strings.Contains(output, "bad-thing") {
		t.Fatalf("stderr should land in the task buffer, got %q", output)
	}
}

func TestStrictModeRefusesToRunTasks(t *testing.T) {
	m := projectModel(t, []Task{{ID: "hello", Label: "hello", Command: "echo hi"}})
	m.approvalMode = "strict"
	m.reflow()

	m, cmd := clickRailAction(t, m, "task:hello")
	if len(m.taskRuns) != 0 || cmd != nil {
		t.Fatal("strict mode must not run project shell commands")
	}
}

func TestGitPushArmsBeforeItRuns(t *testing.T) {
	m := projectModel(t, nil)
	m.git = GitState{Checked: true, Repo: true, Branch: "main", Ahead: 1}
	m.reflow()

	m, cmd := clickRailAction(t, m, "git:push")
	if m.gitConfirm != "push" {
		t.Fatalf("first click should arm push, gitConfirm=%q", m.gitConfirm)
	}
	if cmd != nil || m.gitBusy != "" {
		t.Fatal("first click must not run anything")
	}

	m, cmd = clickRailAction(t, m, "git:push")
	if m.gitBusy != "push" || cmd == nil {
		t.Fatalf("second click should run push, busy=%q cmd=%v", m.gitBusy, cmd != nil)
	}
}

func TestGitStageRunsImmediately(t *testing.T) {
	m := projectModel(t, nil)
	m.git = GitState{Checked: true, Repo: true, Branch: "main", Unstaged: 2}
	m.reflow()

	m, cmd := clickRailAction(t, m, "git:stage")
	if m.gitBusy != "stage" || cmd == nil {
		t.Fatalf("stage is reversible and should not need confirming: busy=%q", m.gitBusy)
	}
}

func TestGitCommitWithoutMessagePrefillsTheComposer(t *testing.T) {
	m := projectModel(t, nil)
	m.git = GitState{Checked: true, Repo: true, Branch: "main", Staged: 1}
	m.reflow()

	m, cmd := clickRailAction(t, m, "git:commit")
	if cmd != nil || m.gitBusy != "" {
		t.Fatal("a commit with no message must not run")
	}
	if !strings.HasPrefix(m.composer.Value(), "/git commit") {
		t.Fatalf("composer should be primed for the message, got %q", m.composer.Value())
	}
}

func TestSlashGitCommitSkipsArmingAndSendsTheMessage(t *testing.T) {
	m := projectModel(t, nil)
	m.git = GitState{Checked: true, Repo: true, Branch: "main", Staged: 1}

	cmd, handled := m.handleSlash("/git commit fix the thing")
	if !handled || cmd == nil {
		t.Fatalf("slash commit should run, handled=%v cmd=%v", handled, cmd != nil)
	}
	if m.gitBusy != "commit" {
		t.Fatalf("gitBusy=%q, want commit", m.gitBusy)
	}
}

func TestSlashGitPushIsDeliberateEnoughToSkipArming(t *testing.T) {
	m := projectModel(t, nil)
	m.git = GitState{Checked: true, Repo: true, Branch: "main"}

	cmd, handled := m.handleSlash("/git push")
	if !handled || cmd == nil || m.gitBusy != "push" {
		t.Fatalf("typing the verb is the confirmation: busy=%q cmd=%v", m.gitBusy, cmd != nil)
	}
}

func TestGitActionOutputLandsInTranscriptOrNotices(t *testing.T) {
	m := projectModel(t, nil)

	updated, _ := m.Update(gitActionMsg{Action: "diff", Output: " one.go | 2 +-", Code: 0})
	m = updated.(Model)
	if !strings.Contains(stripANSI(m.transcript.Render(80, 0)), "one.go") {
		t.Fatal("diff output belongs in the transcript")
	}
	if m.gitBusy != "" {
		t.Fatal("finishing an action clears the busy flag")
	}

	before := len(m.transcript.Turns)
	updated, _ = m.Update(gitActionMsg{Action: "stage", Output: "", Code: 0})
	m = updated.(Model)
	if len(m.transcript.Turns) != before {
		t.Fatal("a silent successful action should stay out of the transcript")
	}
}

func TestTasksTabEditorSavesAndReloads(t *testing.T) {
	m := projectModel(t, nil)
	m.openTaskEditor(`{"version":1,"tasks":[{"id":"x","label":"x","command":"echo x","kind":"build"}]}`)
	if !m.taskEditing || m.overlayTab != "tasks" {
		t.Fatal("editor should open on the tasks tab")
	}

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlS})
	m = updated.(Model)
	if m.taskEditing {
		t.Fatalf("a valid save closes the editor, error=%q", m.taskEditorError)
	}
	if len(m.tasks) != 1 || m.tasks[0].ID != "x" {
		t.Fatalf("saved tasks not applied: %+v", m.tasks)
	}
	if m.tasksDetected {
		t.Fatal("saved tasks are user config, not detected")
	}

	reloaded, detected, err := LoadTasks(m.workingDir)
	if err != nil || detected || len(reloaded) != 1 {
		t.Fatalf("tasks.json not persisted: %v %v %+v", err, detected, reloaded)
	}
}

func TestTasksTabEditorRejectsInvalidJSONWithoutClosing(t *testing.T) {
	m := projectModel(t, nil)
	m.openTaskEditor("{not json")

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlS})
	m = updated.(Model)
	if !m.taskEditing {
		t.Fatal("an invalid document must keep the editor open")
	}
	if m.taskEditorError == "" {
		t.Fatal("the user needs to be told what is wrong")
	}
}

func TestAskAgentForTasksGoesThroughTheNormalMessagePath(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "coding", "tester", prefs.Preferences{})
	m.workingDir = t.TempDir()
	m.askAgentForTasks()

	if len(sender.messages) == 0 {
		t.Fatal("expected a message to the agent")
	}
	if !m.running {
		t.Fatal("asking the agent starts a turn like any other message")
	}
	last := m.transcript.Turns[len(m.transcript.Turns)-2]
	if last.Role != "user" {
		t.Fatalf("the request should be visible as a user turn, got %q", last.Role)
	}
}

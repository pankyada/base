package ui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"harness-tui/internal/prefs"
)

func keyRune(r rune) tea.KeyMsg { return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}} }

func TestActionBarPopulatesFromGitAndLocalResults(t *testing.T) {
	m := NewModel(&recordingSender{}, "coding", "user", prefs.Preferences{})
	updated, _ := m.Update(gitActionMsg{Action: "stage", Output: "staged", Code: 0})
	m = updated.(Model)
	if m.lastAction == nil || m.lastAction.Kind != "git" || !m.lastAction.OK {
		t.Fatalf("git action = %#v", m.lastAction)
	}
	updated, _ = m.Update(localResultMsg{Command: "echo hi", Output: "hi", Code: 0})
	m = updated.(Model)
	if m.lastAction == nil || m.lastAction.Kind != "local" || m.lastAction.RetryFunc == nil {
		t.Fatalf("local action = %#v", m.lastAction)
	}
}

func TestActionBarPopulatesFromFinishedTask(t *testing.T) {
	m := NewModel(nil, "coding", "user", prefs.Preferences{})
	m.taskRuns["build"] = &TaskRun{ID: "build", Label: "build", buffer: &outputBuffer{}}
	updated, _ := m.Update(taskExitMsg{ID: "build", Code: 1})
	m = updated.(Model)
	if m.lastAction == nil || m.lastAction.Kind != "task" || m.lastAction.OK || m.lastAction.LogsTab != "tasks" {
		t.Fatalf("task action = %#v", m.lastAction)
	}
}

func TestActionBarKeyGatingAndDismissal(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "coding", "user", prefs.Preferences{})
	m.lastAction = &ActionResult{Kind: "local", Label: "!echo", Result: "ok", OK: true, RetryFunc: func(*Model) tea.Cmd { return nil }, LogsTab: "tasks", UndoID: "undo-1"}
	updated, _ := m.Update(keyRune('u'))
	m = updated.(Model)
	if len(sender.messages) != 1 {
		t.Fatalf("undo key messages = %d", len(sender.messages))
	}
	updated, _ = m.Update(keyRune('l'))
	m = updated.(Model)
	if m.overlayTab != "tasks" || !m.overlayOpen {
		t.Fatalf("logs key did not open tasks: tab=%q open=%v", m.overlayTab, m.overlayOpen)
	}
	m.overlayOpen = false
	m.composer.input.SetValue("text")
	updated, _ = m.Update(keyRune('r'))
	m = updated.(Model)
	if m.overlayOpen {
		t.Fatal("retry key must not fire while composer contains text")
	}
	m.composer.Reset()
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyEscape})
	m = updated.(Model)
	if m.lastAction != nil {
		t.Fatal("esc should dismiss action bar when composer is empty")
	}
}

func TestActionBarRendersOnlyApplicableHints(t *testing.T) {
	got := stripANSI(actionBar(&ActionResult{Label: "git stage", Result: "done", OK: true}, 80))
	if !strings.Contains(got, "git stage") || strings.Contains(got, "[u]") || strings.Contains(got, "[r]") {
		t.Fatalf("action bar hints = %q", got)
	}
}

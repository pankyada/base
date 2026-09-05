package ui

import (
	"encoding/json"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"harness-tui/internal/prefs"
)

func TestApprovalModalActionsSendExactlyOneDecision(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.pendingApproval = &ApprovalRequest{ID: "a1", Name: "Bash", Risk: "danger", Reason: "destructive filesystem removal"}
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'y'}})
	m = updated.(Model)
	if m.pendingApproval != nil || len(sender.messages) != 1 {
		t.Fatalf("pending=%v messages=%d", m.pendingApproval, len(sender.messages))
	}
	encoded, err := json.Marshal(sender.messages[0])
	if err != nil || !strings.Contains(string(encoded), "tool_approve") {
		t.Fatalf("approval message = %s", encoded)
	}
}

func TestApprovalModalShowsRehearsalPreview(t *testing.T) {
	view := approvalModal(ApprovalRequest{ID: "a1", Name: "MemoryWrite", Preview: map[string]interface{}{"before_hash": "old", "after_hash": "new"}}, 100, 30)
	if !strings.Contains(view, "PROPOSED EFFECT") || !strings.Contains(view, "before_hash") {
		t.Fatalf("approval preview missing: %s", view)
	}
}

func TestInputRequestMultiSelectAndEscapeResolve(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.pendingInput = newInputRequest("q1", "Pick", "multi_select", []string{"a", "b"})
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeySpace})
	m = updated.(Model)
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyDown})
	m = updated.(Model)
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeySpace})
	m = updated.(Model)
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = updated.(Model)
	if len(sender.messages) != 1 {
		t.Fatalf("messages=%d", len(sender.messages))
	}
	if m.pendingInput != nil {
		t.Fatal("input request still pending")
	}

	m.pendingInput = newInputRequest("q2", "Skip", "text", nil)
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyEscape})
	m = updated.(Model)
	if len(sender.messages) != 2 {
		t.Fatalf("escape did not resolve request")
	}
}

func TestSlashApprovalCommandNeverReachesAgent(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.composer.input.SetValue("/approval bash")
	m.submit()
	if len(sender.messages) != 1 {
		t.Fatalf("expected mode message, got %d", len(sender.messages))
	}
	if m.approvalMode != "bash" {
		t.Fatalf("mode=%q", m.approvalMode)
	}
	m.composer.input.SetValue("text /approval bash")
	m.submit()
	if len(sender.messages) != 2 {
		t.Fatalf("message containing slash was intercepted")
	}
	if strings.Contains(m.notices.Items[len(m.notices.Items)-1].Message, "unknown") {
		t.Fatal("unexpected slash error")
	}
}

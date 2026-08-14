package ui

import (
	"encoding/json"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"harness-tui/internal/prefs"
	"harness-tui/internal/protocol"
	"harness-tui/internal/ws"
)

func press(r rune) tea.KeyMsg { return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}} }

func TestAppMessageToolAndEndFlow(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.composer.input.SetValue("ship it")
	m.submit()
	m.handleServerMessage(protocol.ServerMessage{Type: "token", Content: "done"})
	m.handleServerMessage(protocol.ServerMessage{Type: "tool_start", Name: "Bash", Input: map[string]interface{}{"command": "ls"}})
	m.handleServerMessage(protocol.ServerMessage{Type: "tool_end", Name: "Bash", Result: "ok"})
	m.handleServerMessage(protocol.ServerMessage{Type: "stats", TokensOut: 3, CostUSD: 0.01})
	m.handleServerMessage(protocol.ServerMessage{Type: "session_end"})
	m.reflow()
	view := stripANSI(m.View())
	if !strings.Contains(view, "ship it") || !strings.Contains(view, "done") || !strings.Contains(view, "Bash") {
		t.Fatalf("flow view missing content: %s", view)
	}
}

func TestAppApprovalInputOverlayAndReconnect(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.pendingApproval = &ApprovalRequest{ID: "a1", Name: "Bash", Risk: "danger", Reason: "destructive filesystem removal"}
	updated, _ := m.Update(press('y'))
	m = updated.(Model)
	if len(sender.messages) != 1 {
		t.Fatalf("approval messages=%d", len(sender.messages))
	}

	m.pendingInput = newInputRequest("q1", "Choose", "multi_select", []string{"a", "b"})
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeySpace})
	m = updated.(Model)
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = updated.(Model)
	if m.pendingInput != nil || len(sender.messages) != 2 {
		t.Fatalf("input unresolved pending=%v messages=%d", m.pendingInput, len(sender.messages))
	}

	m.composer.input.SetValue("keep me")
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyTab})
	m = updated.(Model)
	if m.composer.Value() != "keep me" || !m.overlayOpen {
		t.Fatalf("overlay changed composer=%q open=%v", m.composer.Value(), m.overlayOpen)
	}
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyEscape})
	m = updated.(Model)
	if m.overlayOpen {
		t.Fatal("overlay did not close")
	}

	updated, _ = m.Update(ws.DisconnectedMsg{})
	m = updated.(Model)
	if m.connected || m.notices.DisconnectedAt.IsZero() {
		t.Fatal("disconnect state missing")
	}
	updated, _ = m.Update(ws.ConnectedMsg{})
	m = updated.(Model)
	if !m.connected {
		t.Fatal("reconnect state missing")
	}
}

func TestInstalledSkillCompletesAndDispatchesPrompt(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "coding", "tester", prefs.Preferences{})
	m.handleServerMessage(protocol.ServerMessage{Type: "skills", Installed: []protocol.SkillSummary{
		{Name: "code-review", Description: "review code"},
		{Name: "theme", Description: "skill collision"},
	}})
	m.composer.input.SetValue("/")
	m.recomputeCompletion()
	if len(m.completion.Items) != len(slashOrder)+1 || m.completion.Items[len(m.completion.Items)-1].Label != "/code-review" {
		t.Fatalf("skill completion items = %#v", m.completion.Items)
	}
	for _, item := range m.completion.Items {
		if item.Label == "/theme" && item.Kind != CompletionCommand {
			t.Fatal("built-in /theme should win skill collision")
		}
	}

	m.composer.input.SetValue("/code-review auth module")
	m.submit()
	if len(sender.messages) != 1 {
		t.Fatalf("sent messages = %d", len(sender.messages))
	}
	wire, err := json.Marshal(sender.messages[0])
	var envelope struct {
		Content string `json:"content"`
	}
	if err == nil {
		err = json.Unmarshal(wire, &envelope)
	}
	if err != nil || envelope.Content != `Use the "code-review" skill. auth module` {
		t.Fatalf("skill dispatch wire=%s err=%v", wire, err)
	}
}

func TestCustomCommandExpandsArgumentsAndCanIgnoreThem(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "coding", "tester", prefs.Preferences{})
	m.handleServerMessage(protocol.ServerMessage{Type: "commands", Commands: []protocol.CommandSummary{
		{Name: "review", Description: "review changes", Template: "Review $ARGUMENTS"},
		{Name: "status", Description: "fixed text", Template: "Show status"},
	}})
	m.composer.input.SetValue("/review auth module")
	m.submit()
	m.handleServerMessage(protocol.ServerMessage{Type: "session_end"})
	m.composer.input.SetValue("/status ignored args")
	m.submit()
	if len(sender.messages) != 2 {
		t.Fatalf("sent messages = %d", len(sender.messages))
	}
	for i, want := range []string{"Review auth module", "Show status"} {
		wire, err := json.Marshal(sender.messages[i])
		var envelope struct {
			Content string `json:"content"`
		}
		if err == nil {
			err = json.Unmarshal(wire, &envelope)
		}
		if err != nil || envelope.Content != want {
			t.Fatalf("command %d wire=%s content=%q err=%v", i, wire, envelope.Content, err)
		}
	}
}

func TestSessionListOpensPickerWithPastSessions(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "coding", "tester", prefs.Preferences{})
	if _, ok := m.handleSlash("/sessions"); !ok {
		t.Fatal("/sessions should be handled")
	}
	if !m.sessionPicker || len(sender.messages) != 1 {
		t.Fatalf("session request picker=%v messages=%d", m.sessionPicker, len(sender.messages))
	}
	wire, err := json.Marshal(sender.messages[0])
	if err != nil || string(wire) != `{"type":"session_list"}` {
		t.Fatalf("session request=%s err=%v", wire, err)
	}
	m.handleServerMessage(protocol.ServerMessage{Type: "sessions", Sessions: []protocol.SessionSummary{
		{ID: "sess-1", Title: "Yesterday's work", CreatedAt: "2026-08-13T10:00:00Z", Usage: protocol.Usage{CostUSD: 0.42}},
	}})
	if !m.sessionPicker || len(m.sessionOptions) != 1 || m.sessionOptions[0].ID != "sess-1" {
		t.Fatalf("session picker options=%#v open=%v", m.sessionOptions, m.sessionPicker)
	}
}

func TestEmptySessionPickerExplainsFreshStart(t *testing.T) {
	m := NewModel(&recordingSender{}, "coding", "tester", prefs.Preferences{})
	m.sessionPicker = true
	view := stripANSI(m.View())
	if !strings.Contains(view, "no past sessions") {
		t.Fatalf("empty session picker missing explicit state: %s", view)
	}
}

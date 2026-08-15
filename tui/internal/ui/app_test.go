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

func TestPlanRequestStageArtifactSelectAndProceedFlow(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "coding", "tester", prefs.Preferences{})
	if _, handled := m.handleSlash("/plan refactor auth"); !handled {
		t.Fatal("/plan should be handled")
	}
	if len(sender.messages) != 1 {
		t.Fatalf("plan messages=%d", len(sender.messages))
	}
	wire, err := json.Marshal(sender.messages[0])
	if err != nil || string(wire) != `{"type":"plan_request","content":"refactor auth"}` {
		t.Fatalf("plan request=%s err=%v", wire, err)
	}
	m.handleServerMessage(protocol.ServerMessage{Type: "stage", Stage: "recon", State: "start"})
	m.handleServerMessage(protocol.ServerMessage{Type: "stage", Stage: "plan", State: "done"})
	m.handleServerMessage(protocol.ServerMessage{Type: "plan", Content: "## Plan\nstep one\n## Risks\nnone"})
	m.handleServerMessage(protocol.ServerMessage{Type: "input_request", ID: "plan-choice", Kind: "select", Prompt: "Plan ready", Options: []string{"proceed", "edit", "cancel"}})
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = updated.(Model)
	if m.pendingInput != nil || len(sender.messages) != 2 {
		t.Fatalf("plan choice pending=%v messages=%d", m.pendingInput, len(sender.messages))
	}
	m.handleServerMessage(protocol.ServerMessage{Type: "artifacts", Artifacts: []protocol.Artifact{{ID: "plan-1", Kind: "doc", Title: "Plan", Icon: "🗺️", Meta: "approved plan"}}})
	m.reflow()
	view := stripANSI(m.View())
	if !strings.Contains(view, "PLAN") || !strings.Contains(view, "step one") || !strings.Contains(view, "approved plan") {
		t.Fatalf("plan flow view missing content: %s", view)
	}
	if m.transcript.Turns[len(m.transcript.Turns)-1].Role != "plan" {
		t.Fatalf("last turn role=%q", m.transcript.Turns[len(m.transcript.Turns)-1].Role)
	}
}

func TestUndoPanelListsUnavailableAndAppliesAvailableEntry(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "coding", "tester", prefs.Preferences{})
	if _, handled := m.handleSlash("/undo"); !handled {
		t.Fatal("/undo should be handled")
	}
	if len(sender.messages) != 1 {
		t.Fatalf("undo list messages=%d", len(sender.messages))
	}
	m.handleServerMessage(protocol.ServerMessage{Type: "undo_entries", Undo: []protocol.UndoEntry{
		{ID: "expired", Tool: "Write", Target: "old.go", Available: false, Reason: "undo window has expired"},
		{ID: "current", Tool: "Edit", Target: "main.go", Available: true},
	}})
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyDown})
	m = updated.(Model)
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = updated.(Model)
	if len(sender.messages) != 2 {
		t.Fatalf("undo apply messages=%d", len(sender.messages))
	}
	wire, err := json.Marshal(sender.messages[1])
	if err != nil || string(wire) != `{"type":"undo_apply","id":"current"}` {
		t.Fatalf("undo apply wire=%s err=%v", wire, err)
	}
	view := stripANSI(undoPanelView(nil, 0, 100, 30))
	if !strings.Contains(view, "nothing to undo in this session") {
		t.Fatalf("empty undo state missing: %s", view)
	}
}

func TestUndoPanelRequiresTwoEnterPressesForLegacyForce(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "coding", "tester", prefs.Preferences{})
	if _, handled := m.handleSlash("/undo"); !handled {
		t.Fatal("/undo should be handled")
	}
	m.handleServerMessage(protocol.ServerMessage{Type: "undo_entries", Undo: []protocol.UndoEntry{
		{ID: "legacy", Tool: "Write", Target: "gone.go", Available: false, Forceable: true, Reason: "cannot verify"},
	}})
	baseline := len(sender.messages)
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = updated.(Model)
	if len(sender.messages) != baseline || m.undoForceID != "legacy" {
		t.Fatalf("first force confirmation messages=%d armed=%q", len(sender.messages), m.undoForceID)
	}
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = updated.(Model)
	if len(sender.messages) != baseline+1 {
		t.Fatalf("second force confirmation messages=%d", len(sender.messages))
	}
	wire, err := json.Marshal(sender.messages[baseline])
	if err != nil || string(wire) != `{"type":"undo_apply","id":"legacy","force":true}` {
		t.Fatalf("forced undo wire=%s err=%v", wire, err)
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

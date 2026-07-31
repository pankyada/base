package ui

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"harness-tui/internal/prefs"
	"harness-tui/internal/protocol"
	"harness-tui/internal/ws"
)

type recordingSender struct{ messages []protocol.ClientMessage }

func (s *recordingSender) Send(message protocol.ClientMessage) {
	s.messages = append(s.messages, message)
}

func TestModelStreamsTurnAndResolvesTool(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.composer.input.SetValue("hello")
	m.submit()
	if !m.running || len(sender.messages) != 1 {
		t.Fatalf("submit running=%v messages=%d", m.running, len(sender.messages))
	}

	m.handleServerMessage(protocol.ServerMessage{Type: "session_ready", SessionID: "sess-1", Model: "mock-model", Profile: "devops"})
	m.handleServerMessage(protocol.ServerMessage{Type: "token", Content: "hi"})
	m.handleServerMessage(protocol.ServerMessage{Type: "tool_start", Name: "read", Input: map[string]interface{}{"path": "a.go"}})
	m.handleServerMessage(protocol.ServerMessage{Type: "tool_end", Name: "read", Result: "ok"})
	m.handleServerMessage(protocol.ServerMessage{Type: "stats", TokensIn: 3, TokensOut: 4, CostUSD: 0.01})
	m.handleServerMessage(protocol.ServerMessage{Type: "session_end"})

	if m.running {
		t.Fatal("turn still running after session_end")
	}
	if m.model != "mock-model" || m.sessionID != "sess-1" {
		t.Fatalf("session metadata model=%q session=%q", m.model, m.sessionID)
	}
	if len(m.transcript.Turns) != 2 || m.transcript.Turns[1].Text != "hi" {
		t.Fatalf("transcript = %#v", m.transcript.Turns)
	}
	if len(m.transcript.Turns[1].Sections) != 1 || m.transcript.Turns[1].Sections[0].State != SectionDone {
		t.Fatalf("sections = %#v", m.transcript.Turns[1].Sections)
	}
}

func TestToolStartSetsCategory(t *testing.T) {
	m := NewModel(&recordingSender{}, "devops", "tester", prefs.Preferences{})
	m.handleServerMessage(protocol.ServerMessage{Type: "session_ready", SessionID: "sess-1"})
	m.handleServerMessage(protocol.ServerMessage{Type: "tool_start", Name: "Read", Input: map[string]interface{}{"path": "foo.go"}})
	sections := m.currentAgent().Sections
	if len(sections) != 1 || sections[0].Category != "files" {
		t.Fatalf("sections = %#v", sections)
	}
}

func TestToolPromptMarksAwaitingApproval(t *testing.T) {
	m := NewModel(&recordingSender{}, "devops", "tester", prefs.Preferences{})
	m.handleServerMessage(protocol.ServerMessage{Type: "session_ready", SessionID: "sess-1"})
	m.handleServerMessage(protocol.ServerMessage{Type: "tool_start", Name: "Bash", Input: map[string]interface{}{}})
	m.handleServerMessage(protocol.ServerMessage{Type: "tool_prompt", ID: "1", Name: "Bash", Input: map[string]interface{}{}})
	if !m.currentAgent().Sections[0].AwaitingApproval {
		t.Fatal("expected Bash section to await approval")
	}
}

func TestApprovalResolutionClearsAwaitingApproval(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.handleServerMessage(protocol.ServerMessage{Type: "session_ready", SessionID: "sess-1"})
	m.handleServerMessage(protocol.ServerMessage{Type: "tool_start", Name: "Bash"})
	m.handleServerMessage(protocol.ServerMessage{Type: "tool_prompt", ID: "1", Name: "Bash"})
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'n'}})
	m = updated.(Model)
	if m.currentAgent().Sections[0].AwaitingApproval {
		t.Fatal("approval denial should clear awaiting state")
	}
}

func TestMouseClickTogglesGroup(t *testing.T) {
	m := NewModel(&recordingSender{}, "devops", "tester", prefs.Preferences{})
	m.transcript.Turns = []Turn{{Role: "agent", Sections: []Section{{Name: "Read", Category: "files", State: SectionDone, Body: "body"}}}}
	m.reflow()
	_, hits := m.transcript.RenderWithHitMap(m.viewport.Width, m.frame)
	if len(hits) == 0 || hits[0].GroupKey == "" {
		t.Fatal("expected group header hit")
	}
	topBarHeight := lipgloss.Height(topBar(m.profile, m.sessionID, m.connected, m.running, m.frame, time.Now(), m.width))
	updated, _ := m.Update(tea.MouseMsg{Action: tea.MouseActionRelease, Button: tea.MouseButtonLeft, Y: topBarHeight + hits[0].Y})
	m = updated.(Model)
	if !m.transcript.Turns[0].ExpandedGroups[hits[0].GroupKey] {
		t.Fatalf("group %q did not expand after click", hits[0].GroupKey)
	}
}

func TestModelHandlesDisconnectAndServerError(t *testing.T) {
	m := NewModel(nil, "devops", "tester", prefs.Preferences{})
	updated, _ := m.Update(ws.DisconnectedMsg{})
	m = updated.(Model)
	if m.notices.DisconnectedAt.IsZero() {
		t.Fatal("disconnect timestamp missing")
	}
	m.handleServerMessage(protocol.ServerMessage{Type: "error", Message: "unknown model: x"})
	if len(m.notices.Items) != 1 || !strings.Contains(m.notices.Items[0].Suggestion, "/model") {
		t.Fatalf("notices = %#v", m.notices.Items)
	}
}

func TestModelQueuesBusyMessagesAndDrainsAfterSessionEnd(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.running = true
	m.composer.input.SetValue("later")
	m.submit()
	if len(m.queue) != 1 || len(sender.messages) != 0 {
		t.Fatalf("queue=%v messages=%d", m.queue, len(sender.messages))
	}
	m.handleServerMessage(protocol.ServerMessage{Type: "session_end"})
	if !m.running || len(m.queue) != 0 || len(sender.messages) != 1 {
		t.Fatalf("session end should drain queue: running=%v queue=%d messages=%d", m.running, len(m.queue), len(sender.messages))
	}
}

func TestModelPickerFiltersAndAcceptsCustomID(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.modelPicker = true
	m.modelOptions = []protocol.ModelInfo{
		{ID: "gpt-5.4-mini", Label: "GPT-5.4 mini", Available: true},
		{ID: "claude-sonnet-5", Label: "Claude Sonnet 5", Available: false, Reason: "another provider"},
	}
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	m = updated.(Model)
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'g'}})
	m = updated.(Model)
	if m.modelFilter != "g" || len(m.visibleModels()) != 1 {
		t.Fatalf("filter=%q visible=%d", m.modelFilter, len(m.visibleModels()))
	}
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = updated.(Model)
	if m.model != "gpt-5.4-mini" || m.modelPicker {
		t.Fatalf("filtered selection model=%q picker=%v", m.model, m.modelPicker)
	}

	m.modelPicker = true
	m.modelFilter = ""
	m.modelCursor = len(m.modelOptions)
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = updated.(Model)
	if !m.modelCustom {
		t.Fatal("custom row did not open input")
	}
	for _, r := range "custom-model" {
		updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
		m = updated.(Model)
	}
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = updated.(Model)
	if m.model != "custom-model" || m.modelCustom {
		t.Fatalf("custom selection model=%q custom=%v", m.model, m.modelCustom)
	}
}

func TestOverlayModelTabSelectsWithoutLeavingOverlay(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.openOverlay("model")
	m.handleServerMessage(protocol.ServerMessage{Type: "models", Current: "gpt-4o", Models: []protocol.ModelInfo{
		{ID: "gpt-4o", Label: "GPT-4o", Available: true},
		{ID: "gpt-5.4-mini", Label: "GPT-5.4 mini", Available: true},
	}})
	if m.modelCursor != 0 {
		t.Fatalf("cursor should start on current model, got %d", m.modelCursor)
	}

	// Arrow keys must move the list, not fall through to tab cycling.
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyDown})
	m = updated.(Model)
	if m.overlayTab != "model" || m.modelCursor != 1 {
		t.Fatalf("down: tab=%q cursor=%d", m.overlayTab, m.modelCursor)
	}

	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = updated.(Model)
	if m.model != "gpt-5.4-mini" {
		t.Fatalf("enter did not select model, got %q", m.model)
	}
	if m.overlayOpen {
		t.Fatal("overlay should close after selecting a model")
	}
	var sawSetModel bool
	for _, message := range sender.messages {
		if raw, err := json.Marshal(message); err == nil && strings.Contains(string(raw), `"set_model"`) {
			sawSetModel = true
		}
	}
	if !sawSetModel {
		t.Fatalf("no set_model sent; messages=%d", len(sender.messages))
	}
}

func TestOverlayModelTabRejectsUnavailableModel(t *testing.T) {
	m := NewModel(&recordingSender{}, "devops", "tester", prefs.Preferences{})
	m.openOverlay("model")
	m.handleServerMessage(protocol.ServerMessage{Type: "models", Current: "gpt-4o", Models: []protocol.ModelInfo{
		{ID: "claude-sonnet-5", Label: "Claude Sonnet 5", Available: false, Reason: "another provider"},
	}})
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = updated.(Model)
	if m.model == "claude-sonnet-5" {
		t.Fatal("unavailable model was selected")
	}
	if len(m.notices.Items) == 0 {
		t.Fatal("expected a notice explaining why it is unavailable")
	}
}

func TestOverlayApprovalTabAppliesModeAndGuardsYolo(t *testing.T) {
	m := NewModel(&recordingSender{}, "devops", "tester", prefs.Preferences{})
	m.openOverlay("approval")
	if approvalModes[m.approvalCursor] != m.approvalMode {
		t.Fatalf("cursor should start on current mode %q", m.approvalMode)
	}

	m.approvalCursor = 0 // strict
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = updated.(Model)
	if m.approvalMode != "strict" {
		t.Fatalf("approval mode = %q", m.approvalMode)
	}

	m.approvalCursor = 3 // yolo
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = updated.(Model)
	if m.approvalMode == "yolo" {
		t.Fatal("yolo applied on first enter without confirmation")
	}
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = updated.(Model)
	if m.approvalMode != "yolo" {
		t.Fatalf("yolo not applied on second enter, got %q", m.approvalMode)
	}
}

func TestOverlayTabCyclingPrimesEachTab(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.openOverlay("model")
	for i := 0; i < len(overlayTabs); i++ {
		updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyTab})
		m = updated.(Model)
		if !m.overlayOpen {
			t.Fatalf("overlay closed while cycling at step %d", i)
		}
	}
	if m.overlayTab != "model" {
		t.Fatalf("full cycle should return to model, got %q", m.overlayTab)
	}
}

func TestModelSpendTickerOnlyMovesUpward(t *testing.T) {
	m := NewModel(nil, "devops", "tester", prefs.Preferences{})
	m.costUSD = 1
	updated, _ := m.Update(tickMsg{})
	m = updated.(Model)
	first := m.displayCost
	if first <= 0 || first >= 1 {
		t.Fatalf("first animated cost=%f", first)
	}
	m.costUSD = 0.25
	updated, _ = m.Update(tickMsg{})
	m = updated.(Model)
	if m.displayCost < first {
		t.Fatalf("cost ticker decreased from %f to %f", first, m.displayCost)
	}
}

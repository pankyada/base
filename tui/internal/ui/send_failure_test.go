package ui

import (
	"errors"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"harness-tui/internal/prefs"
	"harness-tui/internal/protocol"
)

type failingSender struct {
	err      error
	attempts []protocol.ClientMessage
}

func (s *failingSender) Send(message protocol.ClientMessage) error {
	s.attempts = append(s.attempts, message)
	return s.err
}

// A frame the transport refused must not look sent: the composer keeps the
// text, the model stays idle, and the operator is told why.
func TestSubmitRetainsContentWhenSendFails(t *testing.T) {
	sender := &failingSender{err: errors.New("not connected")}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.composer.input.SetValue("unsent text")

	m.submit()

	if m.running {
		t.Fatal("model entered a running state after a failed send")
	}
	if got := m.composer.Value(); got != "unsent text" {
		t.Fatalf("composer content lost: %q", got)
	}
	if len(sender.attempts) != 1 {
		t.Fatalf("expected one write attempt, got %d", len(sender.attempts))
	}
	for _, turn := range m.transcript.Turns {
		if turn.Role == "user" {
			t.Fatal("failed send still rendered a user turn")
		}
	}
	if !hasNoticeContaining(m, "not sent") {
		t.Fatalf("no failure notice raised: %+v", m.notices)
	}
}

func TestSubmitSucceedsWhenSendWorks(t *testing.T) {
	sender := &failingSender{}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.composer.input.SetValue("hello")

	m.submit()

	if !m.running {
		t.Fatal("successful send did not enter a running state")
	}
	if got := m.composer.Value(); got != "" {
		t.Fatalf("composer not cleared after a successful send: %q", got)
	}
	if len(sender.attempts) != 1 {
		t.Fatalf("expected one write attempt, got %d", len(sender.attempts))
	}
}

func hasNoticeContaining(m Model, want string) bool {
	for _, notice := range m.notices.Items {
		if strings.Contains(strings.ToLower(notice.Message+" "+notice.Detail), want) {
			return true
		}
	}
	return false
}

// startAgentMessage and startPlanMessage must not leave the model claiming a
// run is in progress when the frame never left the client.
func TestStartAgentMessageLeavesIdleOnSendFailure(t *testing.T) {
	sender := &failingSender{err: errors.New("not connected")}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	turnsBefore := len(m.transcript.Turns)

	ok := m.startAgentMessage("remember this")

	if ok {
		t.Fatal("expected startAgentMessage to report failure")
	}
	if m.running {
		t.Fatal("model entered a running state after a failed send")
	}
	if len(m.transcript.Turns) != turnsBefore {
		t.Fatalf("failed send still added a transcript turn: %+v", m.transcript.Turns)
	}
}

func TestStartPlanMessageLeavesIdleOnSendFailure(t *testing.T) {
	sender := &failingSender{err: errors.New("not connected")}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	turnsBefore := len(m.transcript.Turns)

	m.startPlanMessage("plan this")

	if m.running {
		t.Fatal("model entered a running state after a failed send")
	}
	if len(m.transcript.Turns) != turnsBefore {
		t.Fatalf("failed send still added a transcript turn: %+v", m.transcript.Turns)
	}
}

// The "#" memory shortcut appends a memory turn before delegating to
// startAgentMessage; a failed send must not leave that turn orphaned.
func TestSubmitMemoryShortcutRollsBackOnSendFailure(t *testing.T) {
	sender := &failingSender{err: errors.New("not connected")}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.composer.input.SetValue("# prefers dark mode")

	m.submit()

	if m.running {
		t.Fatal("model entered a running state after a failed send")
	}
	for _, turn := range m.transcript.Turns {
		if turn.Role == "memory" {
			t.Fatal("failed send left an orphaned memory turn")
		}
	}
}

func TestUpdateApprovalKeepsPendingOnDenyFailure(t *testing.T) {
	sender := &failingSender{err: errors.New("not connected")}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.pendingApproval = &ApprovalRequest{ID: "call-1", Name: "bash"}

	m.updateApproval(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("n")})

	if m.pendingApproval == nil {
		t.Fatal("failed deny send cleared the pending approval prompt")
	}
}

func TestUpdateApprovalKeepsPendingOnApproveFailure(t *testing.T) {
	sender := &failingSender{err: errors.New("not connected")}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.pendingApproval = &ApprovalRequest{ID: "call-1", Name: "bash"}

	m.updateApproval(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("y")})

	if m.pendingApproval == nil {
		t.Fatal("failed approve send cleared the pending approval prompt")
	}
}

// A failed SetApprovalMode("yolo") send must not leave local state claiming
// tools now run unapproved when the server never agreed.
func TestUpdateApprovalDoesNotFlipToYoloOnSendFailure(t *testing.T) {
	sender := &failingSender{err: errors.New("not connected")}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.approvalMode = "strict"
	m.pendingApproval = &ApprovalRequest{ID: "call-1", Name: "bash"}

	m.updateApproval(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("a")})

	if m.approvalMode == "yolo" {
		t.Fatal("approval mode flipped to yolo locally despite failed send")
	}
	if m.pendingApproval == nil {
		t.Fatal("failed approve-all send cleared the pending approval prompt")
	}
}

func TestUpdateInputKeepsPendingOnSendFailure(t *testing.T) {
	sender := &failingSender{err: errors.New("not connected")}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.pendingInput = newInputRequest("req-1", "pick one", "select", []string{"a", "b"})

	m.updateInput(tea.KeyMsg{Type: tea.KeyEnter})

	if m.pendingInput == nil {
		t.Fatal("failed input response send cleared the pending input prompt")
	}
}

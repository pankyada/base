package ui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"harness-tui/internal/prefs"
	"harness-tui/internal/protocol"
	"harness-tui/internal/ws"
)

// TestEnterDuringReconnectPendingDoesNotVanish covers PT-072: a live PTY run
// observed that pressing Enter on a non-empty composer while a
// reconnect-driven resume was outstanding (socket back online,
// session_resumed not yet received) produced no "message" frame, no user
// turn, and no notice — the keystroke and the composer text simply
// vanished. Exactly one of the following must be true: the frame went out
// and a user turn was recorded, or nothing was sent and the operator was
// told why with their text intact. Silence is the bug.
func TestEnterDuringReconnectPendingDoesNotVanish(t *testing.T) {
	sender := &failingSender{err: nil}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})

	// Initial attach.
	m = asModel(m.Update(ws.ConnectedMsg{}))
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_ready", SessionID: "sess-1", Profile: "devops"}}))

	// Socket drops, then reconnects — reconnectPending goes true and a
	// resume(sess-1) frame goes out, but session_resumed has not arrived yet.
	m = asModel(m.Update(ws.DisconnectedMsg{}))
	m = asModel(m.Update(ws.ConnectedMsg{}))
	if !m.reconnectPending {
		t.Fatal("setup: expected a reconnect-driven resume to be pending")
	}

	// hello also re-attaches to a brand-new session before the resume settles
	// (documented behavior — sendSessionReady runs unconditionally on every
	// hello).
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_ready", SessionID: "sess-9", Profile: "devops"}}))
	if !m.reconnectPending {
		t.Fatal("setup: reconnectPending should still be set — session_resumed has not arrived")
	}

	m.composer.input.SetValue("hello during reconnect")
	sender.attempts = nil
	noticesBefore := len(m.notices.Items)
	turnsBefore := len(m.transcript.Turns)

	m = asModel(m.Update(tea.KeyMsg{Type: tea.KeyEnter}))

	sentMessage := attemptsContainType(sender.attempts, "message")
	gotUserTurn := len(m.transcript.Turns) > turnsBefore
	gotNotice := len(m.notices.Items) > noticesBefore
	textPreserved := m.composer.Value() == "hello during reconnect"

	if sentMessage && gotUserTurn {
		return // sent normally — acceptable
	}
	if !sentMessage && textPreserved && gotNotice {
		return // refused with a visible notice and text kept — acceptable
	}

	t.Fatalf(
		"PT-072 reproduced: Enter during reconnectPending vanished silently — sentMessage=%v gotUserTurn=%v gotNotice=%v textPreserved=%v composer=%q attempts=%+v",
		sentMessage, gotUserTurn, gotNotice, textPreserved, m.composer.Value(), sender.attempts,
	)
}

// TestEnterDuringReconnectPendingSurvivesSessionResumed guards the fix's
// reason for existing: before it, a send during reconnectPending succeeded
// against the fresh session hello attached (session_ready sess-9) and
// appended a user turn there, only for session_resumed's unconditional
// transcript reset (once the real sess-1 resume landed) to wipe that turn
// from view with no notice — reproducing the reported symptom one step
// later than the keypress itself. With the fix, nothing is sent while
// reconnectPending, so there is nothing for session_resumed to erase and
// the operator's text survives across the resume.
func TestEnterDuringReconnectPendingSurvivesSessionResumed(t *testing.T) {
	sender := &failingSender{err: nil}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})

	m = asModel(m.Update(ws.ConnectedMsg{}))
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_ready", SessionID: "sess-1", Profile: "devops"}}))
	m = asModel(m.Update(ws.DisconnectedMsg{}))
	m = asModel(m.Update(ws.ConnectedMsg{}))
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_ready", SessionID: "sess-9", Profile: "devops"}}))

	m.composer.input.SetValue("hello during reconnect")
	m = asModel(m.Update(tea.KeyMsg{Type: tea.KeyEnter}))

	if attemptsContainType(sender.attempts, "message") {
		t.Fatalf("expected no message frame while reconnectPending, got %+v", sender.attempts)
	}
	if m.composer.Value() != "hello during reconnect" {
		t.Fatalf("composer text lost while reconnectPending: %q", m.composer.Value())
	}
	if !hasNoticeContaining(m, "restoring") {
		t.Fatalf("expected a notice explaining the refusal, got %+v", m.notices.Items)
	}

	// The real resume now lands.
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_resumed", SessionID: "sess-1", Profile: "devops"}}))

	if m.composer.Value() != "hello during reconnect" {
		t.Fatalf("composer text lost after session_resumed: %q", m.composer.Value())
	}
	for _, turn := range m.transcript.Turns {
		if turn.Role == "user" {
			t.Fatal("unexpected user turn survived from the refused send")
		}
	}
}

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

// attemptsContainResume reports whether any attempted send is a "resume"
// frame for sessionID. resumeMsg is unexported in package protocol, so this
// goes through JSON like the real wire encoding does.
func attemptsContainResume(attempts []protocol.ClientMessage, sessionID string) bool {
	for _, attempt := range attempts {
		raw, err := json.Marshal(attempt)
		if err != nil {
			continue
		}
		var decoded struct {
			Type      string `json:"type"`
			SessionID string `json:"sessionId"`
		}
		if json.Unmarshal(raw, &decoded) == nil && decoded.Type == "resume" && decoded.SessionID == sessionID {
			return true
		}
	}
	return false
}

func asModel(tm tea.Model, _ tea.Cmd) Model {
	return tm.(Model)
}

// TestReconnectRestoresSessionAndProfile covers spec C3.3/C3.4: after a
// reconnect, the client must re-attach the operator's previously selected
// session through the existing resume/session_resumed contract, not assume
// server memory of the old socket or silently drift to whatever fresh
// session the reconnect's hello handshake attaches.
func TestReconnectRestoresSessionAndProfile(t *testing.T) {
	sender := &failingSender{err: nil}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})

	// Initial attach.
	m = asModel(m.Update(ws.ConnectedMsg{}))
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_ready", SessionID: "sess-1", Profile: "devops"}}))
	if m.sessionID != "sess-1" {
		t.Fatalf("setup: expected sess-1 attached, got %q", m.sessionID)
	}

	// The socket drops.
	m = asModel(m.Update(ws.DisconnectedMsg{}))
	if m.reconnectTarget != "sess-1" {
		t.Fatalf("expected the live session to be remembered for reconnect, got %q", m.reconnectTarget)
	}

	// It reconnects. hello re-attaches (server would send a fresh
	// session_ready here in the real flow); the model must additionally ask
	// to resume the session the operator actually had open.
	sender.attempts = nil
	m = asModel(m.Update(ws.ConnectedMsg{}))
	if !m.reconnectPending {
		t.Fatal("expected a reconnect-driven resume to be pending")
	}
	if !attemptsContainResume(sender.attempts, "sess-1") {
		t.Fatalf("expected a resume(sess-1) frame after reconnect, got %+v", sender.attempts)
	}

	// Server confirms the restore.
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_resumed", SessionID: "sess-1"}}))
	if m.reconnectPending {
		t.Fatal("reconnectPending should clear once the resume is acknowledged")
	}
	if m.sessionID != "sess-1" {
		t.Fatalf("expected the operator to be back in sess-1, got %q", m.sessionID)
	}
	if m.profile != "devops" {
		t.Fatalf("expected profile to remain devops (carried by hello, unaffected by resume), got %q", m.profile)
	}
	if !hasNoticeContaining(m, "reconnected") {
		t.Fatal("expected a notice confirming the session was restored")
	}
}

// TestReconnectRecoveryFailureReportsVisibly covers the case called out in
// the task: the previously selected session no longer exists server-side.
// The operator must be told plainly, not left to discover mid-turn that
// they're in a different session than before.
func TestReconnectRecoveryFailureReportsVisibly(t *testing.T) {
	sender := &failingSender{err: nil}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})

	m = asModel(m.Update(ws.ConnectedMsg{}))
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_ready", SessionID: "sess-1", Profile: "devops"}}))
	m = asModel(m.Update(ws.DisconnectedMsg{}))
	if m.reconnectTarget != "sess-1" {
		t.Fatalf("setup: expected sess-1 remembered, got %q", m.reconnectTarget)
	}

	m = asModel(m.Update(ws.ConnectedMsg{}))
	if !m.reconnectPending {
		t.Fatal("expected a reconnect-driven resume to be pending")
	}

	// hello re-attached us to a brand-new session before the resume settled.
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_ready", SessionID: "sess-9", Profile: "devops"}}))
	// The old session is gone: the server reports resume failure.
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "error", Message: "Session sess-1 not found"}}))

	if m.reconnectPending {
		t.Fatal("reconnectPending should clear once the resume fails")
	}
	if m.reconnectTarget != "" {
		t.Fatalf("reconnectTarget should clear on failure, got %q", m.reconnectTarget)
	}
	if m.sessionID != "sess-9" {
		t.Fatalf("operator should truthfully be shown the fresh session they landed in, got %q", m.sessionID)
	}
	if !hasNoticeContaining(m, "not restored") {
		t.Fatal("expected a visible notice reporting the failed session restore")
	}
	found := false
	for _, notice := range m.notices.Items {
		if strings.Contains(notice.Message, "not restored") && strings.Contains(notice.Detail, "not found") {
			found = true
		}
	}
	if !found {
		t.Fatal("expected the failure notice to carry the server's reason")
	}
}

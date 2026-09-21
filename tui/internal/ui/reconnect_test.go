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

	// Server confirms the restore and, since PT-033, names the post-resume
	// profile authoritatively.
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_resumed", SessionID: "sess-1", Profile: "devops", WorkingDir: "/saved/project"}}))
	if m.reconnectPending {
		t.Fatal("reconnectPending should clear once the resume is acknowledged")
	}
	if m.sessionID != "sess-1" {
		t.Fatalf("expected the operator to be back in sess-1, got %q", m.sessionID)
	}
	if m.profile != "devops" {
		t.Fatalf("expected profile taken from session_resumed (devops), got %q", m.profile)
	}
	if m.workingDir != "/saved/project" {
		t.Fatalf("expected working directory from session_resumed, got %q", m.workingDir)
	}
	if !hasNoticeContaining(m, "reconnected") {
		t.Fatal("expected a notice confirming the session was restored")
	}
	if !attemptsContainType(sender.attempts, "runtime_subscribe") {
		t.Fatal("expected runtime subscription after session resume")
	}
}

// profileRecordingSender implements both MessageSender and ProfileSetter so
// tests can assert the model tells the sender about a profile change instead
// of only updating its own m.profile field.
type profileRecordingSender struct {
	failingSender
	profiles []string
}

func (s *profileRecordingSender) SetProfile(profile string) {
	s.profiles = append(s.profiles, profile)
}

// TestReconnectProfileChangePropagatesToSender covers PT-003(c): when the
// server moves the connection to a different profile (session_ready or a
// cross-profile session_resumed), the model must tell a sender that
// remembers a profile across reconnects (ProfileSetter) about the change —
// not just update its own display field — so a later transport drop
// reconnects under the operator's current profile rather than the one the
// process launched with.
func TestReconnectProfileChangePropagatesToSender(t *testing.T) {
	sender := &profileRecordingSender{}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})

	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_ready", SessionID: "sess-1", Profile: "devops"}}))
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_resumed", SessionID: "sess-q", Profile: "research"}}))

	if m.profile != "research" {
		t.Fatalf("expected model profile to follow session_resumed, got %q", m.profile)
	}
	found := false
	for _, p := range sender.profiles {
		if p == "research" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected sender.SetProfile(\"research\") to be called, got %+v", sender.profiles)
	}
}

func attemptsContainType(attempts []protocol.ClientMessage, want string) bool {
	for _, attempt := range attempts {
		raw, err := json.Marshal(attempt)
		if err != nil {
			continue
		}
		var decoded struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(raw, &decoded) == nil && decoded.Type == want {
			return true
		}
	}
	return false
}

func TestRuntimeRestoresOnlyFullApprovalPrompt(t *testing.T) {
	sender := &failingSender{}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.handleServerMessage(protocol.ServerMessage{Type: "session_ready", SessionID: "sess-1"})
	m.handleServerMessage(protocol.ServerMessage{Type: "runtime", Runtime: &protocol.RuntimeSnapshot{SessionID: "sess-1", Actionable: []protocol.RecoverablePrompt{{ID: "tool-1", Name: "Bash", Input: map[string]interface{}{"command": "pwd"}}}}})
	if m.pendingApproval == nil || m.pendingApproval.ID != "tool-1" {
		t.Fatalf("approval not restored: %#v", m.pendingApproval)
	}
	if len(m.currentAgent().Sections) != 1 || !m.currentAgent().Sections[0].AwaitingApproval {
		t.Fatalf("recovered section missing: %#v", m.currentAgent().Sections)
	}
	m.handleServerMessage(protocol.ServerMessage{Type: "runtime", Runtime: &protocol.RuntimeSnapshot{SessionID: "sess-1", Actionable: []protocol.RecoverablePrompt{{ID: "bare"}}}})
	if m.pendingApproval.ID != "tool-1" {
		t.Fatal("bare actionable ID created authority")
	}
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'y'}})
	m = updated.(Model)
	if m.pendingApproval != nil || !attemptsContainType(sender.attempts, "tool_approve") {
		t.Fatalf("recovered approval did not use normal control path: %#v", sender.attempts)
	}
}

// TestResumeAdoptsCrossProfile covers PT-033: resuming a session created
// under a different profile switches the connection server-side, and the
// model must follow the profile session_resumed reports rather than keep
// showing the one hello connected with.
func TestResumeAdoptsCrossProfile(t *testing.T) {
	sender := &failingSender{err: nil}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m = asModel(m.Update(ws.ConnectedMsg{}))
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_ready", SessionID: "sess-p", Profile: "devops"}}))
	if m.profile != "devops" {
		t.Fatalf("setup: expected devops, got %q", m.profile)
	}

	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_resumed", SessionID: "sess-q", Profile: "research"}}))
	if m.sessionID != "sess-q" {
		t.Fatalf("expected sess-q, got %q", m.sessionID)
	}
	if m.profile != "research" {
		t.Fatalf("expected profile to follow session_resumed (research), got %q", m.profile)
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

// TestReconnectReassertsRememberedApprovalMode covers the live PTY finding
// behind PT-003/PT-007: every hello rebuilds server-side connection state
// from the profile default ("danger") and the server then announces it via
// approval_mode_changed. If the model only re-sent the remembered mode when
// it differed from its own local field, a reconnect silently downgraded the
// operator to danger while the prefs still said "bash".
func TestReconnectReassertsRememberedApprovalMode(t *testing.T) {
	sender := &failingSender{}
	m := NewModel(sender, "connecting", "tester", prefs.Preferences{ApprovalModeByProfile: map[string]string{"fixture-p": "bash"}})

	m = asModel(m.Update(ws.ConnectedMsg{}))
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_ready", SessionID: "sess-1", Profile: "fixture-p"}}))
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "approval_mode_changed", Mode: "bash"}}))
	if m.approvalMode != "bash" {
		t.Fatalf("setup: expected remembered bash mode applied, got %q", m.approvalMode)
	}

	// Transport drops and comes back; the server's fresh hello state is danger.
	m = asModel(m.Update(ws.DisconnectedMsg{}))
	sender.attempts = nil
	m = asModel(m.Update(ws.ConnectedMsg{}))
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_ready", SessionID: "sess-2", Profile: "fixture-p"}}))
	if !attemptsContainType(sender.attempts, "set_approval_mode") {
		t.Fatalf("expected the remembered approval mode to be re-sent on reconnect, attempts: %+v", sender.attempts)
	}
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "approval_mode_changed", Mode: "danger"}}))
	m = asModel(m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "approval_mode_changed", Mode: "bash"}}))
	if m.approvalMode != "bash" {
		t.Fatalf("expected bash mode restored after reconnect, got %q", m.approvalMode)
	}
}

package ui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"harness-tui/internal/prefs"
	"harness-tui/internal/protocol"
	"harness-tui/internal/ws"
)

type transcriptLoaderSender struct {
	recordingSender
	loaded ws.TranscriptLoadedMsg
}

func (s *transcriptLoaderSender) LoadTranscript(sessionID, userID, profile string) tea.Cmd {
	return func() tea.Msg {
		if s.loaded.SessionID == "" {
			s.loaded.SessionID = sessionID
		}
		return s.loaded
	}
}

func TestSessionResumeHydratesSelectedHistory(t *testing.T) {
	sender := &transcriptLoaderSender{loaded: ws.TranscriptLoadedMsg{
		SessionID: "sess-old",
		UserID:    "tester",
		Profile:   "coding",
		Turns:     []ws.TranscriptTurn{{Role: "user", Text: "CA08 persisted marker"}},
	}}
	m := NewModel(sender, "coding", "tester", prefs.Preferences{})
	m.transcript.Turns = []Turn{{Role: "user", Text: "stale prior session"}}
	updated, cmd := m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_resumed", SessionID: "sess-old", Profile: "coding"}})
	m = updated.(Model)
	if cmd == nil {
		t.Fatal("session resume did not schedule history hydration")
	}
	loaded, ok := cmd().(ws.TranscriptLoadedMsg)
	if !ok {
		t.Fatalf("hydration command returned %T, want ws.TranscriptLoadedMsg", cmd())
	}
	updated, _ = m.Update(loaded)
	m = updated.(Model)
	if len(m.transcript.Turns) != 1 || m.transcript.Turns[0].Text != "CA08 persisted marker" {
		t.Fatalf("hydrated transcript = %#v", m.transcript.Turns)
	}
}

func TestLateResumeHistoryCannotEraseNewTurn(t *testing.T) {
	sender := &transcriptLoaderSender{loaded: ws.TranscriptLoadedMsg{
		SessionID: "sess-old",
		UserID:    "tester",
		Profile:   "coding",
		Turns:     []ws.TranscriptTurn{{Role: "user", Text: "late old history"}},
	}}
	m := NewModel(sender, "coding", "tester", prefs.Preferences{})
	updated, cmd := m.Update(ws.ServerMsg{Msg: protocol.ServerMessage{Type: "session_resumed", SessionID: "sess-old", Profile: "coding"}})
	m = updated.(Model)
	if cmd == nil {
		t.Fatal("session resume did not schedule history hydration")
	}
	late := cmd().(ws.TranscriptLoadedMsg)
	// New input advances the revision before the old REST response arrives.
	m.composer.input.SetValue("new turn")
	m.submit()
	updated, _ = m.Update(late)
	m = updated.(Model)
	for _, turn := range m.transcript.Turns {
		if turn.Text == "late old history" {
			t.Fatalf("late history erased/replaced new transcript: %#v", m.transcript.Turns)
		}
	}
}

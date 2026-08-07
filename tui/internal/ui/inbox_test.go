package ui

import (
	"strings"
	"testing"

	"harness-tui/internal/prefs"
	"harness-tui/internal/protocol"
)

func samplePending(kind string) protocol.PendingInput {
	return protocol.PendingInput{
		ID: "pending-1", RunID: "run-7", SessionID: "session-3", User: "alice", Profile: "research",
		Prompt: "Choose deployment window", Kind: kind, Options: []string{"morning", "evening"},
		CreatedAt: "2026-08-07T00:00:00Z", ExpiresAt: "2026-08-08T00:00:00Z", State: "open", Channel: "stdout",
	}
}

func TestPendingMessagePopulatesInboxQueue(t *testing.T) {
	m := NewModel(nil, "research", "alice", prefs.Preferences{})
	m.handleServerMessage(protocol.ServerMessage{Type: "pending", Pending: []protocol.PendingInput{samplePending("select")}})
	if len(m.pendingQueue) != 1 || m.pendingQueue[0].ID != "pending-1" {
		t.Fatalf("pending queue = %#v", m.pendingQueue)
	}
}

func TestPendingInboxRendersOpenQuestion(t *testing.T) {
	view := stripANSI(pendingInboxView([]protocol.PendingInput{samplePending("text")}, 0, false, "", 100, 30))
	for _, want := range []string{"Choose deployment window", "research", "run run-7", "expires", "stdout"} {
		if !strings.Contains(view, want) {
			t.Fatalf("inbox view missing %q: %s", want, view)
		}
	}
}

func TestPendingSelectAnswerMustMatchOptions(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "research", "alice", prefs.Preferences{})
	m.pendingQueue = []protocol.PendingInput{samplePending("select")}
	m.pendingAnswering = true
	m.pendingAnswerInput.SetValue("not-an-option")
	m.submitPendingAnswer()
	if len(sender.messages) != 0 {
		t.Fatal("invalid select answer was sent")
	}
	if len(m.notices.Items) == 0 || m.notices.Items[0].Message != "answer not valid" {
		t.Fatalf("invalid answer notice = %#v", m.notices.Items)
	}
}

package ui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"harness-tui/internal/prefs"
	"harness-tui/internal/protocol"
)

func expiredCodexModel() Model {
	m := NewModel(nil, "coding", "tester", prefs.Preferences{})
	m.handleServerMessage(protocol.ServerMessage{Type: "session_ready", ProviderStatus: &protocol.ProviderStatus{Auth: "codex_oauth", Status: "expired"}})
	return m
}

func TestPT087TypingLDoesNotStartCodexLogin(t *testing.T) {
	m := expiredCodexModel()
	m.composer.input.SetValue("there?")
	updated, _ := m.Update(keyRune('l'))
	m = updated.(Model)
	if got := m.composer.Value(); got != "there?l" {
		t.Fatalf("typing l changed composer to %q", got)
	}
	if m.localCancel != nil {
		t.Fatal("typing l started a local login command")
	}

	m = expiredCodexModel()
	updated, _ = m.Update(keyRune('l'))
	m = updated.(Model)
	if got := m.composer.Value(); got != "l" || m.localCancel != nil {
		t.Fatalf("leading l was not ordinary composer input: value=%q localCancel=%v", got, m.localCancel != nil)
	}
}

func TestPT087CodexLoginShortcutIsExplicitAndDeduplicated(t *testing.T) {
	m := expiredCodexModel()
	updated, command := m.Update(tea.KeyMsg{Type: tea.KeyCtrlL})
	m = updated.(Model)
	if command == nil || m.localCancel == nil {
		t.Fatal("ctrl+l did not start browser login")
	}
	m.composer.input.SetValue("draft")
	updated, duplicate := m.Update(tea.KeyMsg{Type: tea.KeyCtrlL})
	m = updated.(Model)
	if duplicate != nil || m.localCancel == nil || m.composer.Value() != "draft" {
		t.Fatal("ctrl+l started a duplicate login while one was in flight")
	}
	m.localCancel()
}

func TestPT087SuccessfulCodexLoginUpdatesLocalProviderStatus(t *testing.T) {
	m := expiredCodexModel()
	updated, _ := m.Update(localResultMsg{Command: "harness auth login openai --method browser", Code: 0})
	m = updated.(Model)
	if m.providerStatus != "active" {
		t.Fatalf("provider status after successful local login = %q, want active", m.providerStatus)
	}
	if m.lastAction != nil {
		t.Fatal("successful login should not leave a retryable local action")
	}
	updated, _ = m.Update(keyRune('r'))
	m = updated.(Model)
	if m.localCancel != nil || m.composer.Value() != "r" {
		t.Fatalf("r after successful login was not ordinary composer input: localCancel=%v composer=%q", m.localCancel != nil, m.composer.Value())
	}
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyCtrlL})
	m = updated.(Model)
	if m.localCancel != nil || m.composer.Value() != "r" {
		t.Fatalf("ctrl+l changed input or restarted active Codex auth: localCancel=%v composer=%q", m.localCancel != nil, m.composer.Value())
	}
}

func TestPT087FailedCodexLoginRemainsRetryable(t *testing.T) {
	m := expiredCodexModel()
	updated, _ := m.Update(localResultMsg{Command: "harness auth login openai --method browser", Code: 1})
	m = updated.(Model)
	if m.providerStatus == "active" || m.lastAction == nil || m.lastAction.RetryFunc == nil {
		t.Fatal("failed login should retain expired status and remain retryable")
	}
}

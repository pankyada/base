package ui

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"harness-tui/internal/prefs"
)

func TestMentionIndexRunsAsCommandAndSkipsIgnoredDirs(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"src/login.go", ".git/config"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	cmd := mentionIndexCmd("@src/l", root)
	msg, ok := cmd().(mentionIndexMsg)
	if !ok || len(msg.Matches) != 1 || msg.Matches[0] != "@src/login.go" {
		t.Fatalf("mention result=%#v", msg)
	}
	if strings.Contains(strings.Join(msg.Matches, " "), ".git") {
		t.Fatal("ignored path indexed")
	}
}

func TestMentionIndexRespectsGitignore(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("*.log\nbuild/\nsecret.txt\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "build"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"keep.go", "debug.log", "secret.txt", "build/output.bin"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	entries := buildMentionIndex(root, 20_000)
	joined := strings.Join(entries, " ")
	if !strings.Contains(joined, "keep.go") || strings.Contains(joined, "debug.log") || strings.Contains(joined, "secret.txt") || strings.Contains(joined, "build/") {
		t.Fatalf("gitignored entries leaked: %v", entries)
	}
}

func TestLocalCommandCanBeInterrupted(t *testing.T) {
	cmd, cancel := runLocalCommand("sleep 30", ".")
	cancel()
	result, ok := cmd().(localResultMsg)
	if !ok || result.Code != 130 {
		t.Fatalf("local result=%#v", result)
	}
}

func TestCompletionOwnsTabAndAcceptsWithoutOpeningOverlay(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "coding", "tester", prefs.Preferences{})
	m.composer.input.SetValue("/th")
	m.recomputeCompletion()
	m.reflow()
	if !m.completion.Open || !m.keys.AcceptCompletion.Enabled() || m.keys.Overlay.Enabled() {
		t.Fatalf("completion key ownership missing: open=%v accept=%v overlay=%v", m.completion.Open, m.keys.AcceptCompletion.Enabled(), m.keys.Overlay.Enabled())
	}
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyTab})
	m = updated.(Model)
	if m.composer.Value() != "/theme" || m.completion.Open || m.overlayOpen {
		t.Fatalf("tab completion value=%q completion=%v overlay=%v", m.composer.Value(), m.completion.Open, m.overlayOpen)
	}
}

func TestCompletionRecomputesWhileTypingSlashQuery(t *testing.T) {
	m := NewModel(&recordingSender{}, "coding", "tester", prefs.Preferences{})
	for _, r := range []rune{'/', 't', 'h'} {
		updated, _ := m.Update(press(r))
		m = updated.(Model)
	}
	if m.composer.Value() != "/th" || !m.completion.Open || len(m.completion.Items) != 1 || m.completion.Items[0].Label != "/theme" {
		t.Fatalf("typed completion value=%q open=%v items=%#v", m.composer.Value(), m.completion.Open, m.completion.Items)
	}
}

func TestCompletionEnterAcceptsAndEscDismisses(t *testing.T) {
	m := NewModel(&recordingSender{}, "coding", "tester", prefs.Preferences{})
	m.composer.input.SetValue("/th")
	m.recomputeCompletion()
	m.reflow()
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = updated.(Model)
	if m.composer.Value() != "/theme" || m.running {
		t.Fatalf("enter completion value=%q running=%v", m.composer.Value(), m.running)
	}
	m.composer.input.SetValue("/mo")
	m.recomputeCompletion()
	m.reflow()
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyEscape})
	m = updated.(Model)
	if m.completion.Open || m.keys.AcceptCompletion.Enabled() {
		t.Fatal("esc should dismiss popup without clearing composer")
	}
}

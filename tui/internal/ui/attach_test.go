package ui

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"harness-tui/internal/prefs"
)

func TestParseDroppedPathsHandlesQuotingAndEscaping(t *testing.T) {
	dir := t.TempDir()
	plain := filepath.Join(dir, "notes.txt")
	spaced := filepath.Join(dir, "my report.md")
	os.WriteFile(plain, []byte("hi"), 0o644)
	os.WriteFile(spaced, []byte("hi"), 0o644)

	cases := []struct {
		name  string
		input string
		want  string
	}{
		{"plain", plain, plain},
		{"single-quoted", "'" + spaced + "'", spaced},
		{"double-quoted", `"` + spaced + `"`, spaced},
		{"backslash-escaped", strings.ReplaceAll(spaced, " ", `\ `), spaced},
		{"file-uri", "file://" + strings.ReplaceAll(spaced, " ", "%20"), spaced},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := parseDroppedPaths(c.input)
			if len(got) != 1 || got[0].path != c.want {
				t.Fatalf("parseDroppedPaths(%q) = %#v, want path %q", c.input, got, c.want)
			}
		})
	}
}

func TestParseDroppedPathsIgnoresProseAndMissingFiles(t *testing.T) {
	if got := parseDroppedPaths("just talking about deploying to /nonexistent/path today"); len(got) != 0 {
		t.Fatalf("prose containing an absolute-looking token should not attach: %#v", got)
	}
	if got := parseDroppedPaths("check the read me and package json please"); len(got) != 0 {
		t.Fatalf("bare words should never attach: %#v", got)
	}
}

func TestParseDroppedPathsIgnoresDirectories(t *testing.T) {
	dir := t.TempDir()
	if got := parseDroppedPaths(dir); len(got) != 0 {
		t.Fatalf("a directory drop should be ignored, got %#v", got)
	}
}

func TestAttachmentsBlockInlinesTextAndReferencesBinary(t *testing.T) {
	dir := t.TempDir()
	textPath := filepath.Join(dir, "a.go")
	os.WriteFile(textPath, []byte("package main\n"), 0o644)
	binaryPath := filepath.Join(dir, "img.bin")
	os.WriteFile(binaryPath, []byte{0, 1, 2, 3}, 0o644)

	text := newAttachment(textPath, dir)
	binary := newAttachment(binaryPath, dir)
	if text.Binary {
		t.Fatal("go source misclassified as binary")
	}
	if !binary.Binary {
		t.Fatal("NUL-containing file not classified as binary")
	}

	block := attachmentsBlock([]Attachment{text, binary})
	if !strings.Contains(block, "```go") || !strings.Contains(block, "package main") {
		t.Fatalf("text attachment not inlined: %s", block)
	}
	if !strings.Contains(block, "binary") || strings.Contains(block, "\x00") {
		t.Fatalf("binary attachment should be referenced, not inlined: %q", block)
	}
}

func TestAttachmentsBlockReferencesOversizedFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "big.txt")
	os.WriteFile(path, []byte(strings.Repeat("filler text\n", maxAttachmentBytes/12+1)), 0o644)
	block := attachmentsBlock([]Attachment{newAttachment(path, dir)})
	if !strings.Contains(block, "too large to inline") {
		t.Fatalf("oversized file should be referenced not inlined: %s", block)
	}
}

func TestComposerDropAttachesFileAndStripsPathFromInput(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "notes.txt")
	os.WriteFile(path, []byte("hello"), 0o644)

	m := NewModel(&recordingSender{}, "devops", "tester", prefs.Preferences{})
	m.workingDir = dir
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(path), Paste: true})
	m = updated.(Model)

	if len(m.attachments) != 1 || m.attachments[0].Path != path {
		t.Fatalf("attachments = %#v", m.attachments)
	}
	if strings.Contains(m.composer.Value(), path) {
		t.Fatalf("dropped path should be removed from composer text, got %q", m.composer.Value())
	}
}

func TestComposerDropDoesNotConsumeOrdinaryTyping(t *testing.T) {
	m := NewModel(&recordingSender{}, "devops", "tester", prefs.Preferences{})
	for _, r := range "fix the bug in main" {
		updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
		m = updated.(Model)
	}
	if len(m.attachments) != 0 {
		t.Fatalf("ordinary typing should never attach: %#v", m.attachments)
	}
	if m.composer.Value() != "fix the bug in main" {
		t.Fatalf("composer value corrupted: %q", m.composer.Value())
	}
}

// This is the regression that shipped: mentioning a real project file by
// path is one of the most common things to type to a coding agent, and it
// must never be treated as a drop — pasted or not — unless the message is
// nothing but the path(s).
func TestMentioningARealFileInAMessageIsNeverConsumed(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "src", "loop"), 0o755)
	real := filepath.Join(dir, "src", "loop", "agent-loop.ts")
	os.WriteFile(real, []byte("export {}"), 0o644)

	m := NewModel(&recordingSender{}, "devops", "tester", prefs.Preferences{})
	m.workingDir = dir
	message := "let's look at src/loop/agent-loop.ts for the bug"

	// Typed one rune at a time, as a real keyboard does — never a paste.
	for _, r := range message {
		updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
		m = updated.(Model)
	}
	if len(m.attachments) != 0 {
		t.Fatalf("typing a message that mentions a real path must not attach it: %#v", m.attachments)
	}
	if m.composer.Value() != message {
		t.Fatalf("composer value corrupted: got %q, want %q", m.composer.Value(), message)
	}

	// Even pasted, prose mixed with a path is not a drop — only an
	// all-paths paste should attach.
	m.composer.Reset()
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(message), Paste: true})
	m = updated.(Model)
	if len(m.attachments) != 0 {
		t.Fatalf("pasting prose that merely mentions a path must not attach it: %#v", m.attachments)
	}
	if m.composer.Value() != message {
		t.Fatalf("pasted composer value corrupted: got %q, want %q", m.composer.Value(), message)
	}
}

func TestSubmitInlinesAttachmentsAndClearsThem(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "notes.txt")
	os.WriteFile(path, []byte("secret plan"), 0o644)

	sender := &recordingSender{}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.workingDir = dir
	m.attachments = []Attachment{newAttachment(path, dir)}
	m.composer.input.SetValue("look at this")
	m.submit()

	if len(m.attachments) != 0 {
		t.Fatal("attachments should clear after send")
	}
	if len(m.transcript.Turns) == 0 || !strings.Contains(m.transcript.Turns[0].Text, "notes.txt") {
		t.Fatalf("bubble should reference the attachment: %#v", m.transcript.Turns)
	}
	if len(sender.messages) != 1 {
		t.Fatalf("expected one sent message, got %d", len(sender.messages))
	}
}

func TestTypingGAndQuestionMarkDoesNotDropCharacters(t *testing.T) {
	m := NewModel(&recordingSender{}, "devops", "tester", prefs.Preferences{})
	for _, r := range "great, what's going on?" {
		updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
		m = updated.(Model)
	}
	if got := m.composer.Value(); got != "great, what's going on?" {
		t.Fatalf("composer value = %q, want %q", got, "great, what's going on?")
	}
	if m.helpOpen {
		t.Fatal("typing '?' mid-message should not open help")
	}
}

func TestQuestionMarkTypesLiterallyAndSlashQuestionOpensHelp(t *testing.T) {
	m := NewModel(&recordingSender{}, "devops", "tester", prefs.Preferences{})
	// '?' is a real character in ordinary messages ("what does this do?"), so
	// even on an empty composer it must type, never hijack into a shortcut.
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'?'}})
	m = updated.(Model)
	if m.helpOpen {
		t.Fatal("'?' should type literally, not open help")
	}
	if m.composer.Value() != "?" {
		t.Fatalf("composer = %q, want literal '?'", m.composer.Value())
	}
	if _, handled := m.handleSlash("/?"); !handled {
		t.Fatal("/? should be handled as a slash command")
	}
	if !m.helpOpen {
		t.Fatal("/? should open the keys popup")
	}
}

func TestCtrlRClearsAttachments(t *testing.T) {
	m := NewModel(&recordingSender{}, "devops", "tester", prefs.Preferences{})
	m.attachments = []Attachment{{Path: "/tmp/x.txt", Display: "x.txt"}}
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlR})
	m = updated.(Model)
	if len(m.attachments) != 0 {
		t.Fatal("ctrl+r should clear attachments")
	}
}

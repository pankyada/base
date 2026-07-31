package ui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"harness-tui/internal/prefs"
)

func layoutModel(t *testing.T, width, height int, rail bool) Model {
	t.Helper()
	m := NewModel(&recordingSender{}, "coding", "tester", prefs.Preferences{})
	m.railVisible = rail
	updated, _ := m.Update(tea.WindowSizeMsg{Width: width, Height: height})
	return updated.(Model)
}

func TestRailIsPinnedBesideTheTranscriptOnly(t *testing.T) {
	m := layoutModel(t, 120, 40, true)
	view := stripANSI(m.View())
	lines := strings.Split(view, "\n")

	// The rail's left border sits at a fixed column, and only on the rows the
	// transcript occupies — the bars and composer above and below run the
	// full width underneath it.
	borderColumn := m.width - railWidth
	hasBorder := func(line string) bool {
		runes := []rune(line)
		return len(runes) > borderColumn && runes[borderColumn] == '│'
	}
	topBarHeight := 1
	for row, line := range lines {
		inTranscript := row >= topBarHeight && row < topBarHeight+m.viewport.Height
		if inTranscript && !hasBorder(line) {
			t.Fatalf("transcript row %d has no rail border:\n%q", row, line)
		}
		if !inTranscript && hasBorder(line) {
			t.Fatalf("row %d is outside the transcript but carries the rail:\n%q", row, line)
		}
	}
	if got := lipgloss.Height(m.railBlock); got != m.viewport.Height {
		t.Fatalf("rail block height %d != viewport height %d", got, m.viewport.Height)
	}
}

func TestRailWidthDoesNotChangeWithTranscriptContent(t *testing.T) {
	m := layoutModel(t, 120, 40, true)
	before := lipgloss.Width(m.railBlock)

	m.transcript.Turns = append(m.transcript.Turns,
		Turn{Role: "user", Text: strings.Repeat("a very long user message ", 40), Time: "10:00"},
		Turn{Role: "agent", Text: strings.Repeat("agent reply ", 200), Time: "10:00", Elapsed: "1.0s"},
	)
	m.reflow()

	if after := lipgloss.Width(m.railBlock); after != before || after != railWidth {
		t.Fatalf("rail width moved with content: %d → %d (want %d)", before, after, railWidth)
	}
	if lipgloss.Height(m.railBlock) != m.viewport.Height {
		t.Fatal("rail height must track the transcript viewport, not its content")
	}
}

func TestNarrowTerminalDropsTheRailEntirely(t *testing.T) {
	m := layoutModel(t, 80, 30, true)
	if m.railShown() || m.railBlock != "" || m.railHits != nil {
		t.Fatal("the rail needs 100 columns; below that it must not render or take clicks")
	}
	if m.contentWidth() >= m.width {
		t.Fatal("the scrollbar gutter still comes out of the content width")
	}
}

func TestComposerSpansFullWidthEvenWithTheRailOpen(t *testing.T) {
	m := layoutModel(t, 120, 40, true)
	view := m.View()
	lines := strings.Split(stripANSI(view), "\n")
	// The status bar is the last line and is not part of the rail column.
	last := lines[len(lines)-1]
	if strings.Contains(last, "│") {
		t.Fatalf("status bar should run under the rail, got %q", last)
	}
}

func TestScrollbarOnlyAppearsWhenThereIsMoreBelow(t *testing.T) {
	if got := stripANSI(scrollbarView(5, 5, 5, 0)); strings.TrimSpace(got) != "" {
		t.Fatalf("content that fits needs no scrollbar, got %q", got)
	}
	bar := stripANSI(scrollbarView(10, 10, 100, 0))
	if !strings.Contains(bar, "│") || !strings.Contains(bar, "╎") {
		t.Fatalf("expected a thumb and a track, got %q", bar)
	}
	if lipgloss.Height(bar) != 10 {
		t.Fatalf("scrollbar height = %d, want 10", lipgloss.Height(bar))
	}
	lines := strings.Split(bar, "\n")
	if !strings.Contains(lines[0], "│") {
		t.Fatal("at the top of the scrollback the thumb sits at the top")
	}
	bottom := strings.Split(stripANSI(scrollbarView(10, 10, 100, 90)), "\n")
	if !strings.Contains(bottom[len(bottom)-1], "│") {
		t.Fatal("at the bottom the thumb sits at the bottom")
	}
}

func TestScrollHintOnlyShowsWhileScrolledBack(t *testing.T) {
	if scrollHint(true, 10, 100, 0, 80) != "" {
		t.Fatal("following the tail needs no hint")
	}
	if scrollHint(false, 10, 8, 0, 80) != "" {
		t.Fatal("content that fits needs no hint")
	}
	hint := stripANSI(scrollHint(false, 10, 100, 40, 80))
	if !strings.Contains(hint, "50") || !strings.Contains(hint, "end") {
		t.Fatalf("hint should say how far back and how to return, got %q", hint)
	}
}

func TestEmptyTranscriptShowsTheProjectHero(t *testing.T) {
	m := layoutModel(t, 120, 40, true)
	m.workingDir = "/tmp/demo-project"
	m.git = GitState{Checked: true, Repo: true, Branch: "main", Unstaged: 2}
	m.tasks = []Task{{ID: "dev", Label: "dev", Command: "pnpm dev", Kind: "serve"}}
	m.reflow()

	view := stripANSI(m.View())
	for _, want := range []string{"demo-project", "main", "dev", "rail"} {
		if !strings.Contains(view, want) {
			t.Fatalf("hero missing %q:\n%s", want, view)
		}
	}
}

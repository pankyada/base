package ui

import (
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/lipgloss"
)

func TestBarsFitNarrowWidths(t *testing.T) {
	for _, width := range []int{10, 20, 40, 80} {
		if got := lipgloss.Width(topBar("devops", "123456789", true, true, 0, time.Now(), width)); got > width {
			t.Errorf("top bar width = %d, want <= %d", got, width)
		}
		if got := lipgloss.Width(statusBar(true, "claude-3-5-sonnet", "danger", 123, 456, 0.0123, 1000, 10000, 1, width, 0)); got > width {
			t.Errorf("status bar width = %d, want <= %d", got, width)
		}
	}
}

func TestStatusBadgeShowsUnambiguousState(t *testing.T) {
	ready := stripANSI(statusBadge(false, 0))
	if !strings.Contains(ready, "READY") {
		t.Fatalf("idle badge should say READY: %q", ready)
	}
	running := stripANSI(statusBadge(true, 0))
	if !strings.Contains(running, "RUNNING") {
		t.Fatalf("active badge should say RUNNING: %q", running)
	}
}

func TestStatusBadgeAnimatesWhileRunning(t *testing.T) {
	frames := make(map[string]bool)
	for frame := 0; frame < 12; frame++ {
		frames[statusBadge(true, frame)] = true
	}
	if len(frames) < 2 {
		t.Fatal("running badge should change appearance across frames (spinner + pulse)")
	}
}

func TestStatusBadgeIsStableWhenReady(t *testing.T) {
	first := statusBadge(false, 0)
	for frame := 1; frame < 8; frame++ {
		if statusBadge(false, frame) != first {
			t.Fatalf("ready badge should not flicker across frames")
		}
	}
}

func TestTopBarShowsStatusAndStaysWithinWidth(t *testing.T) {
	for _, width := range []int{20, 40, 80, 120} {
		for _, running := range []bool{true, false} {
			out := topBar("devops", "sess-123456789", true, running, 0, time.Now(), width)
			if got := lipgloss.Width(out); got > width {
				t.Fatalf("top bar width = %d, want <= %d (running=%v)", got, width, running)
			}
		}
	}
	wide := stripANSI(topBar("devops", "sess-1", true, true, 0, time.Now(), 120))
	if !strings.Contains(wide, "RUNNING") {
		t.Fatalf("top bar should surface running status when there's room: %s", wide)
	}
}

func TestUserBubbleRightAlignedAndReadable(t *testing.T) {
	const width = 80
	text := userBubble(Turn{Role: "user", Text: "hello", Time: "12:34"}, width)
	if lipgloss.Width(text) != width {
		t.Fatalf("bubble width = %d, want %d", lipgloss.Width(text), width)
	}
	if !containsPlain(text, "hello") {
		t.Fatal("bubble missing user text")
	}
}

func containsPlain(text, want string) bool {
	return len(text) > 0 && strings.Contains(stripANSI(text), want)
}

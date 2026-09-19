package ui

import (
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/lipgloss"
	"harness-tui/internal/protocol"
)

func TestBarsFitNarrowWidths(t *testing.T) {
	for _, width := range []int{10, 20, 40, 80} {
		if got := lipgloss.Width(topBar("devops", "123456789", true, "", time.Now(), width)); got > width {
			t.Errorf("top bar width = %d, want <= %d", got, width)
		}
		if got := lipgloss.Width(statusBar(true, "claude-3-5-sonnet", "provider: OpenAI-compatible API", "danger", 123, 456, 0.0123, 1000, 10000, 1, width, 0)); got > width {
			t.Errorf("status bar width = %d, want <= %d", got, width)
		}
	}
}

func TestUsageLabelShowsBillingBasis(t *testing.T) {
	if got := usageLabel(protocol.Usage{BillingMode: "subscription", CostBasis: "api_equivalent"}); got != "Codex · API-equivalent est." {
		t.Fatalf("subscription label = %q", got)
	}
	if got := usageLabel(protocol.Usage{BillingMode: "api", CostBasis: "api_estimate"}); got != "API est." {
		t.Fatalf("api label = %q", got)
	}
	if got := usageLabel(protocol.Usage{BillingMode: "mixed", CostBasis: "mixed"}); got != "Mixed est." {
		t.Fatalf("mixed label = %q", got)
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

func TestTopBarShowsIdentityAndStaysWithinWidth(t *testing.T) {
	for _, width := range []int{20, 40, 80, 120} {
		out := topBar("devops", "sess-123456789", true, "", time.Now(), width)
		if got := lipgloss.Width(out); got > width {
			t.Fatalf("top bar width = %d, want <= %d", got, width)
		}
	}
	wide := stripANSI(topBar("devops", "sess-1", true, "", time.Now(), 120))
	for _, want := range []string{"harness", "devops", "sess-1", "online"} {
		if !strings.Contains(wide, want) {
			t.Fatalf("top bar should carry identity %q: %s", want, wide)
		}
	}
	// Run state belongs to the status bar alone — rendering the badge in both
	// bars just asks the user which one to believe.
	for _, unwanted := range []string{"RUNNING", "READY"} {
		if strings.Contains(wide, unwanted) {
			t.Fatalf("top bar should not duplicate run status %q: %s", unwanted, wide)
		}
	}
}

func TestTopBarShowsBranchOnlyWhenProvided(t *testing.T) {
	withBranch := stripANSI(topBar("devops", "sess-1", true, "feature/palette", time.Now(), 120))
	if !strings.Contains(withBranch, "feature/palette") {
		t.Fatalf("top bar missing branch: %s", withBranch)
	}
	withoutBranch := stripANSI(topBar("devops", "sess-1", true, "", time.Now(), 120))
	if strings.Contains(withoutBranch, "feature/palette") {
		t.Fatalf("top bar rendered branch without repo: %s", withoutBranch)
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

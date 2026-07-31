package ui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"harness-tui/internal/protocol"
)

func testRail(in RailInput) RailInput {
	if in.Height == 0 {
		in.Height = 60
	}
	return in
}

func TestRailHasDistinctLabeledSections(t *testing.T) {
	rendered, _ := railView(testRail(RailInput{
		Profile: "coding", Model: "gpt-4o", Approval: "danger", Session: "sess-12345",
		Running: true, ActiveTool: "Bash", ActiveElapsed: "1.2s",
		Todos:         []protocol.TodoItem{{Content: "write tests", Status: "in_progress"}},
		Artifacts:     []protocol.Artifact{{Icon: "📊", Title: "coverage"}},
		ContextTokens: 1000, ContextWindow: 10000,
		Git: GitState{Checked: true, Repo: true, Branch: "main"},
	}))
	out := stripANSI(rendered)

	order := []string{"ACTIVE", "TASKS", "GIT", "TODOS", "CONTEXT", "SESSION", "ARTIFACTS"}
	previous := -1
	for _, label := range order {
		index := strings.Index(out, label)
		if index < 0 {
			t.Fatalf("rail missing %q section header:\n%s", label, out)
		}
		if index < previous {
			t.Fatalf("section %q is out of order:\n%s", label, out)
		}
		previous = index
	}
}

func TestRailShowsCountsAndContent(t *testing.T) {
	rendered, _ := railView(testRail(RailInput{
		Profile: "coding", Model: "gpt-4o", Approval: "danger", Session: "sess-1",
		Todos:         []protocol.TodoItem{{Content: "a", Status: "completed"}, {Content: "b", Status: "pending"}},
		ContextWindow: 10000,
	}))
	out := stripANSI(rendered)
	for _, want := range []string{"TODOS 2", "ARTIFACTS 0", "none yet", "○ idle"} {
		if !strings.Contains(out, want) {
			t.Fatalf("expected %q in rail:\n%s", want, out)
		}
	}
}

func TestRailIsExactlyRequestedHeightAndWidth(t *testing.T) {
	for _, height := range []int{6, 20, 45} {
		rendered, _ := railView(testRail(RailInput{
			Profile: "coding", Model: "claude-sonnet-5", Approval: "strict", Session: "sess-1",
			Running: true, ActiveTool: "a-very-long-tool-name-indeed", ActiveElapsed: "12.3s",
			ContextTokens: 500, ContextWindow: 5000,
			Git:    GitState{Checked: true, Repo: true, Branch: "a-very-long-branch-name-here"},
			Tasks:  []Task{{ID: "dev", Label: "dev", Command: "pnpm dev", Kind: "serve"}},
			Height: height,
		}))
		if got := lipgloss.Height(rendered); got != height {
			t.Fatalf("rail height = %d, want %d", got, height)
		}
		for _, line := range strings.Split(rendered, "\n") {
			if w := lipgloss.Width(line); w > railWidth {
				t.Fatalf("rail line exceeds %d columns (got %d): %q", railWidth, w, line)
			}
		}
	}
}

func TestRailGitSectionReportsBranchAndCounts(t *testing.T) {
	rendered, _ := railView(testRail(RailInput{
		Git: GitState{Checked: true, Repo: true, Branch: "main", Upstream: "origin/main", Ahead: 2, Behind: 1, Staged: 3, Unstaged: 1, Untracked: 4},
	}))
	out := stripANSI(rendered)
	for _, want := range []string{"main", "↑2", "↓1", "3 staged", "1 changed", "4 new", "[stage]", "[commit]", "[push]"} {
		if !strings.Contains(out, want) {
			t.Fatalf("expected %q in git section:\n%s", want, out)
		}
	}
}

func TestRailGitSectionHandlesNonRepository(t *testing.T) {
	rendered, hits := railView(testRail(RailInput{Git: GitState{Checked: true}}))
	if !strings.Contains(stripANSI(rendered), "not a git repository") {
		t.Fatalf("expected non-repo message:\n%s", rendered)
	}
	for _, hit := range hits {
		if strings.HasPrefix(hit.Action, "git:") {
			t.Fatalf("non-repo rail must not offer git buttons, got %q", hit.Action)
		}
	}
}

func TestRailArmedGitActionIsMarked(t *testing.T) {
	rendered, _ := railView(testRail(RailInput{
		Git: GitState{Checked: true, Repo: true, Branch: "main"}, GitConfirm: "push",
	}))
	if !strings.Contains(stripANSI(rendered), "[push?]") {
		t.Fatalf("armed push should render as [push?]:\n%s", rendered)
	}
}

func TestRailTaskRowsAreClickable(t *testing.T) {
	tasks := []Task{
		{ID: "dev", Label: "dev", Command: "pnpm dev", Kind: "serve"},
		{ID: "build", Label: "build", Command: "pnpm build", Kind: "build"},
	}
	rendered, hits := railView(testRail(RailInput{
		Tasks:     tasks,
		TaskState: map[string]TaskStatus{"dev": {Running: true, Elapsed: "4s"}},
	}))
	out := stripANSI(rendered)
	if !strings.Contains(out, "dev") || !strings.Contains(out, "build") {
		t.Fatalf("task labels missing:\n%s", out)
	}
	if !strings.Contains(out, "stop") {
		t.Fatalf("a running task should offer to stop:\n%s", out)
	}
	actions := map[string]bool{}
	for _, hit := range hits {
		actions[hit.Action] = true
	}
	for _, want := range []string{"task:dev", "task:build", "tasks:detect", "tasks:edit", "tasks:ask"} {
		if !actions[want] {
			t.Fatalf("missing rail action %q in %v", want, actions)
		}
	}
}

func TestRailHitsPointAtTheRowTheyRender(t *testing.T) {
	rendered, hits := railView(testRail(RailInput{
		Git:   GitState{Checked: true, Repo: true, Branch: "main", Unstaged: 1},
		Tasks: []Task{{ID: "build", Label: "build", Command: "make", Kind: "build"}},
	}))
	lines := strings.Split(stripANSI(rendered), "\n")
	for _, hit := range hits {
		if hit.Y < 0 || hit.Y >= len(lines) {
			t.Fatalf("hit %q at row %d is outside the %d-line rail", hit.Action, hit.Y, len(lines))
		}
		// Rail content starts after the border and two padding cells.
		row := lines[hit.Y]
		if len(strings.TrimSpace(row)) == 0 {
			t.Fatalf("hit %q points at a blank row %d:\n%s", hit.Action, hit.Y, rendered)
		}
	}
}

func TestRailDropsLowPrioritySectionsWhenShort(t *testing.T) {
	rendered, hits := railView(RailInput{
		Height: 12,
		Git:    GitState{Checked: true, Repo: true, Branch: "main", Unstaged: 2},
		Tasks:  []Task{{ID: "dev", Label: "dev", Command: "pnpm dev", Kind: "serve"}},
	})
	out := stripANSI(rendered)
	if !strings.Contains(out, "TASKS") || !strings.Contains(out, "ACTIVE") {
		t.Fatalf("a short rail must keep its highest-priority sections:\n%s", out)
	}
	if lipgloss.Height(rendered) != 12 {
		t.Fatalf("short rail height = %d, want 12", lipgloss.Height(rendered))
	}
	lines := strings.Split(out, "\n")
	for _, hit := range hits {
		if hit.Y >= len(lines) {
			t.Fatalf("clipped rail kept a hit at row %d beyond %d lines", hit.Y, len(lines))
		}
	}
}

func TestSectionHeaderNeverPanicsOnTinyWidth(t *testing.T) {
	for _, width := range []int{-5, 0, 1, 3} {
		sectionHeader("session", width)
	}
}

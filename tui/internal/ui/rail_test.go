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
		Running: true, ActiveTool: "Bash", ActiveElapsed: "1.2s",
		Todos:         []protocol.TodoItem{{Content: "write tests", Status: "in_progress"}},
		Artifacts:     []protocol.Artifact{{Icon: "📊", Title: "coverage"}},
		ContextTokens: 1000, ContextWindow: 10000,
		Git: GitState{Checked: true, Repo: true, Branch: "main"},
	}))
	out := stripANSI(rendered)

	// Three bands: what the agent is doing, what you can drive, what the
	// session produced.
	order := []string{"ACTIVE", "TODOS", "TASKS", "GIT", "CONTEXT", "ARTIFACTS"}
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
		Todos:         []protocol.TodoItem{{Content: "a", Status: "completed"}, {Content: "b", Status: "pending"}},
		ContextTokens: 10, ContextWindow: 10000,
	}))
	out := stripANSI(rendered)
	if !strings.Contains(out, "TODOS 2") {
		t.Fatalf("expected populated todos section:\n%s", out)
	}
}

// A section with nothing to say must not render at all — empty placeholders
// crowd real controls off a fixed-height panel.
func TestRailOmitsEmptySections(t *testing.T) {
	rendered, _ := railView(testRail(RailInput{
		Git: GitState{Checked: true, Repo: true, Branch: "main"},
	}))
	out := stripANSI(rendered)
	for _, unwanted := range []string{"TODOS", "ARTIFACTS", "CONTEXT", "ACTIVE", "SESSION", "none yet", "idle"} {
		if strings.Contains(out, unwanted) {
			t.Fatalf("idle rail should not render %q:\n%s", unwanted, out)
		}
	}
}

// Profile, model, trust and session id live in the topbar and status bar; a
// rail copy would be a third render of the same four facts.
func TestRailDoesNotRepeatSessionIdentity(t *testing.T) {
	rendered, _ := railView(testRail(RailInput{
		Git: GitState{Checked: true, Repo: true, Branch: "main"},
	}))
	if strings.Contains(stripANSI(rendered), "SESSION") {
		t.Fatalf("rail must not duplicate session identity:\n%s", rendered)
	}
}

func TestRailIsExactlyRequestedHeightAndWidth(t *testing.T) {
	for _, height := range []int{6, 20, 45} {
		rendered, _ := railView(testRail(RailInput{
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
	// Task rows are the primary action, so the config chips start folded.
	for _, want := range []string{"task:dev", "task:build", "fold:tasks"} {
		if !actions[want] {
			t.Fatalf("missing rail action %q in %v", want, actions)
		}
	}
	if actions["tasks:detect"] {
		t.Fatalf("folded task chips should not be clickable: %v", actions)
	}
}

// Secondary actions hide behind a fold row so the primary path stays one
// click away, and appear once that row is expanded.
func TestRailFoldRevealsSecondaryActions(t *testing.T) {
	in := RailInput{
		Height: 60,
		Git:    GitState{Checked: true, Repo: true, Branch: "main", Unstaged: 1},
		Tasks:  []Task{{ID: "dev", Label: "dev", Command: "pnpm dev", Kind: "serve"}},
	}
	collapsed, collapsedHits := railView(in)
	if strings.Contains(stripANSI(collapsed), "[diff]") {
		t.Fatalf("secondary git actions should start folded:\n%s", collapsed)
	}
	if !strings.Contains(stripANSI(collapsed), "[stage]") {
		t.Fatalf("primary git actions must stay inline:\n%s", collapsed)
	}
	foldable := map[string]bool{}
	for _, hit := range collapsedHits {
		foldable[hit.Action] = true
	}
	if !foldable["fold:git"] || !foldable["fold:tasks"] {
		t.Fatalf("expected fold rows for git and tasks: %v", foldable)
	}

	in.Expanded = map[string]bool{"git": true, "tasks": true}
	expanded, expandedHits := railView(in)
	out := stripANSI(expanded)
	for _, want := range []string{"[diff]", "[log]", "[pull]", "[detect]", "[edit]"} {
		if !strings.Contains(out, want) {
			t.Fatalf("expanded rail missing %q:\n%s", want, out)
		}
	}
	actions := map[string]bool{}
	for _, hit := range expandedHits {
		actions[hit.Action] = true
	}
	for _, want := range []string{"git:diff", "git:log", "tasks:detect", "tasks:edit", "tasks:ask"} {
		if !actions[want] {
			t.Fatalf("expanded rail missing action %q in %v", want, actions)
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
	if !strings.Contains(out, "TASKS") || !strings.Contains(out, "GIT") {
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

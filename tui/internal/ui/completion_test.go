package ui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
)

func TestCompletionRecomputeCombinesCommandsAndSkills(t *testing.T) {
	commands := []CompletionItem{
		{Label: "/theme", Detail: "pick a terminal theme", Insert: "/theme", Kind: CompletionCommand},
		{Label: "/tasks", Detail: "run project tasks", Insert: "/tasks", Kind: CompletionCommand},
	}
	skills := []CompletionItem{{Label: "/code-review", Detail: "review code", Insert: "/code-review", Kind: CompletionSkill}}
	var c Completion
	c.Recompute("/", commands, skills, nil)
	if !c.Open || len(c.Items) != 3 || c.Items[0].Label != "/tasks" || c.Items[2].Kind != CompletionSkill {
		t.Fatalf("completion = %#v", c)
	}

	c.Recompute("/ta", commands, skills, nil)
	if len(c.Items) != 1 || c.Items[0].Label != "/tasks" {
		t.Fatalf("filtered completion = %#v", c.Items)
	}
}

func TestCompletionCollisionKeepsEarlierCommand(t *testing.T) {
	var c Completion
	c.Recompute("/th", []CompletionItem{
		{Label: "/theme", Detail: "built-in", Insert: "/theme", Kind: CompletionCommand},
		{Label: "/theme", Detail: "custom", Insert: "/theme", Kind: CompletionCommand},
	}, nil, nil)
	if len(c.Items) != 1 || c.Items[0].Detail != "built-in" {
		t.Fatalf("collision completion = %#v", c.Items)
	}
}

func TestCompletionRecomputeMentionsUseActiveQuery(t *testing.T) {
	var c Completion
	c.Recompute("fix @a.go and @src/ma", nil, nil, []string{"src/main.go", "src/other.txt"})
	if !c.Open || len(c.Items) != 1 || c.Items[0].Label != "@src/main.go" {
		t.Fatalf("mention completion = %#v", c)
	}
	got, ok := c.Accept("fix @a.go and @src/ma")
	if !ok || got != "fix @a.go and @src/main.go" {
		t.Fatalf("accepted mention = %q, ok=%v", got, ok)
	}
}

func TestCompletionAcceptReplacesOnlyActiveToken(t *testing.T) {
	var c Completion
	commands := []CompletionItem{{Label: "/theme", Insert: "/theme", Kind: CompletionCommand}}
	c.Recompute("/th", commands, nil, nil)
	got, ok := c.Accept("/th")
	if !ok || got != "/theme" {
		t.Fatalf("accepted command = %q, ok=%v", got, ok)
	}

	c.Recompute("fix @a.go and @src/ma", nil, nil, []string{"src/main.go"})
	got, ok = c.Accept("fix @a.go and @src/ma")
	if !ok || got != "fix @a.go and @src/main.go" {
		t.Fatalf("accepted file = %q, ok=%v", got, ok)
	}
}

func TestCompletionMoveWrapsAndEmptyMoveNoops(t *testing.T) {
	var c Completion
	c.Items = []CompletionItem{{Label: "a"}, {Label: "b"}, {Label: "c"}}
	c.Open = true
	c.Move(-1)
	if c.Cursor != 2 {
		t.Fatalf("backward wrap cursor=%d", c.Cursor)
	}
	c.Move(4)
	if c.Cursor != 0 {
		t.Fatalf("forward wrap cursor=%d", c.Cursor)
	}
	var empty Completion
	empty.Move(1)
	if empty.Cursor != 0 || empty.Open {
		t.Fatalf("empty move changed completion=%#v", empty)
	}
}

func TestCompletionViewHasKindsWidthAndRowCap(t *testing.T) {
	items := make([]CompletionItem, 10)
	for i := range items {
		items[i] = CompletionItem{Label: "/command-with-a-long-name", Detail: "description", Kind: CompletionCommand}
	}
	items[1].Kind = CompletionSkill
	items[2].Kind = CompletionFile
	c := Completion{Open: true, Items: items, Cursor: 1}
	view := c.View(24)
	lines := strings.Split(view, "\n")
	if len(lines) != 8 {
		t.Fatalf("view rows=%d, want 8: %q", len(lines), view)
	}
	if !strings.Contains(stripANSI(view), "… 3 more") {
		t.Fatalf("view missing footer: %q", stripANSI(view))
	}
	for _, line := range lines {
		if lipgloss.Width(line) > 24 {
			t.Fatalf("view line width=%d: %q", lipgloss.Width(line), line)
		}
	}
	if completionColor(CompletionCommand) == completionColor(CompletionSkill) {
		t.Fatal("command and skill styles should differ")
	}
}

func TestCompletionZeroItemsClosed(t *testing.T) {
	var c Completion
	c.Recompute("/missing", []CompletionItem{{Label: "/theme"}}, nil, nil)
	if c.Open || c.View(20) != "" {
		t.Fatalf("empty completion = %#v", c)
	}
}

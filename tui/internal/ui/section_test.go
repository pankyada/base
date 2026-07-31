package ui

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/charmbracelet/lipgloss"
)

func TestSectionGlyphStates(t *testing.T) {
	s := Section{Name: "read", State: SectionRunning}
	if glyph := s.glyph(0); glyph == "" {
		t.Fatal("running glyph should be a spinner frame")
	}
	s.State = SectionDone
	if s.glyph(0) != "✓" {
		t.Fatalf("done glyph = %q", s.glyph(0))
	}
	s.State = SectionError
	if s.glyph(0) != "✗" {
		t.Fatalf("error glyph = %q", s.glyph(0))
	}
}

func TestCategorize(t *testing.T) {
	cases := []struct {
		name, wantCategory, wantLabel string
	}{
		{"Read", "files", "FILES"},
		{"Write", "files", "FILES"},
		{"Edit", "files", "FILES"},
		{"Glob", "files", "FILES"},
		{"Grep", "files", "FILES"},
		{"Bash", "exec", "EXEC"},
		{"ExecuteCode", "exec", "EXEC"},
		{"MemoryRead", "memory", "MEMORY"},
		{"MemoryWrite", "memory", "MEMORY"},
		{"Delegate", "agents", "AGENTS"},
		{"DelegateFanout", "agents", "AGENTS"},
		{"chrome__navigate", "mcp", "MCP · chrome"},
		{"github__create_pr", "mcp", "MCP · github"},
		{"Skill", "misc", "MISC"},
		{"TodoWrite", "misc", "MISC"},
		{"SomeUnknownTool", "misc", "MISC"},
	}
	for _, testCase := range cases {
		category, label := categorize(testCase.name)
		if category != testCase.wantCategory || label != testCase.wantLabel {
			t.Errorf("categorize(%q) = (%q, %q), want (%q, %q)", testCase.name, category, label, testCase.wantCategory, testCase.wantLabel)
		}
	}
}

func TestSectionColorUsesCategoryUnlessStateOverrides(t *testing.T) {
	section := Section{Name: "Read", Category: "files", State: SectionDone}
	if got := section.color().GetForeground(); got != ColPurple {
		t.Fatalf("done section color = %v, want files color %v", got, ColPurple)
	}
	section.State = SectionRunning
	if got := section.color().GetForeground(); got != ColAccent {
		t.Fatalf("running section color = %v, want accent %v", got, ColAccent)
	}
	section.State = SectionError
	if got := section.color().GetForeground(); got != ColDel {
		t.Fatalf("error section color = %v, want error %v", got, ColDel)
	}
	section.State = SectionDone
	if got := section.nameStyle().GetForeground(); got != ColPurple {
		t.Fatalf("done section name color = %v, want files color %v", got, ColPurple)
	}
	section.State = SectionRunning
	if got := section.nameStyle().GetForeground(); got != ColText {
		t.Fatalf("running section name color = %v, want text color %v", got, ColText)
	}
}

func TestSectionExpansionEasesOnlyWhenMotionEnabled(t *testing.T) {
	s := Section{State: SectionDone, Body: "one\ntwo\nthree", Motion: true, RevealAt: 0}
	first := stripANSI(s.Render(40, 0, true))
	if strings.Contains(first, "two") || !strings.Contains(first, "expanding") {
		t.Fatalf("first easing frame=%q", first)
	}
	full := stripANSI(s.Render(40, 3, true))
	if !strings.Contains(full, "three") {
		t.Fatalf("final easing frame=%q", full)
	}
	s.Motion = false
	static := stripANSI(s.Render(40, 0, true))
	if !strings.Contains(static, "three") {
		t.Fatalf("no-motion body=%q", static)
	}
}

func TestSectionToggle(t *testing.T) {
	s := Section{State: SectionDone, Body: "output"}
	if s.Expanded {
		t.Fatal("default collapsed")
	}
	s.Toggle()
	if !s.Expanded {
		t.Fatal("toggle should expand")
	}
	s.Toggle()
	if s.Expanded {
		t.Fatal("toggle should collapse")
	}
}

func TestSectionRenderWidthBudget(t *testing.T) {
	s := Section{
		Name:   "read",
		Arg:    "/very/long/path/to/some/file/that/is/quite/long.go",
		Metric: "(142 lines)",
		State:  SectionDone,
	}
	out := s.Render(40, 0, false)
	if w := lipgloss.Width(out); w > 40 {
		t.Fatalf("rendered width %d exceeds requested width 40", w)
	}
}

func TestSectionRenderUnicodeArg(t *testing.T) {
	s := Section{
		Name:  "read",
		Arg:   "café-report-with-a-very-long-name.pdf",
		State: SectionDone,
	}
	out := s.Render(30, 0, false)
	if !utf8.ValidString(out) {
		t.Fatal("rendered output contains invalid UTF-8 (likely a mid-rune truncation)")
	}
}

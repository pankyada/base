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
	soft := categorySoftColor("files")
	if got := section.color().GetForeground(); got != soft {
		t.Fatalf("done section color = %v, want soft files color %v", got, soft)
	}
	if soft == ColPurple {
		t.Fatal("soft category color should be muted against the full category color")
	}
	section.State = SectionRunning
	if got := section.color().GetForeground(); got != ColAccent {
		t.Fatalf("running section color = %v, want accent %v", got, ColAccent)
	}
	section.State = SectionError
	if got := section.color().GetForeground(); got != ColDel {
		t.Fatalf("error section color = %v, want error %v", got, ColDel)
	}
}

// The tool name is background information — the target beside it is the point —
// so it never outranks the arg except while a call is live or has failed.
func TestSectionNameStaysBehindItsTarget(t *testing.T) {
	section := Section{Name: "Read", Category: "files", State: SectionDone}
	if got := section.nameStyle().GetForeground(); got != ColFaint {
		t.Fatalf("done section name color = %v, want faint %v", got, ColFaint)
	}
	section.State = SectionRunning
	if got := section.nameStyle().GetForeground(); got != ColDim {
		t.Fatalf("running section name color = %v, want dim %v", got, ColDim)
	}
	section.State = SectionError
	if got := section.nameStyle().GetForeground(); got != ColDel {
		t.Fatalf("error section name color = %v, want error %v", got, ColDel)
	}
}

func TestSectionDisplayNameDropsMCPServerPrefix(t *testing.T) {
	if got := (Section{Name: "chrome__navigate"}).displayName(); got != "navigate" {
		t.Fatalf("displayName = %q, want %q", got, "navigate")
	}
	if got := (Section{Name: "Read"}).displayName(); got != "Read" {
		t.Fatalf("displayName = %q, want %q", got, "Read")
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

// Padding the arg column by rune count would push a double-width arg past the
// row's edge and wrap it.
func TestSectionRenderWideRuneArgStaysInBudget(t *testing.T) {
	s := Section{Name: "Read", Arg: "文档/报告.md", Metric: "3 lines", State: SectionDone}
	if width := lipgloss.Width(s.Render(60, 0, false)); width > 60 {
		t.Fatalf("rendered width %d exceeds requested width 60", width)
	}
}

// Truncating a path from the right would cut off the filename, which is the one
// part of the row the user is reading it for.
func TestFitArgKeepsPathBasename(t *testing.T) {
	got := fitArg("src/channels/adapters/http-transport.ts", 20)
	if !strings.HasSuffix(got, "http-transport.ts") {
		t.Fatalf("fitArg dropped the basename: %q", got)
	}
	if len([]rune(got)) > 20 {
		t.Fatalf("fitArg returned %d runes, want <= 20", len([]rune(got)))
	}
	// A command reads left to right even when it contains a path.
	if got := fitArg("grep -rn pattern src/", 12); !strings.HasPrefix(got, "grep") {
		t.Fatalf("command should keep its head: %q", got)
	}
	if got := fitArg("src/a.go", 40); got != "src/a.go" {
		t.Fatalf("short arg should pass through unchanged: %q", got)
	}
}

// truncate is regularly called on strings that already carry ANSI color
// codes (e.g. a modal row assembled from several StXxx.Render() spans). A
// rune-counting truncate treats escape-code bytes as visible width, so it
// either doesn't truncate at all (row looks wider than it visually is) or
// cuts mid-escape-sequence and corrupts the rest of the render — this is
// what produced the misaligned model-picker seen in production.
func TestTruncateIsAnsiAware(t *testing.T) {
	styled := lipgloss.NewStyle().Bold(true).Render("hello world")
	got := truncate(styled, 5)
	if w := lipgloss.Width(got); w > 5 {
		t.Fatalf("truncate(%q, 5) has visible width %d, want <= 5", got, w)
	}
	if !strings.Contains(got, "hell") {
		t.Fatalf("truncate should preserve visible text within budget: %q", got)
	}

	long := lipgloss.NewStyle().Bold(true).Render("a") + lipgloss.NewStyle().Faint(true).Render("bcdefghijklmnop")
	got2 := truncate(long, 6)
	if w := lipgloss.Width(got2); w > 6 {
		t.Fatalf("truncate on multi-span styled string has visible width %d, want <= 6", w)
	}
}

func TestPadMeasuresVisibleWidthNotRuneCount(t *testing.T) {
	styled := lipgloss.NewStyle().Bold(true).Render("hi")
	got := pad(styled, 6)
	if w := lipgloss.Width(got); w != 6 {
		t.Fatalf("pad(%q, 6) has visible width %d, want 6", got, w)
	}
}

func TestFirstLinesCapsAndCounts(t *testing.T) {
	if got := firstLines("a\nb", 4); got != "a\nb" {
		t.Fatalf("short block should pass through: %q", got)
	}
	got := firstLines("a\nb\nc\nd\ne", 2)
	if got != "a\nb\n… 3 more lines" {
		t.Fatalf("firstLines = %q", got)
	}
}

func TestFailureRenderCapsFrameWithoutTruncatingStoredDetail(t *testing.T) {
	body := strings.Repeat("failure detail\n", 200000)
	section := Section{Name: "Bash", State: SectionError, Body: body}
	rendered := stripANSI(section.Render(80, 0, false))
	if section.Body != body {
		t.Fatal("failure detail was truncated in storage")
	}
	if len(rendered) > errorRenderMaxBytes+1024 || !strings.Contains(rendered, "full detail retained") {
		t.Fatalf("failure render was not capped: %d bytes", len(rendered))
	}
}

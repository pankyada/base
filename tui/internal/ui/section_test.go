package ui

import (
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

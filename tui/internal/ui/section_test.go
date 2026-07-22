package ui

import "testing"

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

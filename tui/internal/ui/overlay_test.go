package ui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

func TestCompositeLeavesUntouchedRowsByteIdentical(t *testing.T) {
	lipgloss.SetColorProfile(termenv.Ascii)
	bg := "row one\nrow two\nrow three"
	got := Composite(bg, "X", 2, 1)
	rows := strings.Split(got, "\n")
	if rows[0] != "row one" || rows[2] != "row three" {
		t.Fatalf("untouched rows changed: %q", got)
	}
	if rows[1] != "roX two" {
		t.Fatalf("composite row = %q", rows[1])
	}
}

func TestCompositePreservesStyledBackgroundOutsideForeground(t *testing.T) {
	lipgloss.SetColorProfile(termenv.TrueColor)
	background := lipgloss.NewStyle().Foreground(lipgloss.Color("#ff0000")).Render("abcdef")
	foreground := lipgloss.NewStyle().Foreground(lipgloss.Color("#00ff00")).Render("XY")
	got := Composite(background, foreground, 2, 0)
	if !strings.Contains(got, "[38;2;255;0;0m") || !strings.Contains(got, "[38;2;0;255;0m") {
		t.Fatalf("styled composite lost colours: %q", got)
	}
}

func TestCompositeClampsOutOfBoundsAndWideRunes(t *testing.T) {
	if got := Composite("abcdef", "Z", -20, -20); got != "Zbcdef" {
		t.Fatalf("negative offset not clamped: %q", got)
	}
	got := Composite("a界bcd", "X", 3, 0)
	if !strings.Contains(got, "a界X") {
		t.Fatalf("wide rune shifted overlay: %q", got)
	}
	if got := Composite("abc", "X", 100, 100); got != "abcX" {
		t.Fatalf("large offset not clamped: %q", got)
	}
}

func TestCenter(t *testing.T) {
	if got := Center("123456789\n.........\nabcdefghi", "XX", 9, 3); got != "123456789\n...XX....\nabcdefghi" {
		t.Fatalf("centered overlay = %q", got)
	}
}

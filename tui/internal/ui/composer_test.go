package ui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestComposerSubmitAndBoundedHistory(t *testing.T) {
	c := NewComposer()
	for i := 0; i < composerHistoryMax+5; i++ {
		c.input.SetValue("message")
		if got := c.Submit(); got != "message" {
			t.Fatalf("submit() = %q", got)
		}
	}
	if len(c.history) != composerHistoryMax {
		t.Fatalf("history length = %d, want %d", len(c.history), composerHistoryMax)
	}
}

func TestComposerShiftEnterAddsLineAndCapsHeight(t *testing.T) {
	c := NewComposer()
	c.SetWidth(20)
	c.input.SetValue("first")
	c.input.InsertString("\n")
	c.syncHeight()
	c.input.InsertString("second")
	if got := c.Value(); got != "first\nsecond" {
		t.Fatalf("value = %q", got)
	}
	if c.input.Height() > composerMaxHeight {
		t.Fatalf("height = %d, want <= %d", c.input.Height(), composerMaxHeight)
	}
}

func TestComposerRecall(t *testing.T) {
	c := NewComposer()
	c.input.SetValue("one")
	c.Submit()
	c.input.SetValue("two")
	c.Submit()

	c.Update(tea.KeyMsg{Type: tea.KeyUp})
	if got := c.Value(); got != "two" {
		t.Fatalf("up recall = %q, want two", got)
	}
	c.Update(tea.KeyMsg{Type: tea.KeyUp})
	if got := c.Value(); got != "one" {
		t.Fatalf("second up recall = %q, want one", got)
	}
}

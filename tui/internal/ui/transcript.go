package ui

import (
	"fmt"

	"github.com/charmbracelet/lipgloss"
)

// Turn is one user message or one agent response.
type Turn struct {
	Role     string // "user" | "agent"
	Text     string // user content, or streamed agent text
	Time     string
	Sections []Section // agent only
	Tokens   int       // agent only, for the footer
	Elapsed  string    // agent only, for the footer
}

// Transcript renders the full conversation.
type Transcript struct {
	Turns       []Turn
	AllExpanded bool // ^O toggle
}

func (tr Transcript) Render(width, frame int) string {
	var blocks []string
	for _, t := range tr.Turns {
		if t.Role == "user" {
			header := StDim.Render("YOU › " + t.Time)
			body := lipgloss.NewStyle().
				BorderStyle(lipgloss.NormalBorder()).
				BorderLeft(true).
				BorderForeground(ColInfo).
				PaddingLeft(1).
				Render(StText.Render(t.Text))
			blocks = append(blocks, lipgloss.JoinVertical(lipgloss.Left, header, body))
			continue
		}
		// agent
		header := StDim.Render("HARNESS ◆ " + t.Time)
		parts := []string{header}
		for _, s := range t.Sections {
			parts = append(parts, s.Render(width, frame, tr.AllExpanded))
		}
		if t.Text != "" {
			parts = append(parts, StText.Render(t.Text))
		}
		if t.Tokens > 0 || t.Elapsed != "" {
			footer := StFaint.Render(fmt.Sprintf("▌ %d tools · %d tok · %s",
				len(t.Sections), t.Tokens, t.Elapsed))
			parts = append(parts, footer)
		}
		blocks = append(blocks, lipgloss.JoinVertical(lipgloss.Left, parts...))
	}
	return lipgloss.JoinVertical(lipgloss.Left, spread(blocks)...)
}

// spread inserts a blank line between blocks.
func spread(blocks []string) []string {
	if len(blocks) == 0 {
		return blocks
	}
	out := make([]string, 0, len(blocks)*2)
	for i, b := range blocks {
		out = append(out, b)
		if i < len(blocks)-1 {
			out = append(out, "")
		}
	}
	return out
}

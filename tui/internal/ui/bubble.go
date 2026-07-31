package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

func userBubble(t Turn, width int) string {
	if width <= 0 {
		return ""
	}
	longest := 0
	for _, line := range strings.Split(t.Text, "\n") {
		if w := lipgloss.Width(line); w > longest {
			longest = w
		}
	}
	maxBubble := width * 62 / 100
	if width < 40 {
		maxBubble = width
	}
	boxWidth := minInt(maxBubble, longest+4)
	boxWidth = maxInt(4, minInt(width, boxWidth))
	box := lipgloss.NewStyle().
		Width(boxWidth).
		BorderStyle(lipgloss.RoundedBorder()).
		BorderForeground(ColInfo).
		Padding(0, 1).
		Foreground(ColText).
		Render(t.Text)
	label := StDim.Render("you · " + t.Time)
	return lipgloss.JoinVertical(lipgloss.Right,
		lipgloss.PlaceHorizontal(width, lipgloss.Right, label),
		lipgloss.PlaceHorizontal(width, lipgloss.Right, box),
	)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

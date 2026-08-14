package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

var overlayTabs = []string{"model", "approval", "theme", "density", "skills", "tasks", "inbox", "undo"}

var overlayTabHints = map[string]string{
	"model":    "↑/↓ choose · / filter · enter apply · tab next · esc close",
	"approval": "↑/↓ choose · enter apply · tab next · esc close",
	"theme":    "↑/↓ choose · live preview · tab next · esc close",
	"density":  "↑/↓ choose · live preview · tab next · esc close",
	"skills":   "↑/↓ select · enter open · e edit · p promote · d discard · m mine · r refresh",
	"tasks":    "↑/↓ select · enter run/stop · e edit · d detect · a ask agent · r reload",
	"inbox":    "↑/↓ select · enter answer · tab next · esc close",
	"undo":     "↑/↓ select available · enter restore · tab next · esc close",
}

// tabsView frames the overlay: a tab strip, a rule, the active tab's body, and
// a per-tab hint footer. The body must be bare content — never a modalFrame —
// or the overlay ends up with two nested borders.
func tabsView(active string, width, height int, body string) string {
	inner := modalInnerWidth(width)

	var labels []string
	for _, tab := range overlayTabs {
		label := " " + strings.ToUpper(tab) + " "
		if tab == active {
			labels = append(labels, lipgloss.NewStyle().
				Foreground(ColBg).Background(ColAccent).Bold(true).Render(label))
		} else {
			labels = append(labels, StDim.Render(label))
		}
	}
	strip := strings.Join(labels, StFaint.Render("│"))

	hint := overlayTabHints[active]
	if hint == "" {
		hint = "tab/←/→ switch · esc close"
	}

	content := lipgloss.JoinVertical(lipgloss.Left,
		strip,
		StFaint.Render(strings.Repeat("─", maxInt(1, inner))),
		body,
		"",
		StDim.Render(truncate(hint, inner)),
	)
	return modalFrame(content, width, height)
}

// sectionHeader draws a labeled rule — "LABEL ─────────" — the shared
// primitive for marking off a distinct section wherever the UI has more than
// one (the rail, help screen, skills tab).
func sectionHeader(label string, width int) string {
	title := StAccentB.Render(strings.ToUpper(label))
	rule := maxInt(0, width-lipgloss.Width(title)-1)
	if rule == 0 {
		return title
	}
	return title + " " + StFaint.Render(strings.Repeat("─", rule))
}

func skillsPlaceholder() string {
	return strings.Join([]string{
		StDim.Render("proposed skills appear here after /skills mine"),
		StFaint.Render("review · edit · promote · discard"),
	}, "\n")
}

package ui

import (
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
)

func topBar(profile, sessionID string, connected bool, running bool, frame int, now time.Time, width int) string {
	dot := StErr.Render("● offline")
	if connected {
		dot = StOK.Render("● online")
	}
	segments := []string{
		StAccentB.Render("◆ harness"),
		statusBadge(running, frame),
		StDim.Render(profile),
		StFaint.Render(shortID(sessionID)),
		dot,
		StDim.Render(now.Format("15:04")),
	}
	return fitBar(width, segments)
}

func shortID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

func fitBar(width int, segments []string) string {
	if width <= 0 || len(segments) == 0 {
		return ""
	}
	for len(segments) > 1 && lipgloss.Width(strings.Join(segments, "  ")) > width {
		segments = segments[:len(segments)-1]
	}
	return lipgloss.NewStyle().MaxWidth(width).Inline(true).Render(strings.Join(segments, "  "))
}

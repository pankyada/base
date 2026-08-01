package ui

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
)

type StageItem struct {
	Stage string
	State string
	Cost  float64
}

// topBar carries identity only — who you are and whether the socket is up.
// Live run state (READY/RUNNING, tokens, cost) belongs to the status bar,
// which sits next to the composer where the eye already is; rendering the
// badge in both places just asked the user which one to believe.
func topBar(profile, sessionID string, connected bool, now time.Time, width int, workflow ...[]StageItem) string {
	dot := StErr.Render("● offline")
	if connected {
		dot = StOK.Render("● online")
	}
	segments := []string{
		StAccentB.Render("◆ harness"),
		StDim.Render(profile),
		StFaint.Render(shortID(sessionID)),
		dot,
		StDim.Render(now.Format("15:04")),
	}
	base := fitBar(width, segments)
	if len(workflow) == 0 || len(workflow[0]) == 0 {
		return base
	}
	strip := make([]string, 0, len(workflow[0]))
	for _, item := range workflow[0] {
		switch item.State {
		case "skipped":
			strip = append(strip, StFaint.Render(item.Stage))
		case "start":
			strip = append(strip, StAccent.Render("◆ "+item.Stage))
		case "escalated":
			strip = append(strip, StErr.Render("!"+item.Stage))
		default:
			strip = append(strip, StOK.Render("✓ "+item.Stage))
		}
	}
	return base + "\n" + lipgloss.NewStyle().MaxWidth(width).Inline(true).Render(strings.Join(strip, StDim.Render("  ›  "))) + StFaint.Render(fmt.Sprintf("  $%.4f", stageTotal(workflow[0])))
}

func stageTotal(items []StageItem) float64 {
	total := 0.0
	for _, item := range items {
		total += item.Cost
	}
	return total
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

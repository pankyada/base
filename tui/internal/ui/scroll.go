package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// scrollbarView draws the one-cell gutter beside the transcript. When
// everything already fits it renders as blank space rather than a full-height
// thumb, so the gutter only ever appears when there is something below.
func scrollbarView(height, viewHeight, totalLines, offset int) string {
	if height <= 0 {
		return ""
	}
	blank := strings.TrimRight(strings.Repeat(" \n", height), "\n")
	if totalLines <= viewHeight || viewHeight <= 0 {
		return blank
	}
	thumb := maxInt(1, height*viewHeight/totalLines)
	travel := maxInt(1, totalLines-viewHeight)
	top := (height - thumb) * offset / travel
	top = maxInt(0, minInt(height-thumb, top))

	rows := make([]string, height)
	for i := range rows {
		if i >= top && i < top+thumb {
			rows[i] = lipgloss.NewStyle().Foreground(ColBorderHi).Render("│")
		} else {
			rows[i] = lipgloss.NewStyle().Foreground(ColBorder).Render("╎")
		}
	}
	return strings.Join(rows, "\n")
}

// scrollHint is the "you are reading history" line. It only renders when the
// user has scrolled away from the bottom, and says how far back they are and
// how to get out.
func scrollHint(following bool, viewHeight, totalLines, offset, width int) string {
	if following || totalLines <= viewHeight {
		return ""
	}
	below := maxInt(0, totalLines-viewHeight-offset)
	if below == 0 {
		return ""
	}
	text := fmt.Sprintf("↓ %d more line(s) below · end jumps to latest", below)
	return lipgloss.NewStyle().Foreground(ColBg).Background(ColAccentDim).
		MaxWidth(maxInt(1, width)).Inline(true).Render(" " + truncate(text, maxInt(1, width-2)) + " ")
}

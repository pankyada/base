package ui

import (
	"strings"

	"github.com/charmbracelet/x/ansi"
)

// Composite places fg over bg at a cell offset. ANSI sequences and wide
// graphemes are measured in terminal cells, not bytes or Go runes.
func Composite(bg, fg string, x, y int) string {
	bgLines := strings.Split(bg, "\n")
	fgLines := strings.Split(fg, "\n")
	if len(bgLines) == 0 || len(fgLines) == 0 {
		return bg
	}

	if y < 0 {
		y = 0
	}
	if y >= len(bgLines) {
		y = len(bgLines) - 1
	}
	if x < 0 {
		x = 0
	}

	for row, foreground := range fgLines {
		target := y + row
		if target >= len(bgLines) {
			break
		}
		background := bgLines[target]
		backgroundWidth := ansi.StringWidth(background)
		offset := x
		if offset > backgroundWidth {
			offset = backgroundWidth
		}

		foregroundWidth := ansi.StringWidth(foreground)
		left := ansi.Cut(background, 0, offset)
		if width := ansi.StringWidth(left); width < offset {
			left += strings.Repeat(" ", offset-width)
		}
		right := ansi.Cut(background, offset+foregroundWidth, backgroundWidth)
		bgLines[target] = left + foreground + right
	}

	return strings.Join(bgLines, "\n")
}

// Center places fg in the middle of a w by h terminal area over bg.
func Center(bg, fg string, w, h int) string {
	if w < 0 {
		w = 0
	}
	if h < 0 {
		h = 0
	}
	fgLines := strings.Split(fg, "\n")
	fgWidth := 0
	for _, line := range fgLines {
		if width := ansi.StringWidth(line); width > fgWidth {
			fgWidth = width
		}
	}
	fgHeight := len(fgLines)
	return Composite(bg, fg, (w-fgWidth)/2, (h-fgHeight)/2)
}

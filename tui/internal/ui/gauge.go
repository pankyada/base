package ui

import (
	"fmt"
	"strings"
)

func contextGauge(used, window, width int) string {
	if window <= 0 {
		return StFaint.Render("context —")
	}
	ratio := float64(used) / float64(window)
	if ratio < 0 {
		ratio = 0
	}
	percent := int(ratio * 100)
	if percent > 999 {
		percent = 999
	}
	filled := int(ratio * float64(maxInt(1, width)))
	if filled > width {
		filled = width
	}
	bar := strings.Repeat("█", filled) + strings.Repeat("·", maxInt(0, width-filled))
	style := StOK
	if ratio >= .85 {
		style = StErr
	} else if ratio >= .60 {
		style = StAccent
	}
	return style.Render(bar) + StDim.Render(fmt.Sprintf(" %d%% · %s/%s", percent, compactNumber(used), compactNumber(window)))
}

func contextGaugeCompact(used, window int) string {
	if window <= 0 {
		return "▁▃▅ —"
	}
	ratio := float64(used) / float64(window)
	if ratio < 0 {
		ratio = 0
	}
	if ratio > 1 {
		ratio = 1
	}
	blocks := []rune("▁▃▅▆█")
	return string(blocks[int(ratio*float64(len(blocks)-1))]) + fmt.Sprintf(" %d%%", int(ratio*100))
}

func compactNumber(value int) string {
	if value >= 1_000_000 {
		return fmt.Sprintf("%.1fm", float64(value)/1_000_000)
	}
	if value >= 1_000 {
		return fmt.Sprintf("%.1fk", float64(value)/1_000)
	}
	return fmt.Sprintf("%d", value)
}

package ui

import (
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

var spinFrames = []string{"⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"}

// tickMsg advances the spinner frame.
type tickMsg struct{}

func spinnerTick() tea.Cmd {
	return tea.Tick(100*time.Millisecond, func(time.Time) tea.Msg { return tickMsg{} })
}

func spinChar(frame int) string {
	return spinFrames[frame%len(spinFrames)]
}

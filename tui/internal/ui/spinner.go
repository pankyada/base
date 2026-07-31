package ui

import (
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

var spinFrames = []string{"⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"}

var spinnerPersonalities = map[string][]string{
	"filesystem": {"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"},
	"shell":      {"▖", "▘", "▝", "▗"},
	"network":    {"◜", "◝", "◞", "◟"},
	"thinking":   {"·", "∘", "○", "∘"},
	"delegate":   {"⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"},
}

// tickMsg advances the spinner frame.
type tickMsg struct{}

func spinnerTick() tea.Cmd {
	return tea.Tick(100*time.Millisecond, func(time.Time) tea.Msg { return tickMsg{} })
}

func spinChar(frame int) string {
	return spinFrames[frame%len(spinFrames)]
}

// thinkingSpinChar drives the "agent is working, nothing to show yet"
// indicator shown before the first token or tool call of a turn arrives.
func thinkingSpinChar(frame int) string {
	set := spinnerPersonalities["thinking"]
	return set[frame%len(set)]
}

func spinCharForTool(tool string, frame int) string {
	set := spinFrames
	lower := strings.ToLower(tool)
	if strings.Contains(lower, "bash") || strings.Contains(lower, "shell") {
		set = spinnerPersonalities["shell"]
	}
	if strings.Contains(lower, "mcp") || strings.Contains(lower, "http") || strings.Contains(lower, "network") {
		set = spinnerPersonalities["network"]
	}
	if strings.Contains(lower, "delegate") {
		set = spinnerPersonalities["delegate"]
	}
	if strings.Contains(lower, "think") {
		set = spinnerPersonalities["thinking"]
	}
	if strings.Contains(lower, "read") || strings.Contains(lower, "write") || strings.Contains(lower, "file") {
		set = spinnerPersonalities["filesystem"]
	}
	return set[frame%len(set)]
}

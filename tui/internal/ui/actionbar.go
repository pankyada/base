package ui

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// ActionResult is the durable context for the last user-triggered project
// action. It intentionally excludes ordinary agent tool events.
type ActionResult struct {
	Kind      string
	Label     string
	Result    string
	OK        bool
	At        time.Time
	UndoID    string
	RetryFunc func(*Model) tea.Cmd
	LogsTab   string
}

func actionBar(action *ActionResult, width int) string {
	if action == nil || width <= 0 {
		return ""
	}
	style := StOK
	glyph := "✓"
	if !action.OK {
		style = StErr
		glyph = "✗"
	}
	result := strings.TrimSpace(firstLine(action.Result))
	if result == "" {
		result = "done"
	}
	line := style.Render(glyph+" "+action.Label) + StDim.Render(" · "+result)
	hints := make([]string, 0, 3)
	if action.UndoID != "" {
		hints = append(hints, "[u]ndo")
	}
	if action.RetryFunc != nil {
		hints = append(hints, "[r]etry")
	}
	if action.LogsTab != "" {
		hints = append(hints, "[l]ogs")
	}
	if len(hints) > 0 {
		line += "  " + StAccent.Render(strings.Join(hints, "  "))
	}
	return lipgloss.NewStyle().MaxWidth(width).Inline(true).Render(line)
}

func actionResult(kind, label, result string, ok bool) *ActionResult {
	return &ActionResult{Kind: kind, Label: label, Result: result, OK: ok, At: time.Now()}
}

func actionExitResult(code int) string {
	if code == 0 {
		return "exit 0"
	}
	return fmt.Sprintf("exit %d", code)
}

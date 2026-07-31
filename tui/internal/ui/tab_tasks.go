package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// tasksTab renders the overlay's task panel: the configured commands with
// their run state on the left of the decision, and the raw tasks.json when the
// user wants to change them.
func tasksTab(tasks []Task, cursor int, states map[string]TaskStatus, detected bool, configPath string, editing bool, editor, editorError string, width int) string {
	inner := modalInnerWidth(width)

	if editing {
		lines := []string{
			sectionHeader("tasks.json", inner),
			StFaint.Render(truncate(configPath, inner)),
			"",
			editor,
		}
		if editorError != "" {
			lines = append(lines, "", StErr.Render(truncate(editorError, inner)))
		}
		lines = append(lines, "", StDim.Render("^s save · esc cancel"))
		return strings.Join(lines, "\n")
	}

	source := "from " + configPath
	if detected {
		source = "detected from project files · not saved yet"
	}
	lines := []string{
		sectionHeader(fmt.Sprintf("tasks %d", len(tasks)), inner),
		StFaint.Render(truncate(source, inner)),
		"",
	}
	if len(tasks) == 0 {
		lines = append(lines,
			StDim.Render("no build/run/serve commands configured for this project"),
			"",
			StFaint.Render("d  detect them from package.json, Makefile, go.mod, …"),
			StFaint.Render("a  ask the agent to write tasks.json"),
			StFaint.Render("e  write it yourself"),
		)
	}

	labelWidth := 0
	for _, task := range tasks {
		if w := lipgloss.Width(task.Label); w > labelWidth {
			labelWidth = w
		}
	}
	labelWidth = minInt(maxInt(labelWidth, 6), 20)

	for index, task := range tasks {
		marker := "  "
		if index == cursor {
			marker = StAccent.Render("› ")
		}
		state := states[task.ID]
		status := StFaint.Render("idle")
		switch {
		case state.Running:
			status = StAccent.Render("running " + state.Elapsed)
		case state.Finished && state.Code == 0:
			status = StOK.Render("exit 0")
		case state.Finished:
			status = StErr.Render(fmt.Sprintf("exit %d", state.Code))
		}
		label := StText.Render(pad(truncate(task.Label, labelWidth), labelWidth))
		if index == cursor {
			label = StAccentB.Render(pad(truncate(task.Label, labelWidth), labelWidth))
		}
		row := marker + StDim.Render(taskGlyph(task.Kind)) + " " + label + "  " + status +
			StFaint.Render("  "+task.Command)
		lines = append(lines, clampWidth(row, inner))
	}
	return strings.Join(lines, "\n")
}

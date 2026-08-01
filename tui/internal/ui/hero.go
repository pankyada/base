package ui

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// heroView is the transcript's empty state. Instead of a bare "type a
// message" it orients the user in the project they are about to work on —
// where they are, what branch, what is runnable — and points at the controls.
//
// When the rail is on screen it already shows branch, counts and the task
// list a few columns to the right, so the hero drops those rows and keeps
// only what the rail cannot say: how to drive the thing.
func heroView(workingDir string, git GitState, tasks []Task, railShown bool, width int) string {
	inner := maxInt(20, minInt(width, 72))

	project := filepath.Base(strings.TrimRight(workingDir, string(filepath.Separator)))
	if project == "" || project == "." {
		project = workingDir
	}

	lines := []string{
		StAccentB.Render("◆ harness") + StFaint.Render("  ready"),
		"",
		StFaint.Render(pad("project", 9)) + StText.Render(truncate(project, inner-9)),
	}
	if !railShown {
		if git.Checked && git.Repo {
			branch := git.Branch
			if git.Dirty() {
				branch += fmt.Sprintf("  %d staged · %d changed · %d new", git.Staged, git.Unstaged, git.Untracked)
			} else {
				branch += "  clean"
			}
			lines = append(lines, StFaint.Render(pad("branch", 9))+StText.Render(truncate(branch, inner-9)))
		}
		if len(tasks) > 0 {
			labels := make([]string, 0, len(tasks))
			for _, task := range tasks {
				labels = append(labels, task.Label)
			}
			lines = append(lines, StFaint.Render(pad("tasks", 9))+StDim.Render(truncate(strings.Join(labels, " · "), inner-9)))
		}
	}

	if railShown {
		lines = append(lines,
			"",
			StDim.Render("ask a question, or drive the project from the rail:"),
			StFaint.Render("  click a task to run · click git to stage, commit, push"),
			StFaint.Render("  tab panels · /? keys"),
		)
	} else {
		// No rail at this width, so the slash commands are the only way in.
		lines = append(lines,
			"",
			StDim.Render("ask a question, or drive the project by command:"),
			StFaint.Render("  /tasks run <id> · /git stage · /git commit <msg>"),
			StFaint.Render("  ^b rail (needs 100+ cols) · tab panels · /? keys"),
		)
	}

	return lipgloss.NewStyle().
		Width(inner).
		BorderStyle(lipgloss.RoundedBorder()).
		BorderForeground(ColBorder).
		Padding(1, 2).
		Render(strings.Join(lines, "\n"))
}

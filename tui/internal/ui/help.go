package ui

import (
	"strings"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/lipgloss"
)

func helpBinding(binding key.Binding) string {
	help := binding.Help()
	return help.Key + "  " + help.Desc
}

func helpView(keys KeyMap, width, height int) string {
	panelWidth := maxInt(30, width*70/100)
	inner := maxInt(4, panelWidth-4) // minus Padding(1, 2) horizontal

	rows := []string{
		StAccentB.Render("◆ HARNESS KEYS"), "",
		sectionHeader("composer", inner), helpBinding(keys.Send), helpBinding(keys.Newline), helpBinding(keys.HistoryUp), helpBinding(keys.HistoryDown), helpBinding(keys.Cancel),
		"",
		sectionHeader("transcript", inner), helpBinding(keys.PageUp), helpBinding(keys.PageDown), helpBinding(keys.HalfPageUp), helpBinding(keys.HalfPageDown), helpBinding(keys.ExpandAll), "end  bottom",
		"",
		sectionHeader("panels", inner), helpBinding(keys.Overlay), helpBinding(keys.Rail), helpBinding(keys.AcceptCompletion), helpBinding(keys.Palette),
		"",
		sectionHeader("project", inner),
		"click     run a task, or stage/commit/push in the rail",
		"/tasks    list, edit, detect, run <id>, stop <id>",
		"/inbox    answer parked questions",
		"/git      status, stage, unstage, commit <msg>, push, pull, diff, log",
		"",
		sectionHeader("global", inner), helpBinding(keys.Quit), "/?      open this popup", "ctrl+x  clear queued messages", "ctrl+r  clear attachments",
		"",
		sectionHeader("commands", inner), slashHelp(),
		"",
		StFaint.Render("Tab accepts autocomplete when popup is open; otherwise it opens panels."),
	}
	return lipgloss.NewStyle().BorderStyle(lipgloss.RoundedBorder()).BorderForeground(ColInfo).Padding(1, 2).Width(panelWidth).Render(strings.Join(rows, "\n"))
}

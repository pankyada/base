package ui

import (
	"sort"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// paletteEntry is the command palette's intentionally small common shape.
// Entries with action run immediately; the rest put insert into the composer.
type paletteEntry struct {
	kind           invocableKind
	label          string
	detail         string
	insert         string
	action         func(*Model) tea.Cmd
	disabledReason string
}

func paletteEntries(m Model) []paletteEntry {
	entries := make([]paletteEntry, 0, len(slashOrder)+len(m.customCommands)+len(m.installedSkills)+len(m.tasks)+4)
	panels := map[string]string{
		"model": "model", "approval": "approval", "sessions": "sessions", "tasks": "tasks",
		"inbox": "inbox", "undo": "undo", "git": "git", "skills": "skills", "theme": "theme", "density": "density",
	}
	for _, name := range slashOrder {
		name, detail := name, slashCommands[name]
		kind := invocableCommand
		if _, ok := panels[name]; ok {
			kind = invocablePanel
		}
		e := paletteEntry{kind: kind, label: "/" + name, detail: detail, insert: "/" + name}
		e.action = func(model *Model) tea.Cmd {
			cmd, _ := model.handleSlash(name)
			return cmd
		}
		if m.running && (name == "compact" || name == "clear") {
			e.disabledReason = "session busy"
		}
		entries = append(entries, e)
	}
	for _, item := range m.invocableItems() {
		if item.kind == invocableCommand {
			name := item.command.Name
			entries = append(entries, paletteEntry{
				kind: invocableCommand, label: "/" + name, detail: item.command.Description, insert: "/" + name,
				action: func(model *Model) tea.Cmd {
					model.startMessage(strings.ReplaceAll(item.command.Template, "$ARGUMENTS", ""))
					return nil
				},
			})
		} else {
			name := item.skill.Name
			entries = append(entries, paletteEntry{
				kind: invocableSkill, label: "/" + name, detail: item.skill.Description, insert: "/" + name,
				action: func(model *Model) tea.Cmd { model.startMessage(fmtSkillPrompt(item.skill.Name)); return nil },
			})
		}
	}
	for _, task := range m.tasks {
		task := task
		e := paletteEntry{
			kind: invocableTask, label: "run " + task.Label, detail: task.Command,
			action: func(model *Model) tea.Cmd { return model.toggleTask(task.ID) },
		}
		if m.running && (task.Kind == "run" || task.Kind == "build" || task.Kind == "test") {
			e.disabledReason = "session busy"
		}
		entries = append(entries, e)
	}
	if m.git.Repo {
		if m.git.Dirty() {
			entries = append(entries, gitPaletteEntry("stage", "stage working tree", "stage"))
		}
		if m.git.Staged > 0 {
			entries = append(entries, gitPaletteEntry("commit", "commit staged changes", "commit"))
		}
		if m.git.Ahead > 0 {
			entries = append(entries, gitPaletteEntry("push", "push local commits", "push"))
		}
		if m.git.Behind > 0 {
			entries = append(entries, gitPaletteEntry("pull", "pull upstream changes", "pull"))
		}
	}
	entries = paletteRecentFirst(entries, m.paletteRecent)
	if m.overlayTab == "tasks" || m.overlayTab == "skills" {
		want := invocableTask
		if m.overlayTab == "skills" {
			want = invocableSkill
		}
		stableBoost(entries, func(e paletteEntry) bool { return e.kind == want })
	}
	return entries
}

func gitPaletteEntry(action, detail, command string) paletteEntry {
	return paletteEntry{kind: invocableGitAction, label: "git " + action, detail: detail,
		action: func(model *Model) tea.Cmd { return model.startGitAction(command, "") }}
}

func fmtSkillPrompt(name string) string { return "Use the \"" + name + "\" skill." }

func stableBoost(entries []paletteEntry, match func(paletteEntry) bool) {
	matching := make([]paletteEntry, 0, len(entries))
	other := make([]paletteEntry, 0, len(entries))
	for _, entry := range entries {
		if match(entry) {
			matching = append(matching, entry)
		} else {
			other = append(other, entry)
		}
	}
	copy(entries, append(matching, other...))
}

func paletteRecentFirst(entries []paletteEntry, recent []string) []paletteEntry {
	if len(recent) == 0 {
		return entries
	}
	byLabel := make(map[string]paletteEntry, len(entries))
	for _, entry := range entries {
		byLabel[entry.label] = entry
	}
	out := make([]paletteEntry, 0, len(entries))
	seen := map[string]bool{}
	for _, label := range recent {
		if entry, ok := byLabel[label]; ok && !seen[label] {
			out = append(out, entry)
			seen[label] = true
		}
	}
	for _, entry := range entries {
		if !seen[entry.label] {
			out = append(out, entry)
		}
	}
	return out
}

// paletteFuzzyMatch matches an ordered subsequence and ranks tighter matches
// first. Prefix-only slash completion remains deliberately separate.
func paletteFuzzyMatch(query string, entries []paletteEntry) []paletteEntry {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return append([]paletteEntry(nil), entries...)
	}
	type scored struct {
		entry        paletteEntry
		score, index int
	}
	scoredEntries := []scored{}
	queryRunes := []rune(query)
	for _, entry := range entries {
		label := strings.ToLower(entry.label)
		qi, last, gap := 0, -1, 0
		for i, r := range []rune(label) {
			if qi < len(queryRunes) && r == queryRunes[qi] {
				if last >= 0 {
					gap += i - last - 1
				}
				last, qi = i, qi+1
			}
		}
		if qi == len(queryRunes) {
			scoredEntries = append(scoredEntries, scored{entry: entry, score: gap, index: len(scoredEntries)})
		}
	}
	sort.SliceStable(scoredEntries, func(i, j int) bool { return scoredEntries[i].score < scoredEntries[j].score })
	out := make([]paletteEntry, len(scoredEntries))
	for i, item := range scoredEntries {
		out[i] = item.entry
	}
	return out
}

func palettePanelView(entries []paletteEntry, cursor, width, height int) string {
	inner := maxInt(16, width-8)
	lines := []string{sectionHeader("COMMAND PALETTE", inner)}
	if len(entries) == 0 {
		lines = append(lines, StDim.Render("no matches"))
	}
	for i, entry := range entries {
		marker := "  "
		if i == cursor {
			marker = StAccent.Render("› ")
		}
		label := entry.label
		detail := entry.detail
		if entry.disabledReason != "" {
			lines = append(lines, StDim.Render(marker+label)+StFaint.Render(" · "+entry.disabledReason))
			continue
		}
		row := marker + StText.Render(label)
		if detail != "" {
			row += StDim.Render(" · " + truncate(detail, maxInt(1, inner-lipgloss.Width(row)-3)))
		}
		lines = append(lines, row)
	}
	lines = append(lines, "", StFaint.Render("↑/↓ navigate · enter run · esc close"))
	if height > 0 && len(lines) > height {
		lines = lines[:height]
	}
	return lipgloss.NewStyle().Width(inner).Padding(1, 2).Border(lipgloss.RoundedBorder()).BorderForeground(ColBorder).Render(strings.Join(lines, "\n"))
}

func (m Model) paletteCanOpen() bool {
	return !m.paletteOpen && !m.modelPicker && !m.sessionPicker && !m.approvalPicker &&
		m.pendingApproval == nil && m.pendingInput == nil && !m.helpOpen && !m.overlayOpen &&
		!m.skillEditing && !m.taskEditing && !m.pendingAnswering && !m.completion.Open
}

func (m *Model) openPalette() {
	m.paletteOpen = true
	m.paletteCursor = 0
	m.paletteInput.Reset()
	m.paletteInput.Focus()
	m.reflow()
}

func (m *Model) closePalette() {
	m.paletteOpen = false
	m.paletteInput.Blur()
	m.paletteInput.Reset()
	m.paletteCursor = 0
	m.reflow()
}

func (m *Model) recordPalette(label string) {
	recent := []string{label}
	for _, old := range m.paletteRecent {
		if old != label && len(recent) < 8 {
			recent = append(recent, old)
		}
	}
	m.paletteRecent = recent
	m.prefs.RecentCommands = append([]string(nil), recent...)
	_ = m.prefs.Save("")
}

func (m Model) updatePalette(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	entries := paletteFuzzyMatch(m.paletteInput.Value(), paletteEntries(m))
	switch msg.String() {
	case "esc":
		m.closePalette()
		return m, nil
	case "up":
		if m.paletteCursor > 0 {
			m.paletteCursor--
		}
	case "down":
		if m.paletteCursor < len(entries)-1 {
			m.paletteCursor++
		}
	case "enter":
		if len(entries) == 0 {
			return m, nil
		}
		entry := entries[minInt(m.paletteCursor, len(entries)-1)]
		if entry.disabledReason != "" {
			m.notices.Add(NoticeWarn, "command unavailable", entry.label, entry.disabledReason)
			m.reflow()
			return m, nil
		}
		m.recordPalette(entry.label)
		m.closePalette()
		if entry.action != nil {
			return m, entry.action(&m)
		}
		m.composer.input.SetValue(entry.insert)
		m.reflow()
		return m, nil
	default:
		var cmd tea.Cmd
		m.paletteInput, cmd = m.paletteInput.Update(msg)
		m.paletteCursor = 0
		m.reflow()
		return m, cmd
	}
	m.reflow()
	return m, nil
}

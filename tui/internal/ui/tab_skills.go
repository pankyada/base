package ui

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"harness-tui/internal/protocol"
)

func skillsTab(proposed, installed []protocol.SkillSummary, cursor int, preview string, previewOffset int, editing bool, editor, editorError string, width int) string {
	all := append(append([]protocol.SkillSummary{}, proposed...), installed...)
	var left []string
	left = append(left, StAccentB.Render("PROPOSED"))
	for i, skill := range proposed {
		left = append(left, skillRow(skill, i == cursor))
	}
	left = append(left, "", StAccentB.Render("INSTALLED"))
	for i, skill := range installed {
		left = append(left, skillRow(skill, i+len(proposed) == cursor))
	}
	if len(all) == 0 {
		left = append(left, StDim.Render("none yet"), StFaint.Render("press m to mine"))
	}
	right := preview
	if !editing {
		right = renderSkillPreview(previewLines(preview, previewOffset))
	}
	if editing {
		right = editor
		if editorError != "" {
			right += "\n\n" + StErr.Render("invalid draft: "+editorError)
		}
	}
	if right == "" {
		right = StDim.Render("select a skill to preview SKILL.md")
	}
	columns := lipgloss.JoinHorizontal(lipgloss.Top,
		lipgloss.NewStyle().Width(maxInt(20, width/3)).Render(strings.Join(left, "\n")),
		lipgloss.NewStyle().BorderStyle(lipgloss.NormalBorder()).BorderLeft(true).BorderForeground(ColBorder).PaddingLeft(2).Width(maxInt(20, width*2/3-4)).Render(right),
	)
	return columns + "\n" + StDim.Render("enter preview · ^u/^d scroll · e edit · p promote · d discard · m mine · r refresh")
}

func previewLines(content string, offset int) string {
	if content == "" || offset <= 0 {
		return content
	}
	lines := strings.Split(content, "\n")
	if offset >= len(lines) {
		return StFaint.Render("end of preview")
	}
	return strings.Join(lines[offset:], "\n")
}

func renderSkillPreview(content string) string {
	if content == "" {
		return content
	}
	lines := strings.Split(content, "\n")
	inFrontmatter := false
	for i, line := range lines {
		if strings.TrimSpace(line) == "---" {
			inFrontmatter = !inFrontmatter
			lines[i] = StAccentB.Render(line)
			continue
		}
		if inFrontmatter {
			lines[i] = StAccent.Render(line)
		}
	}
	return strings.Join(lines, "\n")
}

func validateSkillDraft(content string) error {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	if len(lines) < 3 || strings.TrimSpace(lines[0]) != "---" {
		return fmt.Errorf("frontmatter must start with ---")
	}
	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "---" {
			end = i
			break
		}
	}
	if end < 0 {
		return fmt.Errorf("frontmatter must close with ---")
	}
	name, description := "", ""
	for _, line := range lines[1:end] {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "name":
			name = strings.TrimSpace(value)
		case "description":
			description = strings.TrimSpace(value)
		}
	}
	if name == "" || description == "" {
		return fmt.Errorf("frontmatter needs non-empty name and description")
	}
	return nil
}

func skillRow(skill protocol.SkillSummary, selected bool) string {
	marker := " "
	if selected {
		marker = "›"
	}
	description := truncate(skill.Description, 24)
	age := "unknown age"
	if stamp, err := time.Parse(time.RFC3339, skill.MTime); err == nil {
		age = formatSkillAge(time.Since(stamp))
	}
	return marker + " " + skill.Name + "  " + StDim.Render(description+" · "+age)
}

func formatSkillAge(age time.Duration) string {
	if age < time.Minute {
		return "now"
	}
	if age < time.Hour {
		return fmt.Sprintf("%dm", int(age/time.Minute))
	}
	if age < 24*time.Hour {
		return fmt.Sprintf("%dh", int(age/time.Hour))
	}
	return fmt.Sprintf("%dd", int(age/(24*time.Hour)))
}

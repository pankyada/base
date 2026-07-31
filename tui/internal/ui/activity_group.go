package ui

import (
	"fmt"

	"github.com/charmbracelet/lipgloss"
)

// ActivityGroup is a merged run of same-category sections within one turn.
type ActivityGroup struct {
	Category string
	Label    string
	Key      string
	Items    []*Section
	Expanded bool
}

// TimelineEntry is either a merged group or an always-open standalone item.
type TimelineEntry struct {
	Group      *ActivityGroup
	Standalone *Section
}

func isStandalone(s *Section) bool {
	return s.State == SectionError || s.AwaitingApproval
}

// BuildTimeline groups non-error, non-approval sections in first-occurrence
// order. Grouping key includes label so MCP servers stay separate.
func BuildTimeline(sections []*Section, expanded map[string]bool) []TimelineEntry {
	var timeline []TimelineEntry
	groupIndex := map[string]int{}
	for _, section := range sections {
		if section == nil {
			continue
		}
		if isStandalone(section) {
			timeline = append(timeline, TimelineEntry{Standalone: section})
			continue
		}
		category := section.Category
		derivedCategory, label := categorize(section.Name)
		if category == "" {
			category = derivedCategory
		}
		key := category + "|" + label
		if idx, ok := groupIndex[key]; ok {
			timeline[idx].Group.Items = append(timeline[idx].Group.Items, section)
			continue
		}
		group := &ActivityGroup{
			Category: category,
			Label:    label,
			Key:      key,
			Items:    []*Section{section},
			Expanded: expanded != nil && expanded[key],
		}
		groupIndex[key] = len(timeline)
		timeline = append(timeline, TimelineEntry{Group: group})
	}
	return timeline
}

func categoryColor(category string) lipgloss.Color {
	switch category {
	case "files":
		return ColPurple
	case "exec":
		return ColAccent
	case "memory":
		return ColInfo
	case "agents":
		return ColTeal
	case "mcp":
		return ColRose
	default:
		return ColFaint
	}
}

// Render draws a group header and its indented items. Group expansion forces
// all item bodies open, while each item's own Expanded flag still works alone.
func (g *ActivityGroup) Render(width, frame int, allExpanded bool) string {
	open := g.Expanded || allExpanded
	chevron := "▸"
	if open {
		chevron = "▾"
	}
	header := lipgloss.NewStyle().Foreground(categoryColor(g.Category)).Render(chevron+" "+g.Label) +
		StDim.Render(fmt.Sprintf(" · %d ops", len(g.Items)))
	lines := []string{header}
	for _, item := range g.Items {
		lines = append(lines, "  "+item.Render(maxInt(0, width-2), frame, open))
	}
	return lipgloss.JoinVertical(lipgloss.Left, lines...)
}

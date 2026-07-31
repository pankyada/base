package ui

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"harness-tui/internal/protocol"
)

func renderArtifact(artifact protocol.Artifact, width int) string {
	var data interface{}
	if len(artifact.Data) > 0 && json.Unmarshal(artifact.Data, &data) != nil {
		data = nil
	}
	if data == nil {
		return fallbackArtifact(artifact)
	}
	switch artifact.Kind {
	case "metrics":
		return artifactTitle(artifact) + renderMetrics(data)
	case "table":
		return artifactTitle(artifact) + renderTable(data, width)
	case "diff":
		return artifactTitle(artifact) + renderDiff(data)
	case "terminal":
		return artifactTitle(artifact) + lipgloss.NewStyle().BorderStyle(lipgloss.NormalBorder()).Padding(0, 1).Render(fmt.Sprint(data))
	case "doc":
		return artifactTitle(artifact) + renderDoc(artifact, data, width)
	default:
		return fallbackArtifact(artifact)
	}
}

func artifactTitle(a protocol.Artifact) string {
	return StAccentB.Render(a.Icon+" "+a.Title) + "\n"
}

func fallbackArtifact(a protocol.Artifact) string {
	return StDim.Render(fmt.Sprintf("%s %s", a.Icon, a.Title)) + "  " + StFaint.Render(a.Meta+" · not rendered in terminal")
}

func renderMetrics(data interface{}) string {
	object, ok := data.(map[string]interface{})
	if !ok {
		return StFaint.Render("invalid metrics")
	}
	var lines []string
	for key, value := range object {
		lines = append(lines, fmt.Sprintf("%-16s %v", key, value))
	}
	return strings.Join(lines, "\n")
}

func renderTable(data interface{}, width int) string {
	rows, ok := data.([]interface{})
	if !ok || len(rows) == 0 {
		return StFaint.Render("empty table")
	}
	var lines []string
	for _, row := range rows {
		values, ok := row.([]interface{})
		if !ok {
			continue
		}
		parts := make([]string, 0, len(values))
		for _, value := range values {
			parts = append(parts, fmt.Sprint(value))
		}
		lines = append(lines, truncate(strings.Join(parts, "  "), maxInt(1, width-2)))
	}
	return strings.Join(lines, "\n")
}

// renderDoc is the collapsed reference to a long-form report the model wrote
// to a file instead of inlining — path, meta (e.g. "20 sections"), and a
// one-sentence summary, no body. Opening it is the user's call, not ours.
func renderDoc(a protocol.Artifact, data interface{}, width int) string {
	object, ok := data.(map[string]interface{})
	if !ok {
		return StFaint.Render("invalid doc reference")
	}
	path, _ := object["path"].(string)
	summary, _ := object["summary"].(string)
	var lines []string
	if path != "" {
		lines = append(lines, StInfo.Render(path))
	}
	if a.Meta != "" {
		lines = append(lines, StFaint.Render(a.Meta))
	}
	if summary != "" {
		lines = append(lines, StDim.Render(truncate(summary, maxInt(1, width-2))))
	}
	return strings.Join(lines, "\n")
}

func renderDiff(data interface{}) string {
	text := fmt.Sprint(data)
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		if strings.HasPrefix(line, "+") {
			lines[i] = StOK.Render(line)
		} else if strings.HasPrefix(line, "-") {
			lines[i] = StErr.Render(line)
		} else {
			lines[i] = StDim.Render(line)
		}
	}
	return strings.Join(lines, "\n")
}

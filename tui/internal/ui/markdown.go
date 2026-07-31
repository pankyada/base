package ui

import (
	"regexp"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

var (
	inlineCodeRe   = regexp.MustCompile("`([^`]+)`")
	inlineBoldRe   = regexp.MustCompile(`\*\*([^*]+)\*\*`)
	numberedListRe = regexp.MustCompile(`^\d+\.\s`)
	tableRowRe     = regexp.MustCompile(`^\|.*\|$`)
	tableSepRe     = regexp.MustCompile(`^\|[\s:|-]+\|$`)
	hlStringRe     = regexp.MustCompile(`"[^"]*"|'[^']*'`)
	hlNumberRe     = regexp.MustCompile(`\b\d+\.?\d*\b`)
	hlKeywordRe    = regexp.MustCompile(`\b(func|return|if|else|for|while|const|let|var|import|package|type|struct|interface|class|def|async|await|from|export|default|switch|case|break|continue|new|null|nil|true|false)\b`)
)

var listBullets = []string{"•", "◦", "‣"}

// renderAgentText gives streamed agent prose light structure — headers,
// bullet/numbered/nested lists, blockquotes, pipe tables, fenced code with
// basic token highlighting, inline bold/code — and word-wraps prose to width
// so long lines never overflow the terminal. It is intentionally not a full
// markdown renderer: just what the model actually produces most often.
func renderAgentText(text string, width int) string {
	if width < 4 {
		width = 4
	}
	lines := strings.Split(text, "\n")
	out := make([]string, 0, len(lines))
	inFence := false
	var tableBuf []string
	// Body under a header is indented one level per header depth. Models emit
	// section bodies flush-left, so the indent has to be tracked as state from
	// the enclosing header — it is never present in the source text.
	sectionIndent := ""
	flushTable := func() {
		if len(tableBuf) == 0 {
			return
		}
		for _, row := range renderPipeTable(tableBuf) {
			out = append(out, sectionIndent+row)
		}
		tableBuf = nil
	}
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") {
			flushTable()
			if !inFence {
				inFence = true
				label := strings.TrimSpace(strings.TrimPrefix(trimmed, "```"))
				if label == "" {
					label = "code"
				}
				out = append(out, sectionIndent+StFaint.Render("┌─ "+label))
			} else {
				inFence = false
				out = append(out, sectionIndent+StFaint.Render("└─"))
			}
			continue
		}
		if inFence {
			out = append(out, sectionIndent+StFaint.Render("│ ")+highlightCode(line))
			continue
		}
		if level := headerLevel(trimmed); level > 0 {
			flushTable()
			sectionIndent = strings.Repeat("  ", level-1)
			out = append(out, renderHeader(trimmed, level, width))
			continue
		}
		if isThematicBreak(trimmed) {
			flushTable()
			out = append(out, StFaint.Render(strings.Repeat("─", width)))
			continue
		}
		if tableRowRe.MatchString(trimmed) {
			tableBuf = append(tableBuf, trimmed)
			continue
		}
		flushTable()
		body := renderProseLine(line, maxInt(4, width-len(sectionIndent)))
		out = append(out, indentBlock(body, sectionIndent))
	}
	flushTable()
	return strings.Join(out, "\n")
}

// headerLevel reports the ATX header depth of a trimmed line, or 0.
func headerLevel(trimmed string) int {
	switch {
	case strings.HasPrefix(trimmed, "### "):
		return 3
	case strings.HasPrefix(trimmed, "## "):
		return 2
	case strings.HasPrefix(trimmed, "# "):
		return 1
	}
	return 0
}

// renderHeader draws a header flush-left regardless of depth, so the rules
// stay aligned and the eye can scan section boundaries down one column.
func renderHeader(trimmed string, level, width int) string {
	text := inlineFormat(trimmed[level+1:])
	switch level {
	case 1:
		return "\n" + headerRule(text, width, true)
	case 2:
		return "\n" + headerRule(text, width, false)
	default:
		return "\n" + StAccentB.Render(text)
	}
}

func isThematicBreak(trimmed string) bool {
	if len(trimmed) < 3 {
		return false
	}
	for _, marker := range []string{"-", "*", "_"} {
		if strings.Trim(trimmed, marker) == "" {
			return true
		}
	}
	return false
}

// indentBlock prefixes every non-empty line, so wrapped continuation lines
// stay aligned with the first line rather than falling back to the margin.
func indentBlock(s, indent string) string {
	if indent == "" || s == "" {
		return s
	}
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		if line != "" {
			lines[i] = indent + line
		}
	}
	return strings.Join(lines, "\n")
}

// renderProseLine formats one non-fenced line. Indentation is read in pairs
// of two spaces as a nesting depth, used for both list bullets and blockquote
// continuation so nested content reads as a tree rather than a flat wrap.
func renderProseLine(rawLine string, width int) string {
	trimmed := strings.TrimSpace(rawLine)
	if trimmed == "" {
		return ""
	}
	leading := len(rawLine) - len(strings.TrimLeft(rawLine, " "))
	depth := minInt(leading/2, 4)
	indent := strings.Repeat("  ", depth)
	budget := maxInt(4, width-len(indent))

	switch {
	case strings.HasPrefix(trimmed, "> "):
		return indent + StFaint.Render("┃ ") + wrapText(StDim.Render(inlineFormat(trimmed[2:])), budget-2)
	case strings.HasPrefix(trimmed, "- "), strings.HasPrefix(trimmed, "* "):
		bullet := listBullets[minInt(depth, len(listBullets)-1)]
		return indent + wrapText(StAccent.Render(bullet+" ")+inlineFormat(trimmed[2:]), budget)
	case numberedListRe.MatchString(trimmed):
		return indent + wrapText(inlineFormat(trimmed), budget)
	default:
		return indent + wrapText(inlineFormat(trimmed), budget)
	}
}

// headerRule renders a header with a trailing rule filling the remaining
// width, so sections break visually instead of stacking as dense bold text.
func headerRule(text string, width int, strong bool) string {
	style := StAccentB
	glyph := "─"
	if strong {
		glyph = "━"
	}
	rendered := style.Render(text)
	ruleWidth := maxInt(0, width-lipgloss.Width(rendered)-1)
	if ruleWidth == 0 {
		return rendered
	}
	return rendered + " " + StFaint.Render(strings.Repeat(glyph, ruleWidth))
}

// renderTable draws a pipe-table with aligned, padded columns. The optional
// second row (all dashes/colons/pipes) is treated as the header separator.
func renderPipeTable(rows []string) []string {
	if len(rows) == 0 {
		return nil
	}
	hasHeader := len(rows) > 1 && tableSepRe.MatchString(rows[1])
	var parsed [][]string
	for i, row := range rows {
		if hasHeader && i == 1 {
			continue
		}
		parsed = append(parsed, splitTableRow(row))
	}
	if len(parsed) == 0 {
		return nil
	}
	cols := len(parsed[0])
	widths := make([]int, cols)
	for _, row := range parsed {
		for i, cell := range row {
			if i < cols && len([]rune(cell)) > widths[i] {
				widths[i] = len([]rune(cell))
			}
		}
	}
	var out []string
	for i, row := range parsed {
		var cells []string
		for c := 0; c < cols; c++ {
			val := ""
			if c < len(row) {
				val = row[c]
			}
			padded := padTo(val, widths[c])
			if hasHeader && i == 0 {
				cells = append(cells, StAccentB.Render(padded))
			} else {
				cells = append(cells, StText.Render(padded))
			}
		}
		out = append(out, StFaint.Render("│ ")+strings.Join(cells, StFaint.Render(" │ "))+StFaint.Render(" │"))
		if hasHeader && i == 0 {
			var seps []string
			for c := 0; c < cols; c++ {
				seps = append(seps, strings.Repeat("─", widths[c]))
			}
			out = append(out, StFaint.Render("├─"+strings.Join(seps, "─┼─")+"─┤"))
		}
	}
	return out
}

func splitTableRow(row string) []string {
	trimmed := strings.Trim(strings.TrimSpace(row), "|")
	parts := strings.Split(trimmed, "|")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}

func padTo(s string, n int) string {
	l := len([]rune(s))
	if l >= n {
		return s
	}
	return s + strings.Repeat(" ", n-l)
}

// highlightCode applies a light, language-agnostic token pass — strings,
// numbers, common keywords, and a trailing comment — over one fenced line.
// Unmatched text keeps the terminal's default foreground, matching the rest
// of the renderer's convention of only styling what it recognizes.
func highlightCode(line string) string {
	idx := findCommentIndex(line)
	code := line
	comment := ""
	if idx >= 0 {
		code = line[:idx]
		comment = line[idx:]
	}
	code = hlStringRe.ReplaceAllStringFunc(code, func(m string) string { return StTeal.Render(m) })
	code = hlKeywordRe.ReplaceAllStringFunc(code, func(m string) string { return StPurple.Render(m) })
	code = hlNumberRe.ReplaceAllStringFunc(code, func(m string) string { return StAccent.Render(m) })
	if comment != "" {
		return code + StFaint.Render(comment)
	}
	return code
}

func findCommentIndex(line string) int {
	best := -1
	for _, marker := range []string{"//", "#", "--"} {
		if idx := strings.Index(line, marker); idx >= 0 && (best == -1 || idx < best) {
			best = idx
		}
	}
	return best
}

// inlineFormat handles **bold** and `code` spans within a line.
func inlineFormat(s string) string {
	s = inlineCodeRe.ReplaceAllStringFunc(s, func(match string) string {
		return StInfo.Render(inlineCodeRe.FindStringSubmatch(match)[1])
	})
	s = inlineBoldRe.ReplaceAllStringFunc(s, func(match string) string {
		return StAccentB.Render(inlineBoldRe.FindStringSubmatch(match)[1])
	})
	return s
}

func wrapText(s string, width int) string {
	if width < 1 {
		width = 1
	}
	return lipgloss.NewStyle().Width(width).Render(s)
}

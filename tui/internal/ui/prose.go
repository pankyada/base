package ui

import "strings"

// ProseSection is one foldable header-delimited chunk of agent prose, split
// at the shallowest header level actually used in a response — level 1 when
// the text mixes "#" and "##", level 2 when it's "##"-only, and so on. A
// 20-section audit collapses to 20 rows instead of one continuous scroll.
type ProseSection struct {
	Header string // label for the collapsed row, e.g. "20. Overall assessment"
	Raw    string // header line + body, verbatim — rendered as-is when expanded
	Lines  int    // body line count, shown in the collapsed row
}

// SplitProse separates a turn's raw markdown into an always-visible lead
// paragraph and the foldable sections after it. Returns nil sections when no
// header is present, so callers fall back to rendering the whole text.
func SplitProse(text string) (lead string, sections []ProseSection) {
	lines := strings.Split(text, "\n")
	minLevel := 0
	for _, line := range lines {
		if level := headerLevel(strings.TrimSpace(line)); level > 0 && (minLevel == 0 || level < minLevel) {
			minLevel = level
		}
	}
	if minLevel == 0 {
		return text, nil
	}

	var leadLines []string
	var rawLines []string
	var header string
	inSection := false

	flush := func() {
		if !inSection {
			return
		}
		body := strings.Join(rawLines, "\n")
		sections = append(sections, ProseSection{
			Header: header,
			Raw:    body,
			Lines:  maxInt(0, len(rawLines)-1),
		})
	}

	for _, line := range lines {
		if level := headerLevel(strings.TrimSpace(line)); level == minLevel {
			flush()
			trimmed := strings.TrimSpace(line)
			header = strings.TrimSpace(trimmed[level+1:])
			rawLines = []string{line}
			inSection = true
			continue
		}
		if !inSection {
			leadLines = append(leadLines, line)
		} else {
			rawLines = append(rawLines, line)
		}
	}
	flush()
	return strings.Join(leadLines, "\n"), sections
}

// foldThreshold is the minimum section count a density mode folds at. "full"
// never folds (SplitProse is skipped for it entirely by the caller).
func foldThreshold(density string) int {
	switch density {
	case "compact":
		return 1
	default: // "normal"
		return 4
	}
}

// densityModes is the picker list order and the /density-tab body content —
// the single source of truth for what a valid density name is.
var densityModes = []struct{ name, detail string }{
	{"full", "default · never fold — every section always open"},
	{"normal", "fold once a reply has 4+ sections"},
	{"compact", "fold any reply with more than one section"},
}

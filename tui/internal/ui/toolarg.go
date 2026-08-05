package ui

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// A tool input carries the payload as well as the target: a Write holds the
// whole file, an Edit both sides of a replacement, a TodoWrite the entire list.
// The transcript is a map of what the agent touched, not a copy of it, so only
// target-shaped keys are ever read out of an input — per tool where the tool is
// known, and conservatively where it is not.
var toolArgKeys = map[string][]string{
	"Read":           {"file_path"},
	"Write":          {"file_path"},
	"Edit":           {"file_path"},
	"Glob":           {"pattern", "cwd"},
	"Grep":           {"pattern", "path"},
	"Bash":           {"command"},
	"ExecuteCode":    {"language"},
	"Skill":          {"name"},
	"Delegate":       {"profile"},
	"DelegateFanout": {"profile"},
	"MemoryRead":     {"scope", "key"},
	"MemoryWrite":    {"scope", "key"},
	"MemoryDelete":   {"scope", "key"},
	"MemoryLinked":   {"scope", "key"},
	"MemoryList":     {"scope"},
	"TodoRead":       {},
	"TodoWrite":      {},
}

// genericArgKeys is the probe order for MCP servers and any tool not in the
// table above, most identifying first.
var genericArgKeys = []string{
	"file_path", "filePath", "path", "notebook_path", "pattern", "command",
	"url", "query", "name", "key", "id", "scope", "profile", "language",
}

// payloadKeys never reach the transcript, even for an unknown tool whose shape
// we are guessing at. These are the keys that carry bulk text.
var payloadKeys = map[string]bool{
	"content": true, "text": true, "body": true, "code": true, "data": true,
	"old_string": true, "new_string": true, "old_str": true, "new_str": true,
	"replacement": true, "diff": true, "patch": true, "edits": true,
	"items": true, "todos": true, "task": true, "prompt": true, "message": true,
	"instructions": true, "input": true, "source": true, "html": true,
}

var pathKeys = map[string]bool{
	"file_path": true, "filePath": true, "path": true, "notebook_path": true,
	"cwd": true, "dir": true, "directory": true,
}

const (
	argMaxLen      = 72 // hard cap before the row's own width budget applies
	argValueMaxLen = 44
	argMaxParts    = 3
	argScalarMax   = 24 // longest value an unrecognized key may show
)

// summarizeInput reduces a tool call to the target it acts on — the file, the
// pattern, the command — and never to its payload.
func summarizeInput(name string, input map[string]interface{}, root string) string {
	if len(input) == 0 {
		return ""
	}
	keys, known := toolArgKeys[name]
	if !known {
		keys = genericArgKeys
	}
	var parts []string
	for _, key := range keys {
		if payloadKeys[key] || len(parts) == 2 {
			break
		}
		value, ok := input[key]
		if !ok {
			continue
		}
		if formatted := formatArgValue(key, value, root); formatted != "" {
			parts = append(parts, formatted)
		}
	}
	if len(parts) == 0 {
		if !known {
			return truncate(describeKeys(input), argMaxLen)
		}
		return ""
	}
	return truncate(strings.Join(parts, " "), argMaxLen)
}

func formatArgValue(key string, value interface{}, root string) string {
	text := formatScalar(value)
	if text == "" {
		return ""
	}
	if pathKeys[key] {
		return shortenPath(text, root)
	}
	return truncate(collapseSpace(text), argValueMaxLen)
}

// describeKeys is the last resort for a tool whose input has no key we
// recognize: it names the parameters and shows only values short enough to be
// identifiers, so an unknown tool cannot spill a payload into the transcript.
func describeKeys(input map[string]interface{}) string {
	keys := make([]string, 0, len(input))
	for key := range input {
		if payloadKeys[key] {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	truncated := len(keys) > argMaxParts
	if truncated {
		keys = keys[:argMaxParts]
	}
	parts := make([]string, 0, len(keys)+1)
	for _, key := range keys {
		value := collapseSpace(formatScalar(input[key]))
		if value == "" || len([]rune(value)) > argScalarMax {
			parts = append(parts, key)
			continue
		}
		parts = append(parts, key+"="+value)
	}
	if truncated {
		parts = append(parts, "…")
	}
	return strings.Join(parts, " ")
}

// formatScalar renders the values that are safe to show whole. Objects and
// arrays return empty: their size is unbounded and their contents are payload.
func formatScalar(value interface{}) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case bool:
		return strconv.FormatBool(typed)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case int:
		return strconv.Itoa(typed)
	default:
		return ""
	}
}

// shortenPath states a path the way the user thinks of it — relative to the
// working directory when it is under it, then relative to home, then as-is.
func shortenPath(path, root string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}
	clean := filepath.Clean(trimmed)
	if root != "" {
		if rel, err := filepath.Rel(root, clean); err == nil && !strings.HasPrefix(rel, "..") {
			return filepath.ToSlash(rel)
		}
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		if rel, err := filepath.Rel(home, clean); err == nil && !strings.HasPrefix(rel, "..") {
			return "~/" + filepath.ToSlash(rel)
		}
	}
	return filepath.ToSlash(clean)
}

func collapseSpace(text string) string {
	return strings.Join(strings.Fields(text), " ")
}

// summarizeResult reduces a tool result to a size, not a sample: the row says
// the op happened and how much it moved, and the output itself stays behind the
// chevron.
func summarizeResult(name, result string) string {
	trimmed := strings.TrimRight(result, "\n")
	if strings.TrimSpace(trimmed) == "" || strings.HasPrefix(trimmed, "Error:") {
		return ""
	}
	lines := strings.Count(trimmed, "\n") + 1
	empty := strings.TrimSpace(trimmed) == "(no matches)"
	switch name {
	case "Write":
		if written, ok := numberAfter(trimmed, "Written "); ok {
			return humanBytes(written)
		}
	case "Edit":
		if replaced, ok := numberAfter(trimmed, "Replaced "); ok {
			return plural(replaced, "edit")
		}
	case "Glob":
		if empty {
			return "0 files"
		}
		return plural(lines, "file")
	case "Grep":
		if empty {
			return "0 hits"
		}
		return plural(lines, "hit")
	case "Read":
		return plural(lines, "line")
	}
	if lines > 1 {
		return plural(lines, "line")
	}
	return ""
}

// numberAfter reads the integer immediately following prefix, the shape the
// built-in file tools use to report what they did.
func numberAfter(text, prefix string) (int, bool) {
	idx := strings.Index(text, prefix)
	if idx < 0 {
		return 0, false
	}
	rest := text[idx+len(prefix):]
	end := 0
	for end < len(rest) && rest[end] >= '0' && rest[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0, false
	}
	parsed, err := strconv.Atoi(rest[:end])
	return parsed, err == nil
}

func humanBytes(count int) string {
	switch {
	case count < 1024:
		return strconv.Itoa(count) + " B"
	case count < 1024*1024:
		return fmt.Sprintf("%.1f KB", float64(count)/1024)
	default:
		return fmt.Sprintf("%.1f MB", float64(count)/(1024*1024))
	}
}

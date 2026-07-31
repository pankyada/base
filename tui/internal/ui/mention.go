package ui

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

type mentionIndexMsg struct {
	Value   string
	Matches []string
	Capped  bool
}

func mentionIndexCmd(value, root string) tea.Cmd {
	return func() tea.Msg {
		time.Sleep(120 * time.Millisecond)
		query, ok := activeMentionQuery(value)
		if !ok {
			return mentionIndexMsg{Value: value}
		}
		entries := buildMentionIndex(root, 20_000)
		matches := make([]string, 0)
		for _, entry := range entries {
			if strings.HasPrefix(entry, query) {
				matches = append(matches, "@"+entry)
			}
		}
		return mentionIndexMsg{Value: value, Matches: matches, Capped: len(entries) >= 20_000}
	}
}

func activeMentionQuery(value string) (string, bool) {
	idx := strings.LastIndex(value, "@")
	if idx < 0 || (idx > 0 && value[idx-1] != ' ' && value[idx-1] != '\n') {
		return "", false
	}
	query := value[idx+1:]
	if strings.ContainsAny(query, " \n") {
		return "", false
	}
	return query, true
}

func mentionMatches(value, root string) []string {
	query, ok := activeMentionQuery(value)
	if !ok {
		return nil
	}
	entries := buildMentionIndex(root, 20_000)
	var matches []string
	for _, entry := range entries {
		if strings.HasPrefix(entry, query) {
			matches = append(matches, "@"+entry)
		}
	}
	return matches
}

func buildMentionIndex(root string, cap int) []string {
	patterns := loadIgnorePatterns(root)
	var entries []string
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || len(entries) >= cap {
			return filepath.SkipDir
		}
		if entry.IsDir() && (entry.Name() == ".git" || entry.Name() == "node_modules") {
			return filepath.SkipDir
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr == nil && rel != "." && ignoredMentionPath(filepath.ToSlash(rel), entry.IsDir(), patterns) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.IsDir() {
			if relErr == nil {
				entries = append(entries, filepath.ToSlash(rel))
			}
		}
		return nil
	})
	sort.Strings(entries)
	return entries
}

type ignorePattern struct {
	regex    *regexp.Regexp
	basename bool
	dirOnly  bool
}

func loadIgnorePatterns(root string) []ignorePattern {
	data, err := os.ReadFile(filepath.Join(root, ".gitignore"))
	if err != nil {
		return nil
	}
	var patterns []ignorePattern
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "!") {
			continue
		}
		dirOnly := strings.HasSuffix(line, "/")
		line = strings.TrimPrefix(strings.TrimSuffix(line, "/"), "/")
		if line == "" {
			continue
		}
		basename := !strings.Contains(line, "/")
		patterns = append(patterns, ignorePattern{regex: regexp.MustCompile(globRegex(line)), basename: basename, dirOnly: dirOnly})
	}
	return patterns
}

func ignoredMentionPath(rel string, isDir bool, patterns []ignorePattern) bool {
	for _, pattern := range patterns {
		if pattern.dirOnly && !isDir {
			continue
		}
		candidate := rel
		if pattern.basename {
			candidate = filepath.Base(rel)
		}
		if pattern.regex.MatchString(candidate) {
			return true
		}
	}
	return false
}

func globRegex(pattern string) string {
	var b strings.Builder
	b.WriteString("^")
	for i := 0; i < len(pattern); i++ {
		switch pattern[i] {
		case '*':
			if i+1 < len(pattern) && pattern[i+1] == '*' {
				b.WriteString(".*")
				i++
			} else {
				b.WriteString("[^/]*")
			}
		case '?':
			b.WriteString("[^/]")
		default:
			b.WriteString(regexp.QuoteMeta(string(pattern[i])))
		}
	}
	b.WriteString("$")
	return b.String()
}

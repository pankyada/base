package ui

import (
	"strings"
	"testing"
)

func TestSummarizeInputShowsTargetNotPayload(t *testing.T) {
	cases := []struct {
		name  string
		tool  string
		input map[string]interface{}
		want  string
	}{
		{"read", "Read", map[string]interface{}{"file_path": "/repo/src/loop/agent-loop.ts", "offset": 1.0}, "src/loop/agent-loop.ts"},
		{"write", "Write", map[string]interface{}{"file_path": "/repo/src/tools/acl.ts", "content": "export const acl = {}"}, "src/tools/acl.ts"},
		{"edit", "Edit", map[string]interface{}{"file_path": "/repo/README.md", "old_string": "before", "new_string": "after", "replace_all": true}, "README.md"},
		{"grep", "Grep", map[string]interface{}{"pattern": "registerAll", "path": "/repo/src", "flags": "-rn"}, "registerAll src"},
		{"glob", "Glob", map[string]interface{}{"pattern": "src/**/*.ts"}, "src/**/*.ts"},
		{"bash", "Bash", map[string]interface{}{"command": "pnpm test", "timeout": 1000.0}, "pnpm test"},
		{"memory", "MemoryWrite", map[string]interface{}{"scope": "profile", "key": "project-context", "content": "long markdown body"}, "profile project-context"},
		{"skill", "Skill", map[string]interface{}{"name": "drawio"}, "drawio"},
		{"delegate", "Delegate", map[string]interface{}{"profile": "researcher", "task": "go read the whole internet"}, "researcher"},
		{"todos carry only payload", "TodoWrite", map[string]interface{}{"items": []interface{}{"a", "b"}}, ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := summarizeInput(testCase.tool, testCase.input, "/repo"); got != testCase.want {
				t.Fatalf("summarizeInput(%s) = %q, want %q", testCase.tool, got, testCase.want)
			}
		})
	}
}

// The payload keys are the whole reason this function exists: a Write's content
// or an Edit's replacement must never reach the transcript, whatever tool it
// arrives under.
func TestSummarizeInputNeverLeaksPayloadKeys(t *testing.T) {
	secret := "SHOULD-NOT-APPEAR-IN-TRANSCRIPT"
	for key := range payloadKeys {
		input := map[string]interface{}{key: secret}
		for _, tool := range []string{"Write", "Edit", "TodoWrite", "some__unknown_mcp_tool"} {
			if got := summarizeInput(tool, input, "/repo"); strings.Contains(got, secret) {
				t.Fatalf("summarizeInput(%s) leaked payload key %q: %q", tool, key, got)
			}
		}
	}
}

func TestSummarizeInputUnknownToolDescribesKeys(t *testing.T) {
	got := summarizeInput("chrome__navigate", map[string]interface{}{"url": "https://example.com"}, "/repo")
	if got != "https://example.com" {
		t.Fatalf("known-shaped key = %q", got)
	}
	// No recognizable target: name the parameters, and show only values short
	// enough to be identifiers.
	got = summarizeInput("chrome__click", map[string]interface{}{
		"selector": "#submit",
		"detail":   strings.Repeat("x", 200),
	}, "/repo")
	if !strings.Contains(got, "selector=#submit") {
		t.Fatalf("expected short scalar inline, got %q", got)
	}
	if strings.Contains(got, strings.Repeat("x", 30)) {
		t.Fatalf("long value should collapse to its key name, got %q", got)
	}
	if !strings.Contains(got, "detail") {
		t.Fatalf("expected the long value's key name, got %q", got)
	}
}

func TestSummarizeInputCollapsesMultilineCommands(t *testing.T) {
	got := summarizeInput("Bash", map[string]interface{}{"command": "go build ./...\n  && go test ./..."}, "/repo")
	if strings.Contains(got, "\n") {
		t.Fatalf("multi-line command must collapse to one row: %q", got)
	}
}

func TestShortenPathPrefersWorkingDirThenHome(t *testing.T) {
	if got := shortenPath("/repo/src/x.ts", "/repo"); got != "src/x.ts" {
		t.Fatalf("under root = %q", got)
	}
	if got := shortenPath("/elsewhere/x.ts", "/repo"); got != "/elsewhere/x.ts" {
		t.Fatalf("outside root and home = %q", got)
	}
	if got := shortenPath("src/x.ts", "."); got != "src/x.ts" {
		t.Fatalf("relative path with default root = %q", got)
	}
}

func TestSummarizeResultReportsSizeNotContent(t *testing.T) {
	cases := []struct {
		tool, result, want string
	}{
		{"Read", "1\tone\n2\ttwo\n3\tthree", "3 lines"},
		{"Read", "1\tonly", "1 line"},
		{"Write", "Written 2048 bytes to /repo/x.ts", "2.0 KB"},
		{"Write", "Written 12 bytes to /repo/x.ts", "12 B"},
		{"Edit", "Replaced 1 occurrence(s) in /repo/x.ts", "1 edit"},
		{"Edit", "Replaced 4 occurrence(s) in /repo/x.ts", "4 edits"},
		{"Grep", "(no matches)", "0 hits"},
		{"Grep", "a.ts:1:hit\nb.ts:2:hit", "2 hits"},
		{"Glob", "(no matches)", "0 files"},
		{"Glob", "a.ts\nb.ts\nc.ts", "3 files"},
		{"Bash", "ok", ""},
		{"Bash", "line one\nline two", "2 lines"},
		{"Read", "Error: no such file", ""},
	}
	for _, testCase := range cases {
		if got := summarizeResult(testCase.tool, testCase.result); got != testCase.want {
			t.Errorf("summarizeResult(%s, %q) = %q, want %q", testCase.tool, testCase.result, got, testCase.want)
		}
	}
}

func TestSummarizeResultFitsMetricColumn(t *testing.T) {
	for _, result := range []string{"Written 999999999 bytes to /x", strings.Repeat("line\n", 5000)} {
		if got := summarizeResult("Write", result); len([]rune(got)) > sectionMetricMax {
			t.Fatalf("metric %q exceeds column width %d", got, sectionMetricMax)
		}
	}
}

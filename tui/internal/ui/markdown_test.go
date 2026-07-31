package ui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
)

func TestRenderAgentTextWrapsLongProseToWidth(t *testing.T) {
	long := strings.Repeat("word ", 40)
	out := renderAgentText(long, 20)
	for _, line := range strings.Split(out, "\n") {
		if w := lipgloss.Width(line); w > 20 {
			t.Fatalf("line exceeds width 20 (got %d): %q", w, line)
		}
	}
}

func TestRenderAgentTextFormatsHeadersAndBullets(t *testing.T) {
	src := "## Plan\n- first step\n- second step\n1. do this\n2. then this"
	out := stripANSI(renderAgentText(src, 80))
	if !strings.Contains(out, "Plan") {
		t.Fatalf("missing header text: %s", out)
	}
	if !strings.Contains(out, "• first step") || !strings.Contains(out, "• second step") {
		t.Fatalf("bullets not rendered: %s", out)
	}
	if !strings.Contains(out, "1. do this") {
		t.Fatalf("numbered list not preserved: %s", out)
	}
}

func TestRenderAgentTextPreservesCodeFenceVerbatim(t *testing.T) {
	src := "before\n```go\nfunc main() {\n\tx := 1\n}\n```\nafter"
	out := stripANSI(renderAgentText(src, 10)) // narrow width — code must not wrap/break
	if !strings.Contains(out, "func main() {") {
		t.Fatalf("code fence content mangled: %s", out)
	}
	if !strings.Contains(out, "x := 1") {
		t.Fatalf("code fence lost a line: %s", out)
	}
	if !strings.Contains(out, "go") {
		t.Fatalf("fence language label missing: %s", out)
	}
}

func TestRenderAgentTextInlineCodeAndBold(t *testing.T) {
	plain := stripANSI(renderAgentText("run `go test ./...` and it's **required**", 80))
	if !strings.Contains(plain, "go test ./...") || !strings.Contains(plain, "required") {
		t.Fatalf("inline spans lost their text: %s", plain)
	}
	if strings.Contains(plain, "`") || strings.Contains(plain, "**") {
		t.Fatalf("markdown syntax should be consumed, not left literal: %s", plain)
	}
}

func TestRenderAgentTextNeverPanicsOnEdgeCases(t *testing.T) {
	cases := []string{"", "\n\n\n", "```", "```\nunterminated fence", "# ", "- ", strings.Repeat("*", 200)}
	for _, c := range cases {
		renderAgentText(c, 40)
		renderAgentText(c, 0)
	}
}

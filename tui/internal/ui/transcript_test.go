package ui

import (
	"strings"
	"testing"
)

func TestTranscriptRendersUserAndAgent(t *testing.T) {
	tr := Transcript{
		Turns: []Turn{
			{Role: "user", Text: "hello"},
			{Role: "agent", Text: "hi there", Sections: []Section{
				{Name: "read", Arg: "a.go", State: SectionDone},
			}},
		},
	}
	out := stripANSI(tr.Render(80, 0))
	if !strings.Contains(out, "hello") {
		t.Fatal("missing user text")
	}
	if !strings.Contains(out, "hi there") {
		t.Fatal("missing agent text")
	}
	if !strings.Contains(out, "read") {
		t.Fatal("missing section")
	}
}

// stripANSI removes escape sequences so assertions match on plain text.
func stripANSI(s string) string {
	var b strings.Builder
	inEsc := false
	for _, r := range s {
		if r == 0x1b {
			inEsc = true
			continue
		}
		if inEsc {
			if r == 'm' {
				inEsc = false
			}
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

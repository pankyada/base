package ui

import (
	"strings"
	"testing"
	"time"
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

// This is the dead-air gap between sending a message and the first token or
// tool call — without an indicator here the app looks stalled.
func TestTranscriptShowsThinkingBeforeFirstTokenOrTool(t *testing.T) {
	tr := Transcript{Turns: []Turn{
		{Role: "user", Text: "hello"},
		{Role: "agent", Started: time.Now()},
	}}
	out := stripANSI(tr.Render(80, 0))
	if !strings.Contains(out, "thinking") {
		t.Fatalf("expected a thinking indicator while waiting, got: %s", out)
	}
}

func TestTranscriptHidesThinkingOnceTokensArrive(t *testing.T) {
	tr := Transcript{Turns: []Turn{
		{Role: "agent", Text: "partial", Started: time.Now()},
	}}
	out := stripANSI(tr.Render(80, 0))
	if strings.Contains(out, "thinking") {
		t.Fatalf("thinking indicator should clear once text is streaming: %s", out)
	}
}

func TestTranscriptHidesThinkingOnceToolStarts(t *testing.T) {
	tr := Transcript{Turns: []Turn{
		{Role: "agent", Started: time.Now(), Sections: []Section{
			{Name: "read", State: SectionRunning},
		}},
	}}
	out := stripANSI(tr.Render(80, 0))
	if strings.Contains(out, "thinking") {
		t.Fatalf("thinking indicator should clear once a tool is running: %s", out)
	}
}

func TestTranscriptHidesThinkingOnceTurnFinished(t *testing.T) {
	tr := Transcript{Turns: []Turn{
		{Role: "agent", Started: time.Now(), Elapsed: "1.2s"},
	}}
	out := stripANSI(tr.Render(80, 0))
	if strings.Contains(out, "thinking") {
		t.Fatalf("finished turn with no output should not show thinking: %s", out)
	}
}

func TestTranscriptRendersGroupedActivity(t *testing.T) {
	tr := Transcript{Turns: []Turn{{
		Role: "agent",
		Time: "12:00",
		Sections: []Section{
			{Name: "Read", Category: "files", State: SectionDone},
			{Name: "Write", Category: "files", State: SectionDone},
			{Name: "Bash", Category: "exec", State: SectionError, Body: "boom"},
		},
	}}}
	out := stripANSI(tr.Render(80, 0))
	if !strings.Contains(out, "FILES") {
		t.Fatalf("expected FILES group header, got %q", out)
	}
	if !strings.Contains(out, "boom") {
		t.Fatalf("expected standalone error body, got %q", out)
	}
}

func TestRenderWithHitMapLocatesGroupHeaderAndItems(t *testing.T) {
	tr := Transcript{Turns: []Turn{{
		Role: "agent",
		Sections: []Section{
			{Name: "Read", Category: "files", State: SectionDone},
			{Name: "Write", Category: "files", State: SectionDone},
		},
	}}}
	content, hits := tr.RenderWithHitMap(80, 0)
	if content == "" {
		t.Fatal("expected non-empty content")
	}
	var groups, items int
	for _, hit := range hits {
		if hit.GroupKey != "" {
			groups++
		}
		if hit.Item != nil {
			items++
		}
	}
	if groups != 1 || items != 2 {
		t.Fatalf("expected 1 group hit and 2 item hits, got groups=%d items=%d", groups, items)
	}
}

func TestToggleGroupFromHitMapExpandsItems(t *testing.T) {
	tr := Transcript{Turns: []Turn{{
		Role:     "agent",
		Sections: []Section{{Name: "Read", Category: "files", State: SectionDone, Body: "the-body"}},
	}}}
	_, hits := tr.RenderWithHitMap(80, 0)
	for _, hit := range hits {
		if hit.GroupKey == "" {
			continue
		}
		if tr.Turns[hit.TurnIndex].ExpandedGroups == nil {
			tr.Turns[hit.TurnIndex].ExpandedGroups = map[string]bool{}
		}
		tr.Turns[hit.TurnIndex].ExpandedGroups[hit.GroupKey] = true
	}
	if out := stripANSI(tr.Render(80, 0)); !strings.Contains(out, "the-body") {
		t.Fatal("expected group body after toggling hit-map key")
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

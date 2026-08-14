package ui

import (
	"reflect"
	"strings"
	"testing"
	"time"

	"harness-tui/internal/prefs"
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

func TestAgentHeaderSeparatesRoleFromTimestamp(t *testing.T) {
	if got := stripANSI(agentHeader("12:00")); got != "HARNESS ◆ 12:00" {
		t.Fatalf("agent header = %q", got)
	}
	if roleColor("agent") == ColText || ColFaint == ColText {
		t.Fatal("agent header must keep role/header chrome below prose weight")
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

func TestFreshModelLeavesSixSectionReplyOpen(t *testing.T) {
	m := NewModel(&recordingSender{}, "coding", "tester", prefs.Preferences{})
	m.transcript.Turns = []Turn{{Role: "agent", Text: strings.Join([]string{
		"# One\nbody one",
		"# Two\nbody two",
		"# Three\nbody three",
		"# Four\nbody four",
		"# Five\nbody five",
		"# Six\nbody six",
	}, "\n"), Elapsed: "1.0s"}}
	m.reflow()
	out := stripANSI(m.transcript.Render(80, 0))
	if m.density != "full" || m.transcript.Density != "full" {
		t.Fatalf("fresh density model=%q transcript=%q", m.density, m.transcript.Density)
	}
	for _, body := range []string{"body one", "body two", "body three", "body four", "body five", "body six"} {
		if !strings.Contains(out, body) {
			t.Fatalf("default density folded %q: %s", body, out)
		}
	}
}

func TestExplicitDensityPreferenceStillFolds(t *testing.T) {
	for _, density := range []string{"normal", "compact"} {
		m := NewModel(&recordingSender{}, "coding", "tester", prefs.Preferences{DensityMode: density})
		if m.density != density {
			t.Fatalf("existing density %q was overwritten with %q", density, m.density)
		}
		m.transcript.Turns = []Turn{{Role: "agent", Text: "# One\nbody one\n# Two\nbody two\n# Three\nbody three\n# Four\nbody four", Elapsed: "1.0s"}}
		m.reflow()
		if got := stripANSI(m.transcript.Render(80, 0)); strings.Contains(got, "body four") {
			t.Fatalf("compact density left section body open: %s", got)
		}
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

// Activities are indented under the turn header so the agent's words and the
// agent's actions read as two different things.
func TestTranscriptIndentsActivityUnderTurnHeader(t *testing.T) {
	tr := Transcript{Turns: []Turn{{
		Role: "agent",
		Time: "12:00",
		Text: "done",
		Sections: []Section{
			{Name: "Read", Arg: "src/a.go", Category: "files", State: SectionDone},
		},
	}}}
	lines := strings.Split(stripANSI(tr.Render(80, 0)), "\n")
	var header, item string
	for _, line := range lines {
		if strings.Contains(line, "FILES") {
			header = line
		}
		if strings.Contains(line, "src/a.go") {
			item = line
		}
	}
	if !strings.HasPrefix(header, "│"+groupIndent+"▸") {
		t.Fatalf("group header should be indented under the turn header, got %q", header)
	}
	if !strings.HasPrefix(item, "│"+itemIndent) {
		t.Fatalf("item should hang off the group's guide column, got %q", item)
	}
	if !strings.HasPrefix(lines[0], "│") {
		t.Fatalf("turn header should stay at the left margin, got %q", lines[0])
	}
}

func TestRoleGutterPreservesHitMapY(t *testing.T) {
	tr := Transcript{Turns: []Turn{
		{Role: "agent", Sections: []Section{{Name: "Read", Category: "files", State: SectionDone}}},
		{Role: "agent", Sections: []Section{{Name: "Write", Category: "files", State: SectionDone}}},
	}}
	_, hits := tr.RenderWithHitMap(80, 0)
	var rows []int
	for _, hit := range hits {
		rows = append(rows, hit.Y)
	}
	want := []int{1, 2, 5, 6} // same rows as the pre-gutter blocks
	if !reflect.DeepEqual(rows, want) {
		t.Fatalf("role gutter moved hit rows: got=%v want=%v", rows, want)
	}
}

// The hit map sizes rows independently of the group renderer, so the two have
// to agree or every click after a multi-line row lands on the wrong section.
func TestRenderWithHitMapRowsMatchRenderedLines(t *testing.T) {
	tr := Transcript{Turns: []Turn{{
		Role: "agent",
		Sections: []Section{
			{Name: "Read", Arg: "first.go", Category: "files", State: SectionDone, Body: "a\nb\nc", Expanded: true},
			{Name: "Write", Arg: "second.go", Category: "files", State: SectionDone},
		},
	}}}
	content, hits := tr.RenderWithHitMap(80, 0)
	lines := strings.Split(stripANSI(content), "\n")
	for _, hit := range hits {
		if hit.Item == nil {
			continue
		}
		if hit.Y >= len(lines) {
			t.Fatalf("hit row %d out of range (%d lines)", hit.Y, len(lines))
		}
		if !strings.Contains(lines[hit.Y], hit.Item.Arg) {
			t.Fatalf("hit row %d = %q, expected the row for %q", hit.Y, lines[hit.Y], hit.Item.Arg)
		}
	}
}

// A failure has to say what broke without the whole tail of output coming with
// it — the rest stays behind the chevron like any other body.
func TestTranscriptErrorShowsCappedPreview(t *testing.T) {
	body := "line-1\nline-2\nline-3\nline-4\nline-5\nline-6\nline-7"
	tr := Transcript{Turns: []Turn{{
		Role:     "agent",
		Sections: []Section{{Name: "Bash", Arg: "pnpm build", Category: "exec", State: SectionError, Body: body}},
	}}}
	out := stripANSI(tr.Render(80, 0))
	if !strings.Contains(out, "line-1") {
		t.Fatalf("error preview should show the head of the output, got %q", out)
	}
	if strings.Contains(out, "line-7") {
		t.Fatalf("error preview should stop short of the whole body, got %q", out)
	}
	if !strings.Contains(out, "3 more lines") {
		t.Fatalf("error preview should say how much is hidden, got %q", out)
	}
	tr.AllExpanded = true
	if !strings.Contains(stripANSI(tr.Render(80, 0)), "line-7") {
		t.Fatal("expanding should reveal the rest of the error body")
	}
}

// Standalone rows are the ones a user most wants to open, so they need a click
// target of their own — they are not part of any group's item list.
func TestRenderWithHitMapIncludesStandaloneRows(t *testing.T) {
	tr := Transcript{Turns: []Turn{{
		Role:     "agent",
		Sections: []Section{{Name: "Bash", Arg: "pnpm build", Category: "exec", State: SectionError, Body: "boom"}},
	}}}
	_, hits := tr.RenderWithHitMap(80, 0)
	for _, hit := range hits {
		if hit.Item != nil && hit.Item.Name == "Bash" {
			return
		}
	}
	t.Fatal("expected a hit row for the standalone error section")
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

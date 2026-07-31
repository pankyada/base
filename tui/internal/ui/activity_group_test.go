package ui

import (
	"strings"
	"testing"
)

func TestBuildTimelineMergesSameCategory(t *testing.T) {
	sections := []*Section{
		{Name: "Read", Category: "files", State: SectionDone},
		{Name: "Bash", Category: "exec", State: SectionDone},
		{Name: "Write", Category: "files", State: SectionDone},
	}
	timeline := BuildTimeline(sections, nil)
	if len(timeline) != 2 {
		t.Fatalf("expected 2 timeline entries, got %d", len(timeline))
	}
	if timeline[0].Group == nil || timeline[0].Group.Category != "files" {
		t.Fatalf("first entry should be files group, got %+v", timeline[0])
	}
	if len(timeline[0].Group.Items) != 2 || timeline[0].Group.Items[0].Name != "Read" || timeline[0].Group.Items[1].Name != "Write" {
		t.Fatalf("files group items out of order: %+v", timeline[0].Group.Items)
	}
	if timeline[1].Group == nil || timeline[1].Group.Category != "exec" {
		t.Fatalf("second entry should be exec group, got %+v", timeline[1])
	}
}

func TestBuildTimelinePopsOutErrorsAndApprovals(t *testing.T) {
	sections := []*Section{
		{Name: "Read", Category: "files", State: SectionDone},
		{Name: "Bash", Category: "exec", State: SectionError},
		{Name: "Write", Category: "files", State: SectionDone},
		{Name: "GitPush", Category: "misc", State: SectionRunning, AwaitingApproval: true},
	}
	timeline := BuildTimeline(sections, nil)
	if len(timeline) != 3 {
		t.Fatalf("expected 3 timeline entries, got %d: %+v", len(timeline), timeline)
	}
	if timeline[0].Group == nil || timeline[0].Group.Category != "files" {
		t.Fatalf("entry 0 should be files group, got %+v", timeline[0])
	}
	if timeline[1].Standalone == nil || timeline[1].Standalone.Name != "Bash" {
		t.Fatalf("entry 1 should be standalone Bash, got %+v", timeline[1])
	}
	if timeline[2].Standalone == nil || timeline[2].Standalone.Name != "GitPush" {
		t.Fatalf("entry 2 should be standalone GitPush, got %+v", timeline[2])
	}
}

func TestBuildTimelineMCPGroupsPerServer(t *testing.T) {
	sections := []*Section{
		{Name: "chrome__navigate", Category: "mcp", State: SectionDone},
		{Name: "github__list_prs", Category: "mcp", State: SectionDone},
		{Name: "chrome__click", Category: "mcp", State: SectionDone},
	}
	timeline := BuildTimeline(sections, nil)
	if len(timeline) != 2 {
		t.Fatalf("expected 2 mcp groups, got %d", len(timeline))
	}
	if timeline[0].Group.Label != "MCP · chrome" || len(timeline[0].Group.Items) != 2 {
		t.Fatalf("chrome group = %+v", timeline[0].Group)
	}
}

func TestBuildTimelineSeedsExpandedFromMap(t *testing.T) {
	sections := []*Section{{Name: "Read", Category: "files", State: SectionDone}}
	timeline := BuildTimeline(sections, nil)
	if timeline[0].Group.Expanded {
		t.Fatal("expected collapsed by default")
	}
	key := timeline[0].Group.Key
	timeline = BuildTimeline(sections, map[string]bool{key: true})
	if !timeline[0].Group.Expanded {
		t.Fatalf("expected group %q expanded", key)
	}
}

func TestActivityGroupRenderShowsHeaderAndCount(t *testing.T) {
	group := &ActivityGroup{
		Category: "files",
		Label:    "FILES",
		Items: []*Section{
			{Name: "Read", State: SectionDone, Category: "files"},
			{Name: "Write", State: SectionDone, Category: "files"},
		},
	}
	out := stripANSI(group.Render(60, 0, false))
	if !strings.Contains(out, "FILES") || !strings.Contains(out, "2 ops") {
		t.Fatalf("expected header label/count, got %q", out)
	}
	if !strings.Contains(out, "Read") || !strings.Contains(out, "Write") {
		t.Fatalf("expected item names, got %q", out)
	}
}

func TestActivityGroupExpandedShowsBodies(t *testing.T) {
	group := &ActivityGroup{
		Category: "files",
		Label:    "FILES",
		Items:    []*Section{{Name: "Read", State: SectionDone, Category: "files", Body: "line-one\nline-two"}},
	}
	if strings.Contains(stripANSI(group.Render(60, 0, false)), "line-one") {
		t.Fatal("collapsed group should hide item body")
	}
	group.Expanded = true
	if !strings.Contains(stripANSI(group.Render(60, 0, false)), "line-one") {
		t.Fatal("expanded group should show item body")
	}
}

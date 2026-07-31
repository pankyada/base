# TUI Activity Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group transcript tool-call sections by category (files/exec/memory/agents/mcp/misc), color-code by category, default-collapse group items, pop errors/awaiting-approval items out of their group, and support mouse click-to-toggle.

**Architecture:** Pure rendering-time transform. `Section` (in `tui/internal/ui/section.go`) gains a `Category` field and an `AwaitingApproval` flag, both set in `model.go`'s message handlers (no protocol/server changes). A new `activity_group.go` builds an ordered `[]TimelineEntry` from a turn's flat `[]Section` — each entry is either a merged `*ActivityGroup` (all sections sharing a category) or a standalone `*Section` (error/awaiting-approval, rendered inline, never grouped). `transcript.go` renders the timeline instead of the flat section list. Mouse support is added via `tea.WithMouseCellMotion()` in `main.go` plus a hit-map built alongside the render pass in `model.go`.

**Tech Stack:** Go, Bubble Tea, Lipgloss (existing stack, no new dependencies).

## Global Constraints

- No changes to the WS protocol, agent loop, or server (`src/`) — this is a `tui/` client-only change.
- Categories: `files` (Read/Write/Edit/Glob/Grep), `exec` (Bash/ExecuteCode), `memory` (Memory*), `agents` (Delegate/DelegateFanout), `mcp` (name contains `__`, grouped per server prefix), `misc` (everything else).
- Category color only applies when a section is in `SectionDone`/`SectionQueued` state; `SectionRunning`/`SectionError` always keep their existing state color regardless of category.
- Grouping: all sections of a turn sharing a category (and, for `mcp`, the same server) merge into one `ActivityGroup`, in first-occurrence order; items keep original append order within the group.
- Sections in `SectionError` state or with `AwaitingApproval == true` are excluded from grouping and rendered standalone, inline, always expanded, at the timeline position they occurred.
- Existing global `^O` (`AllExpanded`) must keep working on top of the new per-group/per-item state.
- New theme colors: `Teal` (agents), `Rose` (mcp), added to all three themes (`ember`, `mono`, `neon`).

---

### Task 1: Section category + awaiting-approval fields

**Files:**
- Modify: `tui/internal/ui/section.go`
- Test: `tui/internal/ui/section_test.go`

**Interfaces:**
- Produces: `func categorize(toolName string) (category, label string)` — pure function, category is one of `"files"|"exec"|"memory"|"agents"|"mcp"|"misc"`; label is the display label (`"FILES"`, `"MCP · chrome"`, etc). For `mcp` names (`server__tool`), label is `"MCP · " + server`.
- Produces: `Section.Category string` and `Section.AwaitingApproval bool` fields.
- Produces: `func (s Section) categoryStyle() lipgloss.Style` — returns the category-based style for `Done`/`Queued` states; state color still wins in `color()` for `Running`/`Error`.

- [ ] **Step 1: Write the failing test for `categorize`**

```go
func TestCategorize(t *testing.T) {
	cases := []struct {
		name, wantCat, wantLabel string
	}{
		{"Read", "files", "FILES"},
		{"Write", "files", "FILES"},
		{"Edit", "files", "FILES"},
		{"Glob", "files", "FILES"},
		{"Grep", "files", "FILES"},
		{"Bash", "exec", "EXEC"},
		{"ExecuteCode", "exec", "EXEC"},
		{"MemoryRead", "memory", "MEMORY"},
		{"MemoryWrite", "memory", "MEMORY"},
		{"Delegate", "agents", "AGENTS"},
		{"DelegateFanout", "agents", "AGENTS"},
		{"chrome__navigate", "mcp", "MCP · chrome"},
		{"github__create_pr", "mcp", "MCP · github"},
		{"Skill", "misc", "MISC"},
		{"TodoWrite", "misc", "MISC"},
		{"SomeUnknownTool", "misc", "MISC"},
	}
	for _, c := range cases {
		gotCat, gotLabel := categorize(c.name)
		if gotCat != c.wantCat || gotLabel != c.wantLabel {
			t.Errorf("categorize(%q) = (%q, %q), want (%q, %q)", c.name, gotCat, gotLabel, c.wantCat, c.wantLabel)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && go test ./internal/ui/... -run TestCategorize -v`
Expected: FAIL — `categorize` undefined.

- [ ] **Step 3: Implement `categorize` and the new `Section` fields**

Add to `section.go`:

```go
var categoryLabels = map[string]string{
	"files":  "FILES",
	"exec":   "EXEC",
	"memory": "MEMORY",
	"agents": "AGENTS",
	"misc":   "MISC",
}

var toolCategory = map[string]string{
	"Read": "files", "Write": "files", "Edit": "files", "Glob": "files", "Grep": "files",
	"Bash": "exec", "ExecuteCode": "exec",
	"MemoryRead": "memory", "MemoryWrite": "memory", "MemoryList": "memory",
	"MemoryDelete": "memory", "MemoryLinked": "memory",
	"Delegate": "agents", "DelegateFanout": "agents",
}

func categorize(toolName string) (category, label string) {
	if idx := strings.Index(toolName, "__"); idx >= 0 {
		server := toolName[:idx]
		return "mcp", "MCP · " + server
	}
	if cat, ok := toolCategory[toolName]; ok {
		return cat, categoryLabels[cat]
	}
	return "misc", categoryLabels["misc"]
}
```

Add fields to the `Section` struct:

```go
type Section struct {
	Name             string
	Arg              string
	Metric           string
	Body             string
	State            SectionState
	Expanded         bool
	Motion           bool
	RevealAt         int
	Category         string // set at creation via categorize()
	AwaitingApproval bool   // true between tool_prompt and its resolution
}
```

Add `categoryStyle`:

```go
func (s Section) categoryStyle() lipgloss.Style {
	switch s.Category {
	case "files":
		return lipgloss.NewStyle().Foreground(ColPurple)
	case "exec":
		return lipgloss.NewStyle().Foreground(ColAccent)
	case "memory":
		return lipgloss.NewStyle().Foreground(ColInfo)
	case "agents":
		return lipgloss.NewStyle().Foreground(ColTeal)
	case "mcp":
		return lipgloss.NewStyle().Foreground(ColRose)
	default:
		return StFaint
	}
}
```

Update `color()` so category only applies to the two "at rest" states:

```go
func (s Section) color() lipgloss.Style {
	switch s.State {
	case SectionRunning:
		return StAccent
	case SectionError:
		return StErr
	case SectionDone:
		return s.categoryStyle()
	default:
		return s.categoryStyle()
	}
}
```

(This step will not compile yet — `ColTeal`/`ColRose` don't exist. That's Task 2.)

- [ ] **Step 4: Commit is deferred to end of Task 2** (fields and `color()` depend on the new palette colors compiling together).

---

### Task 2: Theme palette — Teal and Rose

**Files:**
- Modify: `tui/internal/ui/theme.go`
- Test: `tui/internal/ui/theme_test.go` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Theme.Teal string`, `Theme.Rose string` fields; `ColTeal`, `ColRose lipgloss.Color` package vars; `StTeal`, `StRose lipgloss.Style` package vars; both set in `ApplyTheme`.

- [ ] **Step 1: Write the failing test**

```go
package ui

import "testing"

func TestApplyThemeSetsTealAndRose(t *testing.T) {
	for name := range Themes {
		ApplyTheme(name)
		if ColTeal == "" {
			t.Fatalf("theme %q: ColTeal not set", name)
		}
		if ColRose == "" {
			t.Fatalf("theme %q: ColRose not set", name)
		}
	}
	ApplyTheme("ember")
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && go test ./internal/ui/... -run TestApplyThemeSetsTealAndRose -v`
Expected: FAIL — compile error, `ColTeal`/`ColRose` undefined.

- [ ] **Step 3: Add the fields, palette entries, and assignments**

In `theme.go`, extend the `Theme` struct:

```go
type Theme struct {
	Name, Bg, Panel, Border, BorderHi, Purple, Text, Dim, Faint, Accent, OK, Error, Info, Teal, Rose string
}
```

Extend each theme entry (append `Teal`/`Rose` hexes chosen for contrast against that theme's `Bg`):

```go
var Themes = map[string]Theme{
	"ember": {Name: "ember", Bg: "#0b0c0e", Panel: "#111317", Border: "#262b33", BorderHi: "#3a414e", Purple: "#b394e0", Text: "#e7e9ee", Dim: "#99a0ad", Faint: "#595f6b", Accent: "#f1a44d", OK: "#74c79a", Error: "#e87f8d", Info: "#6cb6d9", Teal: "#5fb8a8", Rose: "#e0a1c4"},
	"mono":  {Name: "mono", Bg: "#080808", Panel: "#151515", Border: "#363636", BorderHi: "#585858", Purple: "#c0c0c0", Text: "#eeeeee", Dim: "#aaaaaa", Faint: "#666666", Accent: "#dddddd", OK: "#bbbbbb", Error: "#ffffff", Info: "#cccccc", Teal: "#999999", Rose: "#d4d4d4"},
	"neon":  {Name: "neon", Bg: "#090817", Panel: "#15112a", Border: "#30265a", BorderHi: "#574698", Purple: "#d08cff", Text: "#f3f2ff", Dim: "#aaa6d9", Faint: "#625b91", Accent: "#ffb86c", OK: "#65ffca", Error: "#ff6b9d", Info: "#65d9ff", Teal: "#5ef2c9", Rose: "#ff9ecf"},
}
```

Add package vars near `ColPurple`:

```go
ColTeal = lipgloss.Color("#5fb8a8")
ColRose = lipgloss.Color("#e0a1c4")
```

Add styles near `StAccent`:

```go
StTeal = lipgloss.NewStyle().Foreground(ColTeal)
StRose = lipgloss.NewStyle().Foreground(ColRose)
```

In `ApplyTheme`, set both:

```go
ColTeal = lipgloss.Color(theme.Teal)
ColRose = lipgloss.Color(theme.Rose)
...
StTeal = lipgloss.NewStyle().Foreground(ColTeal)
StRose = lipgloss.NewStyle().Foreground(ColRose)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tui && go test ./internal/ui/... -run TestApplyThemeSetsTealAndRose -v`
Expected: PASS

- [ ] **Step 5: Run Task 1's test now that the package compiles**

Run: `cd tui && go test ./internal/ui/... -run TestCategorize -v`
Expected: PASS

- [ ] **Step 6: Run full section test file to check nothing broke**

Run: `cd tui && go test ./internal/ui/... -run TestSection -v`
Expected: PASS (existing `TestSectionGlyphStates` still checks glyphs only, unaffected by color change)

- [ ] **Step 7: Commit**

```bash
cd tui && git add internal/ui/section.go internal/ui/section_test.go internal/ui/theme.go internal/ui/theme_test.go
git commit -m "feat(tui): add category field to Section and Teal/Rose theme colors"
```

---

### Task 3: ActivityGroup + timeline builder

**Files:**
- Create: `tui/internal/ui/activity_group.go`
- Test: `tui/internal/ui/activity_group_test.go`

**Interfaces:**
- Consumes: `Section` (with `.Category`, `.State`, `.AwaitingApproval` from Task 1).
- Produces:
  ```go
  type TimelineEntry struct {
      Group     *ActivityGroup // nil if Standalone is set
      Standalone *Section      // nil if Group is set
  }
  type ActivityGroup struct {
      Category string
      Label    string
      Key      string // category+"|"+Label — stable identity across renders
      Items    []*Section
      Expanded bool
  }
  func BuildTimeline(sections []*Section, expanded map[string]bool) []TimelineEntry
  ```
  `BuildTimeline` allocates a **new** `*ActivityGroup` on every call (grouping is
  recomputed at render time — see Task 5's rationale). That means `Expanded`
  cannot be stored durably on the `ActivityGroup` itself: it must be seeded from
  the caller-supplied `expanded map[string]bool` (keyed by `Key`), which lives
  on `Turn` (Task 5) and is what actually persists across renders. `Group.Key`
  is included so callers (the hit-map in Task 7) can toggle the right map entry
  without needing to compare `Category`+`Label` themselves.
  `BuildTimeline` is used by `transcript.go` (Task 5) and by the hit-map builder (Task 7).

- [ ] **Step 1: Write the failing tests**

```go
package ui

import "testing"

func TestBuildTimelineMergesSameCategory(t *testing.T) {
	sections := []*Section{
		{Name: "Read", Category: "files", State: SectionDone},
		{Name: "Bash", Category: "exec", State: SectionDone},
		{Name: "Write", Category: "files", State: SectionDone},
	}
	timeline := BuildTimeline(sections, nil)
	if len(timeline) != 2 {
		t.Fatalf("expected 2 timeline entries (files, exec), got %d", len(timeline))
	}
	if timeline[0].Group == nil || timeline[0].Group.Category != "files" {
		t.Fatalf("first entry should be the files group (first occurrence), got %+v", timeline[0])
	}
	if len(timeline[0].Group.Items) != 2 {
		t.Fatalf("files group should have 2 items (Read, Write), got %d", len(timeline[0].Group.Items))
	}
	if timeline[0].Group.Items[0].Name != "Read" || timeline[0].Group.Items[1].Name != "Write" {
		t.Fatalf("files group items out of order: %+v", timeline[0].Group.Items)
	}
	if timeline[1].Group == nil || timeline[1].Group.Category != "exec" {
		t.Fatalf("second entry should be the exec group, got %+v", timeline[1])
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
	// files group (Read, Write), standalone Bash (error), standalone GitPush (awaiting approval)
	if len(timeline) != 3 {
		t.Fatalf("expected 3 timeline entries, got %d: %+v", len(timeline), timeline)
	}
	if timeline[0].Group == nil || timeline[0].Group.Category != "files" {
		t.Fatalf("entry 0 should be files group, got %+v", timeline[0])
	}
	if timeline[1].Standalone == nil || timeline[1].Standalone.Name != "Bash" {
		t.Fatalf("entry 1 should be standalone Bash (error), got %+v", timeline[1])
	}
	if timeline[2].Standalone == nil || timeline[2].Standalone.Name != "GitPush" {
		t.Fatalf("entry 2 should be standalone GitPush (awaiting approval), got %+v", timeline[2])
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
		t.Fatalf("expected 2 mcp groups (chrome, github), got %d", len(timeline))
	}
}
```

Note: `categorize` (Task 1) doesn't distinguish MCP servers within the shared `"mcp"` category string, so `BuildTimeline` must key groups by `(category, label)` pair, not category alone — `chrome__navigate` and `github__list_prs` both have `Category: "mcp"` but different labels (`"MCP · chrome"` vs `"MCP · github"`).

Also add a test proving `Expanded` is seeded from the `expanded` map (this is
the mechanism that makes toggling durable across the repeated `BuildTimeline`
calls each render performs):

```go
func TestBuildTimelineSeedsExpandedFromMap(t *testing.T) {
	sections := []*Section{{Name: "Read", Category: "files", State: SectionDone}}
	timeline := BuildTimeline(sections, nil)
	if timeline[0].Group.Expanded {
		t.Fatal("expected collapsed by default when expanded map is nil")
	}
	key := timeline[0].Group.Key
	expanded := map[string]bool{key: true}
	timeline2 := BuildTimeline(sections, expanded)
	if !timeline2[0].Group.Expanded {
		t.Fatalf("expected group with key %q to be seeded Expanded=true", key)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tui && go test ./internal/ui/... -run TestBuildTimeline -v`
Expected: FAIL — `BuildTimeline` undefined.

- [ ] **Step 3: Implement `activity_group.go`**

```go
package ui

// ActivityGroup is a merged run of same-category sections within one turn.
type ActivityGroup struct {
	Category string
	Label    string
	Key      string // category+"|"+Label
	Items    []*Section
	Expanded bool
}

// TimelineEntry is one row in a turn's rendered activity timeline: either a
// merged group or a standalone section (error / awaiting approval) that is
// excluded from grouping so it can never be hidden inside a collapsed group.
type TimelineEntry struct {
	Group      *ActivityGroup
	Standalone *Section
}

func isStandalone(s *Section) bool {
	return s.State == SectionError || s.AwaitingApproval
}

// BuildTimeline merges sections into per-(category,label) groups in
// first-occurrence order, keeping standalone (error/awaiting-approval)
// sections inline at the position they occurred. `expanded` (may be nil)
// seeds each group's Expanded state, keyed by ActivityGroup.Key — this is
// how expansion survives the fact that BuildTimeline allocates fresh
// ActivityGroup values on every call.
func BuildTimeline(sections []*Section, expanded map[string]bool) []TimelineEntry {
	var timeline []TimelineEntry
	groupIndex := map[string]int{} // key -> index into timeline
	for _, s := range sections {
		if isStandalone(s) {
			timeline = append(timeline, TimelineEntry{Standalone: s})
			continue
		}
		_, label := categorize(s.Name)
		key := s.Category + "|" + label
		if idx, ok := groupIndex[key]; ok {
			timeline[idx].Group.Items = append(timeline[idx].Group.Items, s)
			continue
		}
		group := &ActivityGroup{Category: s.Category, Label: label, Key: key, Items: []*Section{s}, Expanded: expanded[key]}
		groupIndex[key] = len(timeline)
		timeline = append(timeline, TimelineEntry{Group: group})
	}
	return timeline
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && go test ./internal/ui/... -run "TestBuildTimeline|TestBuildTimelineSeedsExpandedFromMap" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd tui && git add internal/ui/activity_group.go internal/ui/activity_group_test.go
git commit -m "feat(tui): add ActivityGroup + BuildTimeline for grouped activity rendering"
```

---

### Task 4: ActivityGroup rendering

**Files:**
- Modify: `tui/internal/ui/section.go` (add `ActivityGroup.Render`)
- Test: `tui/internal/ui/activity_group_test.go`

**Interfaces:**
- Consumes: `ActivityGroup`, `Section.Render(width, frame int, allExpanded bool) string` (existing).
- Produces: `func (g *ActivityGroup) Render(width, frame int, allExpanded bool) string`.

- [ ] **Step 1: Write the failing test**

```go
func TestActivityGroupRenderShowsHeaderAndCount(t *testing.T) {
	g := &ActivityGroup{
		Category: "files",
		Label:    "FILES",
		Items: []*Section{
			{Name: "Read", State: SectionDone, Category: "files"},
			{Name: "Write", State: SectionDone, Category: "files"},
		},
	}
	out := stripANSI(g.Render(60, 0, false))
	if !strings.Contains(out, "FILES") || !strings.Contains(out, "2") {
		t.Fatalf("expected header with label and count, got %q", out)
	}
	if !strings.Contains(out, "Read") || !strings.Contains(out, "Write") {
		t.Fatalf("expected both item names rendered, got %q", out)
	}
}

func TestActivityGroupExpandedShowsBodies(t *testing.T) {
	g := &ActivityGroup{
		Category: "files",
		Label:    "FILES",
		Items:    []*Section{{Name: "Read", State: SectionDone, Category: "files", Body: "line-one\nline-two"}},
	}
	collapsed := stripANSI(g.Render(60, 0, false))
	if strings.Contains(collapsed, "line-one") {
		t.Fatal("collapsed group should not show item body")
	}
	g.Expanded = true
	expanded := stripANSI(g.Render(60, 0, false))
	if !strings.Contains(expanded, "line-one") {
		t.Fatal("expanded group should show item body")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tui && go test ./internal/ui/... -run TestActivityGroup -v`
Expected: FAIL — `ActivityGroup.Render` undefined.

- [ ] **Step 3: Implement `Render` in `activity_group.go`**

```go
func (g *ActivityGroup) Render(width, frame int, allExpanded bool) string {
	style := lipgloss.NewStyle().Foreground(categoryColor(g.Category))
	header := style.Render(g.Label) + StDim.Render(fmt.Sprintf(" · %d ops", len(g.Items)))
	lines := []string{header}
	forceOpen := g.Expanded || allExpanded
	for _, item := range g.Items {
		lines = append(lines, "  "+item.Render(maxInt(0, width-2), frame, forceOpen))
	}
	return lipgloss.JoinVertical(lipgloss.Left, lines...)
}

func categoryColor(category string) lipgloss.Color {
	switch category {
	case "files":
		return ColPurple
	case "exec":
		return ColAccent
	case "memory":
		return ColInfo
	case "agents":
		return ColTeal
	case "mcp":
		return ColRose
	default:
		return ColFaint
	}
}
```

Requires `"fmt"` import in `activity_group.go`. Also update `Section.categoryStyle()` (Task 1) to call `categoryColor` instead of duplicating the switch:

```go
func (s Section) categoryStyle() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(categoryColor(s.Category))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && go test ./internal/ui/... -run TestActivityGroup -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd tui && git add internal/ui/activity_group.go internal/ui/activity_group_test.go internal/ui/section.go
git commit -m "feat(tui): render ActivityGroup header + indented collapsed items"
```

---

### Task 5: Wire timeline into Transcript rendering

**Files:**
- Modify: `tui/internal/ui/transcript.go`
- Test: `tui/internal/ui/transcript_test.go`

**Interfaces:**
- Consumes: `BuildTimeline([]*Section, map[string]bool) []TimelineEntry` (Task 3), `ActivityGroup.Render` (Task 4), existing `Section.Render`.
- Produces: `Turn` gains `ExpandedGroups map[string]bool` (nil until a group is first toggled — Task 7 is what actually populates it; this task only needs to read it and pass it through). No change to `Turn.Sections []Section` (kept as-is — still the source of truth appended to by `model.go`); `Transcript.Render` now derives the timeline from `t.Sections` + `t.ExpandedGroups` at render time instead of ranging over sections directly.

Rationale for keeping `Turn.Sections []Section` unchanged: `model.go`'s `tool_start`/`tool_end` handlers mutate sections by index in place (`&agent.Sections[i]`) to flip `Running` → `Done`/`Error`. Rebuilding the timeline at render time (rather than maintaining `Turn.Groups` incrementally) avoids touching that pointer-stability-sensitive code in this task, and keeps grouping a pure, independently-testable function of the current section list. The tradeoff — `ActivityGroup` values are recreated every render — is exactly why `ExpandedGroups` has to live on `Turn` rather than on the transient group (see Task 3).

Add the field to the `Turn` struct in `transcript.go`:

```go
type Turn struct {
	Role           string
	Text           string
	Time           string
	Sections       []Section
	ExpandedGroups map[string]bool // keyed by ActivityGroup.Key; nil until first toggle
	Tokens         int
	Cost           float64
	Elapsed        string
	Started        time.Time
	Pulse          int
}
```

- [ ] **Step 1: Write the failing test**

```go
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
		t.Fatalf("expected standalone error body visible inline, got %q", out)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && go test ./internal/ui/... -run TestTranscriptRendersGroupedActivity -v`
Expected: FAIL — no `FILES` header in output (current code renders flat sections).

- [ ] **Step 3: Update `Transcript.Render`'s agent branch**

Replace the section-rendering loop in `transcript.go`:

```go
// before:
// for _, s := range t.Sections {
//     parts = append(parts, s.Render(width, frame, tr.AllExpanded))
// }

// after:
sectionPtrs := make([]*Section, len(t.Sections))
for i := range t.Sections {
	sectionPtrs[i] = &t.Sections[i]
}
for _, entry := range BuildTimeline(sectionPtrs, t.ExpandedGroups) {
	if entry.Group != nil {
		parts = append(parts, entry.Group.Render(width, frame, tr.AllExpanded))
	} else {
		parts = append(parts, entry.Standalone.Render(width, frame, true)) // standalone always open
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tui && go test ./internal/ui/... -run TestTranscriptRendersGroupedActivity -v`
Expected: PASS

- [ ] **Step 5: Run full existing transcript test suite for regressions**

Run: `cd tui && go test ./internal/ui/... -run TestTranscript -v`
Expected: PASS — check output carefully; if any existing test asserted on exact section count/formatting in the old flat style, update its expectations to match grouped output (it should now expect a category header for grouped items).

- [ ] **Step 6: Commit**

```bash
cd tui && git add internal/ui/transcript.go internal/ui/transcript_test.go
git commit -m "feat(tui): render transcript activity as grouped timeline"
```

---

### Task 6: Wire category + awaiting-approval into model.go message handlers

**Files:**
- Modify: `tui/internal/ui/model.go:1170-1192` (tool_start/tool_end), `:1229-1232` (tool_prompt), `:415-433` (approve/deny handlers)
- Test: `tui/internal/ui/model_test.go`

**Interfaces:**
- Consumes: `categorize` (Task 1), `Section.AwaitingApproval` (Task 1).
- Produces: no new exported symbols; behavior change only.

- [ ] **Step 1: Write the failing test**

```go
func TestToolStartSetsCategory(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.handleServerMessage(protocol.ServerMessage{Type: "session_ready", SessionID: "sess-1"})
	m.handleServerMessage(protocol.ServerMessage{Type: "tool_start", Name: "Read", Input: map[string]interface{}{"path": "foo.go"}})
	agent := m.currentAgent()
	if len(agent.Sections) != 1 {
		t.Fatalf("expected 1 section, got %d", len(agent.Sections))
	}
	if agent.Sections[0].Category != "files" {
		t.Fatalf("expected category files, got %q", agent.Sections[0].Category)
	}
}

func TestToolPromptMarksAwaitingApproval(t *testing.T) {
	sender := &recordingSender{}
	m := NewModel(sender, "devops", "tester", prefs.Preferences{})
	m.handleServerMessage(protocol.ServerMessage{Type: "session_ready", SessionID: "sess-1"})
	m.handleServerMessage(protocol.ServerMessage{Type: "tool_start", Name: "Bash", Input: map[string]interface{}{}})
	m.handleServerMessage(protocol.ServerMessage{Type: "tool_prompt", ID: "1", Name: "Bash", Input: map[string]interface{}{}})
	agent := m.currentAgent()
	if !agent.Sections[0].AwaitingApproval {
		t.Fatal("expected running Bash section to be marked AwaitingApproval")
	}
}
```

This reuses the exact `recordingSender`/`NewModel(sender, "devops", "tester", prefs.Preferences{})` construction already used by `TestModelStreamsTurnAndResolvesTool` in `model_test.go:21-23`, and the real `(m *Model) handleServerMessage(msg protocol.ServerMessage)` at `model.go:1098`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tui && go test ./internal/ui/... -run "TestToolStartSetsCategory|TestToolPromptMarksAwaitingApproval" -v`
Expected: FAIL — `Category` empty / `AwaitingApproval` false.

- [ ] **Step 3: Update `tool_start` handler** (around `model.go:1175`)

```go
case "tool_start":
	m.running = true
	m.activeTool = msg.Name
	m.activeToolStarted = time.Now()
	agent := m.currentAgent()
	cat, _ := categorize(msg.Name)
	agent.Sections = append(agent.Sections, Section{
		Name: msg.Name, Arg: summarizeInput(msg.Input), State: SectionRunning,
		Motion: m.transcript.Motion, RevealAt: -1, Category: cat,
	})
```

- [ ] **Step 4: Update `tool_prompt` handler** (around `model.go:1229`)

```go
case "tool_prompt":
	m.pendingApproval = &ApprovalRequest{ID: msg.ID, Name: msg.Name, Input: msg.Input, Risk: msg.Risk, Reason: msg.Reason}
	agent := m.currentAgent()
	for i := len(agent.Sections) - 1; i >= 0; i-- {
		section := &agent.Sections[i]
		if section.Name == msg.Name && section.State == SectionRunning {
			section.AwaitingApproval = true
			break
		}
	}
```

- [ ] **Step 5: Clear `AwaitingApproval` on approve/deny** — update `func (m Model) updateApproval(msg tea.KeyMsg) (tea.Model, tea.Cmd)` at `model.go:414-433`:

```go
func (m Model) updateApproval(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	decision := msg.String()
	clearAwaitingApproval := func() {
		agent := m.currentAgent()
		for i := range agent.Sections {
			if agent.Sections[i].Name == m.pendingApproval.Name && agent.Sections[i].AwaitingApproval {
				agent.Sections[i].AwaitingApproval = false
				break
			}
		}
	}
	if decision == "n" || decision == "esc" {
		clearAwaitingApproval()
		m.send(protocol.ToolDeny(m.pendingApproval.ID))
		m.pendingApproval = nil
		m.notices.Add(NoticeWarn, "tool denied", "request declined", "")
		m.reflow()
		return m, nil
	}
	if decision == "y" || decision == "enter" || decision == "a" {
		clearAwaitingApproval()
		id := m.pendingApproval.ID
		if decision == "a" {
			m.approvalMode = "yolo"
			m.send(protocol.SetApprovalMode("yolo"))
			m.notices.Add(NoticeWarn, "yolo enabled", "future tools run without approval", "set /approval danger to restore prompts")
		}
		m.send(protocol.ToolApprove(id))
		m.pendingApproval = nil
		m.reflow()
	}
	return m, nil
}
```

Only the two `clearAwaitingApproval()` calls and the new closure are additions — every other line already exists verbatim in `updateApproval`, shown here in full so the diff is unambiguous.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd tui && go test ./internal/ui/... -run "TestToolStartSetsCategory|TestToolPromptMarksAwaitingApproval" -v`
Expected: PASS

- [ ] **Step 7: Run the full Go test suite for regressions**

Run: `cd tui && go test ./...`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
cd tui && git add internal/ui/model.go internal/ui/model_test.go
git commit -m "feat(tui): categorize sections on tool_start, track awaiting-approval state"
```

---

### Task 7: Mouse click-to-toggle

**Files:**
- Modify: `tui/main.go` (enable mouse mode)
- Modify: `tui/internal/ui/transcript.go` (hit-map)
- Modify: `tui/internal/ui/model.go` (handle `tea.MouseMsg`)
- Test: `tui/internal/ui/transcript_test.go`

**Interfaces:**
- Produces:
  ```go
  type HitRow struct {
      Y         int    // 0-indexed row within the rendered transcript content
      TurnIndex int     // index into Transcript.Turns — which turn's ExpandedGroups to mutate
      GroupKey  string  // ActivityGroup.Key; empty if this row is an Item row instead
      Item      *Section // set if this row is an item line (not standalone, not a group header)
  }
  func (tr Transcript) RenderWithHitMap(width, frame int) (string, []HitRow)
  ```
- Consumes: `BuildTimeline`, `ActivityGroup.Render`, `Section.Render` (all prior tasks).

Note: a `HitRow` carries `TurnIndex` + `GroupKey` for group headers instead of
a `*ActivityGroup` pointer — the group object is recreated every render
(Task 3), so a stored pointer would go stale immediately. `Item` can stay a
direct `*Section` pointer because `Section` values are NOT recreated per
render — they live in `Turn.Sections` and `BuildTimeline` only holds
references to them.

- [ ] **Step 1: Write the failing test**

```go
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
	var sawGroup, sawItems int
	for _, h := range hits {
		if h.GroupKey != "" {
			sawGroup++
		}
		if h.Item != nil {
			sawItems++
		}
	}
	if sawGroup != 1 {
		t.Fatalf("expected exactly 1 group-header hit row, got %d", sawGroup)
	}
	if sawItems != 2 {
		t.Fatalf("expected 2 item hit rows, got %d", sawItems)
	}
}

func TestToggleGroupFromHitMapExpandsItems(t *testing.T) {
	tr := Transcript{Turns: []Turn{{
		Role: "agent",
		Sections: []Section{{Name: "Read", Category: "files", State: SectionDone, Body: "the-body"}},
	}}}
	_, hits := tr.RenderWithHitMap(80, 0)
	for _, h := range hits {
		if h.GroupKey != "" {
			if tr.Turns[h.TurnIndex].ExpandedGroups == nil {
				tr.Turns[h.TurnIndex].ExpandedGroups = map[string]bool{}
			}
			tr.Turns[h.TurnIndex].ExpandedGroups[h.GroupKey] = true
		}
	}
	out := stripANSI(tr.Render(80, 0))
	if !strings.Contains(out, "the-body") {
		t.Fatal("expected group body visible after toggling ExpandedGroups via hit-map key")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tui && go test ./internal/ui/... -run "TestRenderWithHitMap|TestToggleGroupFromHitMap" -v`
Expected: FAIL — `RenderWithHitMap` undefined.

- [ ] **Step 3: Implement `RenderWithHitMap` in `transcript.go`**

`BuildTimeline` allocates a **new** `*ActivityGroup` each render call, so the hit-map must return pointers into the *same* group instances used to produce `content` — build both together in one pass instead of calling `BuildTimeline` twice:

Move `Render`'s current body (lines 30-80 of the existing `transcript.go`,
reproduced in the "Current architecture" read earlier — the full `for _, t
:= range tr.Turns` loop handling `"user"`/`"local"`/`"memory"`/agent turns,
the footer, and the thinking indicator) into `RenderWithHitMap` unchanged,
with exactly two additions: a running `row` counter, and hit-row bookkeeping
inside the agent-sections branch. `Render` becomes a one-line wrapper:

```go
func (tr Transcript) Render(width, frame int) string {
	content, _ := tr.RenderWithHitMap(width, frame)
	return content
}

func (tr Transcript) RenderWithHitMap(width, frame int) (string, []HitRow) {
	var blocks []string
	var hits []HitRow
	row := 0
	for turnIdx, t := range tr.Turns {
		if t.Role == "user" {
			rendered := userBubble(t, width)
			blocks = append(blocks, rendered)
			row += lipgloss.Height(rendered) + 1 // +1 for the spread() blank line
			continue
		}
		if t.Role == "local" {
			rendered := StDim.Render("LOCAL") + "\n" + StText.Render(t.Text)
			blocks = append(blocks, rendered)
			row += lipgloss.Height(rendered) + 1
			continue
		}
		if t.Role == "memory" {
			rendered := StOK.Render("REMEMBERED") + StDim.Render(" · "+t.Time) + "\n" + StText.Render(t.Text)
			blocks = append(blocks, rendered)
			row += lipgloss.Height(rendered) + 1
			continue
		}
		// agent
		header := StDim.Render("HARNESS ◆ " + t.Time)
		parts := []string{header}
		row += lipgloss.Height(header)
		sectionPtrs := make([]*Section, len(t.Sections))
		for i := range t.Sections {
			sectionPtrs[i] = &t.Sections[i]
		}
		for _, entry := range BuildTimeline(sectionPtrs, t.ExpandedGroups) {
			if entry.Group != nil {
				hits = append(hits, HitRow{Y: row, TurnIndex: turnIdx, GroupKey: entry.Group.Key})
				rendered := entry.Group.Render(width, frame, tr.AllExpanded)
				for i, item := range entry.Group.Items {
					hits = append(hits, HitRow{Y: row + 1 + i, TurnIndex: turnIdx, Item: item})
				}
				parts = append(parts, rendered)
				row += lipgloss.Height(rendered)
			} else {
				rendered := entry.Standalone.Render(width, frame, true)
				parts = append(parts, rendered)
				row += lipgloss.Height(rendered)
			}
		}
		if t.Text == "" && len(t.Sections) == 0 && t.Elapsed == "" && !t.Started.IsZero() {
			glyph := thinkingSpinChar(frame)
			elapsed := fmt.Sprintf("%.0fs", time.Since(t.Started).Seconds())
			line := StAccent.Render(glyph) + " " + StDim.Render("thinking… "+elapsed)
			parts = append(parts, line)
			row += lipgloss.Height(line)
		}
		if t.Text != "" {
			body := renderAgentText(t.Text, width)
			if tr.Motion && t.Elapsed == "" && frame%2 == 0 {
				body += StAccent.Render("▌")
			}
			parts = append(parts, body)
			row += lipgloss.Height(body)
		}
		if t.Tokens > 0 || t.Elapsed != "" || t.Cost > 0 {
			footerStyle := StFaint
			if t.Pulse >= 3 {
				footerStyle = StAccent
			} else if t.Pulse > 0 {
				footerStyle = StOK
			}
			footer := footerStyle.Render(fmt.Sprintf("▌ %d tools · %d tok · %s · $%.4f",
				len(t.Sections), t.Tokens, t.Elapsed, t.Cost))
			parts = append(parts, footer)
			row += lipgloss.Height(footer)
		}
		rendered := lipgloss.JoinVertical(lipgloss.Left, parts...)
		blocks = append(blocks, rendered)
		row++ // spread() blank line
	}
	return lipgloss.JoinVertical(lipgloss.Left, spread(blocks)...), hits
}
```

This is `Render`'s existing per-turn logic (unchanged) with a `row` counter
threaded through and hit-row bookkeeping added only in the agent
`BuildTimeline` loop — every other branch keeps its original rendering,
just with `row` advanced by `lipgloss.Height` of whatever it appended. Note
`entry.Group.Items[i]` (a `*Section` into the group's item list) is used
directly as `HitRow.Item` — since `Section` values aren't recreated per
render (only `ActivityGroup` is), this pointer stays valid to toggle
(`Toggle()` has a pointer receiver, mutating the real `Turn.Sections[i]`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && go test ./internal/ui/... -run "TestRenderWithHitMap|TestToggleGroupFromHitMap" -v`
Expected: PASS

- [ ] **Step 5: Run full transcript + section suite for regressions**

Run: `cd tui && go test ./internal/ui/...`
Expected: PASS

- [ ] **Step 6: Enable mouse mode in `main.go`**

Find the `tea.NewProgram(...)` call and add the option:

```go
p := tea.NewProgram(model, tea.WithAltScreen(), tea.WithMouseCellMotion())
```

(Match whatever options already exist at that call site — add `tea.WithMouseCellMotion()` alongside them, don't replace them.)

- [ ] **Step 7: Handle `tea.MouseMsg` in `model.go`'s `Update`**

Add a case to the top-level message switch in `Update` (find the existing `switch msg := msg.(type)` in `model.go`):

```go
case tea.MouseMsg:
	if msg.Action != tea.MouseActionRelease || msg.Button != tea.MouseButtonLeft {
		return m, nil
	}
	// View() stacks topBar(...) directly above m.viewport.View() (model.go:1319-1321,
	// no notices/composer above it), so that's the only chrome row offset to subtract.
	topBarHeight := lipgloss.Height(topBar(m.profile, m.sessionID, m.connected, m.running, m.frame, time.Now(), m.width))
	clickRow := msg.Y - topBarHeight + m.viewport.YOffset
	if clickRow < 0 {
		return m, nil
	}
	_, hits := m.transcript.RenderWithHitMap(m.viewport.Width, m.frame)
	for _, h := range hits {
		if h.Y != clickRow {
			continue
		}
		if h.GroupKey != "" {
			turn := &m.transcript.Turns[h.TurnIndex]
			if turn.ExpandedGroups == nil {
				turn.ExpandedGroups = map[string]bool{}
			}
			turn.ExpandedGroups[h.GroupKey] = !turn.ExpandedGroups[h.GroupKey]
		} else if h.Item != nil {
			h.Item.Toggle()
		}
		m.reflow()
		break
	}
	return m, nil
```

`topBar(...)` is the exact call already used in `View()` at `model.go:1320` — reusing it here (rather than inventing a new offset accessor) guarantees the click coordinate maps to the same row the viewport itself treats as `Y=0`.

- [ ] **Step 8: Manual verification** (mouse input can't be driven by `go test`)

Run: `cd tui && go build ./... && go run . ` (or `pnpm dev:tui` from repo root) against a running server, send a message that triggers 2+ same-category tool calls (e.g. ask it to read two files), and click the group header — confirm item bodies expand/collapse, and clicking a single item toggles only that item.

- [ ] **Step 9: Commit**

```bash
cd tui && git add main.go internal/ui/transcript.go internal/ui/transcript_test.go internal/ui/model.go
git commit -m "feat(tui): click-to-toggle activity groups and items via mouse hit-map"
```

---

## Post-implementation check

- [ ] Re-read `docs/superpowers/specs/2026-08-01-tui-activity-grouping-design.md` §1-4 and confirm each is covered: data model (Task 1, 3), colors (Task 2, 4), collapse defaults + pop-out (Task 3, 5, 6), mouse interaction (Task 7).
- [ ] `cd tui && go test ./...` passes in full.
- [ ] `cd tui && go build ./...` succeeds.

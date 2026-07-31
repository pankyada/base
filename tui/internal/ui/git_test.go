package ui

import "testing"

func TestParseGitStatusReadsBranchAheadBehindAndCounts(t *testing.T) {
	output := `# branch.oid abc123
# branch.head feature/rail
# branch.upstream origin/feature/rail
# branch.ab +3 -2
1 M. N... 100644 100644 100644 aaa bbb src/one.go
1 .M N... 100644 100644 100644 aaa bbb src/two.go
1 MM N... 100644 100644 100644 aaa bbb src/three.go
2 R. N... 100644 100644 100644 aaa bbb R100 new.go	old.go
u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.go
? untracked.go
? another.go`

	state := parseGitStatus(output)
	if !state.Repo || !state.Checked {
		t.Fatal("parsed status should be a checked repository")
	}
	if state.Branch != "feature/rail" || state.Upstream != "origin/feature/rail" {
		t.Fatalf("branch=%q upstream=%q", state.Branch, state.Upstream)
	}
	if state.Ahead != 3 || state.Behind != 2 {
		t.Fatalf("ahead=%d behind=%d, want 3/2", state.Ahead, state.Behind)
	}
	// M. and MM and R. are staged; .M and MM are unstaged.
	if state.Staged != 3 {
		t.Fatalf("staged=%d, want 3", state.Staged)
	}
	if state.Unstaged != 2 {
		t.Fatalf("unstaged=%d, want 2", state.Unstaged)
	}
	if state.Untracked != 2 {
		t.Fatalf("untracked=%d, want 2", state.Untracked)
	}
	if state.Conflicts != 1 {
		t.Fatalf("conflicts=%d, want 1", state.Conflicts)
	}
	if !state.Dirty() {
		t.Fatal("a tree with changes must report dirty")
	}
}

func TestParseGitStatusCleanDetachedHead(t *testing.T) {
	state := parseGitStatus("# branch.oid abc123\n# branch.head (detached)\n")
	if state.Dirty() {
		t.Fatal("no entries means a clean tree")
	}
	if state.Branch != "(detached)" {
		t.Fatalf("branch=%q", state.Branch)
	}
	if state.Upstream != "" {
		t.Fatalf("upstream=%q, want empty", state.Upstream)
	}
}

func TestGitEnvDisablesInteractivePrompts(t *testing.T) {
	// A push that decides to ask for credentials would hang behind the alt
	// screen with nothing to type into, so the prompts must be off.
	found := map[string]bool{}
	for _, entry := range gitEnv() {
		found[entry] = true
	}
	if !found["GIT_TERMINAL_PROMPT=0"] {
		t.Fatalf("GIT_TERMINAL_PROMPT must be disabled, got %v", gitEnv())
	}
}

func TestFirstLine(t *testing.T) {
	if got := firstLine("one\ntwo"); got != "one" {
		t.Fatalf("firstLine=%q", got)
	}
	if got := firstLine("only"); got != "only" {
		t.Fatalf("firstLine=%q", got)
	}
}

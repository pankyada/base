package ui

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, dir, name, body string) {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestDetectTasksFromPackageJSONUsesLockfileRunner(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "package.json", `{"scripts":{"build":"tsc","dev":"next dev","test":"vitest","nope":"x"}}`)
	writeFile(t, dir, "pnpm-lock.yaml", "lockfileVersion: 9\n")

	tasks := DetectTasks(dir)
	byID := map[string]Task{}
	for _, task := range tasks {
		byID[task.ID] = task
	}
	if byID["dev"].Command != "pnpm run dev" {
		t.Fatalf("dev command=%q, want pnpm run dev", byID["dev"].Command)
	}
	if byID["build"].Kind != "build" || byID["test"].Kind != "test" {
		t.Fatalf("kinds wrong: %+v", tasks)
	}
	if _, ok := byID["nope"]; ok {
		t.Fatal("unrecognised scripts should not become buttons")
	}
	// dev is the first thing a developer reaches for, so it leads.
	if tasks[0].ID != "dev" {
		t.Fatalf("first task=%q, want dev", tasks[0].ID)
	}
}

func TestDetectTasksFallsBackToNpmAndOtherToolchains(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "package.json", `{"scripts":{"build":"tsc"}}`)
	writeFile(t, dir, "go.mod", "module x\n")
	writeFile(t, dir, "Makefile", "build:\n\techo hi\nserve:\n\techo serve\n.PHONY: build\n")

	tasks := DetectTasks(dir)
	commands := map[string]bool{}
	for _, task := range tasks {
		commands[task.Command] = true
	}
	for _, want := range []string{"npm run build", "go build ./...", "go test ./...", "make build", "make serve"} {
		if !commands[want] {
			t.Fatalf("missing detected command %q in %v", want, commands)
		}
	}
}

func TestDetectTasksOnEmptyDirectory(t *testing.T) {
	if tasks := DetectTasks(t.TempDir()); len(tasks) != 0 {
		t.Fatalf("expected no tasks for an empty project, got %+v", tasks)
	}
}

func TestParseTaskFileAcceptsBothShapesAndFillsGaps(t *testing.T) {
	wrapped, err := ParseTaskFile([]byte(`{"version":1,"tasks":[{"label":"Dev Server","command":"pnpm dev"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(wrapped) != 1 || wrapped[0].ID != "dev-server" {
		t.Fatalf("id should be derived from the label: %+v", wrapped)
	}

	bare, err := ParseTaskFile([]byte(`[{"id":"b","command":"make"}]`))
	if err != nil {
		t.Fatal(err)
	}
	if len(bare) != 1 || bare[0].Label != "b" {
		t.Fatalf("label should default to the id: %+v", bare)
	}
}

func TestParseTaskFileDropsEmptyAndDuplicateEntries(t *testing.T) {
	tasks, err := ParseTaskFile([]byte(`{"tasks":[
		{"id":"a","command":"one"},
		{"id":"a","command":"two"},
		{"id":"b","command":"   "}
	]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 1 || tasks[0].Command != "one" {
		t.Fatalf("want only the first 'a', got %+v", tasks)
	}
}

func TestParseTaskFileRejectsInvalidJSON(t *testing.T) {
	if _, err := ParseTaskFile([]byte("{not json")); err == nil {
		t.Fatal("expected a parse error")
	}
}

func TestSaveAndLoadTasksRoundTrip(t *testing.T) {
	dir := t.TempDir()
	want := []Task{{ID: "serve", Label: "serve", Command: "python -m http.server", Kind: "serve"}}
	if err := SaveTasks(dir, want); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(taskConfigPath(dir)); err != nil {
		t.Fatalf("tasks.json not written: %v", err)
	}

	got, detected, err := LoadTasks(dir)
	if err != nil {
		t.Fatal(err)
	}
	if detected {
		t.Fatal("a saved file is user config, not a detection")
	}
	if len(got) != 1 || got[0].Command != want[0].Command {
		t.Fatalf("round trip lost data: %+v", got)
	}
}

func TestLoadTasksFallsBackToDetectionWithoutConfig(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "Cargo.toml", "[package]\nname='x'\n")

	tasks, detected, err := LoadTasks(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !detected {
		t.Fatal("no config file means the list is detected")
	}
	if len(tasks) == 0 {
		t.Fatal("expected cargo tasks")
	}
}

func TestLoadTasksSurfacesCorruptConfigAndStillOffersDetection(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, ".harness/tasks.json", "{oops")
	writeFile(t, dir, "go.mod", "module x\n")

	tasks, detected, err := LoadTasks(dir)
	if err == nil {
		t.Fatal("a corrupt config should be reported, not swallowed")
	}
	if !detected || len(tasks) == 0 {
		t.Fatalf("should fall back to detection, got detected=%v tasks=%+v", detected, tasks)
	}
}

func TestTasksJSONShowsSchemaWhenEmpty(t *testing.T) {
	if TasksJSON(nil) != TaskSchemaHint {
		t.Fatal("an empty list should open the editor on the schema example")
	}
	document := TasksJSON([]Task{{ID: "a", Label: "a", Command: "echo"}})
	parsed, err := ParseTaskFile([]byte(document))
	if err != nil || len(parsed) != 1 {
		t.Fatalf("editor document must round trip: %v %+v", err, parsed)
	}
}

func TestTaskSchemaHintIsValid(t *testing.T) {
	tasks, err := ParseTaskFile([]byte(TaskSchemaHint))
	if err != nil {
		t.Fatalf("the schema we hand the agent must parse: %v", err)
	}
	if len(tasks) != 3 {
		t.Fatalf("schema example lost entries: %+v", tasks)
	}
}

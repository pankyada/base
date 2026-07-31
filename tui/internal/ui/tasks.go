package ui

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Task is one runnable project command surfaced as a rail button.
type Task struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Command string `json:"command"`
	// Kind drives the glyph and whether the task is expected to stay
	// running: "serve" and "run" are long-lived, the rest exit.
	Kind string `json:"kind,omitempty"`
}

// TaskFile is the on-disk shape of <working_dir>/.harness/tasks.json.
type TaskFile struct {
	Version int    `json:"version"`
	Tasks   []Task `json:"tasks"`
}

const taskFileVersion = 1

// TaskSchemaHint is handed to the agent when the user asks it to configure the
// task list, and shown in the editor when the file is still empty.
const TaskSchemaHint = `{
  "version": 1,
  "tasks": [
    { "id": "dev",   "label": "dev",   "command": "pnpm dev",   "kind": "serve" },
    { "id": "build", "label": "build", "command": "pnpm build", "kind": "build" },
    { "id": "test",  "label": "test",  "command": "pnpm test",  "kind": "test"  }
  ]
}`

func taskConfigPath(workingDir string) string {
	return filepath.Join(workingDir, ".harness", "tasks.json")
}

// LoadTasks reads the project's task list. When no config exists it falls back
// to heuristic detection and reports detected=true, so the UI can offer to
// persist the guesses rather than silently treating them as user intent.
func LoadTasks(workingDir string) (tasks []Task, detected bool, err error) {
	data, readErr := os.ReadFile(taskConfigPath(workingDir))
	if readErr != nil {
		return DetectTasks(workingDir), true, nil
	}
	parsed, parseErr := ParseTaskFile(data)
	if parseErr != nil {
		return DetectTasks(workingDir), true, parseErr
	}
	return parsed, false, nil
}

// ParseTaskFile validates a tasks.json document. It accepts either the wrapped
// {"tasks": [...]} form or a bare array, and fills in missing ids and labels
// so a hand-written file does not have to repeat itself.
func ParseTaskFile(data []byte) ([]Task, error) {
	trimmed := strings.TrimSpace(string(data))
	var tasks []Task
	if strings.HasPrefix(trimmed, "[") {
		if err := json.Unmarshal(data, &tasks); err != nil {
			return nil, err
		}
	} else {
		var file TaskFile
		if err := json.Unmarshal(data, &file); err != nil {
			return nil, err
		}
		tasks = file.Tasks
	}
	cleaned := make([]Task, 0, len(tasks))
	seen := map[string]bool{}
	for _, task := range tasks {
		task.Command = strings.TrimSpace(task.Command)
		if task.Command == "" {
			continue
		}
		if task.ID == "" {
			task.ID = slugify(task.Label)
		}
		if task.ID == "" {
			task.ID = slugify(task.Command)
		}
		if task.Label == "" {
			task.Label = task.ID
		}
		if seen[task.ID] {
			continue
		}
		seen[task.ID] = true
		cleaned = append(cleaned, task)
	}
	return cleaned, nil
}

// SaveTasks writes the task list to <working_dir>/.harness/tasks.json.
func SaveTasks(workingDir string, tasks []Task) error {
	path := taskConfigPath(workingDir)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(TaskFile{Version: taskFileVersion, Tasks: tasks}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

// TasksJSON renders a task list as the document the editor edits.
func TasksJSON(tasks []Task) string {
	if len(tasks) == 0 {
		return TaskSchemaHint
	}
	data, err := json.MarshalIndent(TaskFile{Version: taskFileVersion, Tasks: tasks}, "", "  ")
	if err != nil {
		return TaskSchemaHint
	}
	return string(data)
}

// scriptPriority is the order detected package.json scripts are offered in —
// the commands a developer reaches for most, first.
var scriptPriority = []struct{ name, kind string }{
	{"dev", "serve"},
	{"start", "serve"},
	{"serve", "serve"},
	{"build", "build"},
	{"test", "test"},
	{"typecheck", "check"},
	{"lint", "check"},
}

const maxDetectedTasks = 8

// DetectTasks guesses the project's build/run/serve commands from its
// manifests. These are only suggestions until the user (or the agent) writes
// them to .harness/tasks.json.
func DetectTasks(workingDir string) []Task {
	var tasks []Task
	add := func(task Task) {
		if len(tasks) >= maxDetectedTasks {
			return
		}
		for _, existing := range tasks {
			if existing.ID == task.ID {
				return
			}
		}
		tasks = append(tasks, task)
	}

	if scripts := readPackageScripts(workingDir); scripts != nil {
		runner := packageRunner(workingDir)
		for _, candidate := range scriptPriority {
			if _, ok := scripts[candidate.name]; ok {
				add(Task{ID: candidate.name, Label: candidate.name, Command: runner + " run " + candidate.name, Kind: candidate.kind})
			}
		}
	}
	if exists(workingDir, "go.mod") {
		add(Task{ID: "go-build", Label: "go build", Command: "go build ./...", Kind: "build"})
		add(Task{ID: "go-test", Label: "go test", Command: "go test ./...", Kind: "test"})
	}
	if exists(workingDir, "Cargo.toml") {
		add(Task{ID: "cargo-build", Label: "cargo build", Command: "cargo build", Kind: "build"})
		add(Task{ID: "cargo-test", Label: "cargo test", Command: "cargo test", Kind: "test"})
		add(Task{ID: "cargo-run", Label: "cargo run", Command: "cargo run", Kind: "run"})
	}
	for _, target := range readMakeTargets(workingDir) {
		kind := "other"
		switch target {
		case "build", "all":
			kind = "build"
		case "test":
			kind = "test"
		case "run", "dev", "serve":
			kind = "serve"
		}
		add(Task{ID: "make-" + target, Label: "make " + target, Command: "make " + target, Kind: kind})
	}
	if exists(workingDir, "pyproject.toml") || exists(workingDir, "requirements.txt") {
		add(Task{ID: "pytest", Label: "pytest", Command: "pytest", Kind: "test"})
	}
	return tasks
}

func exists(dir, name string) bool {
	_, err := os.Stat(filepath.Join(dir, name))
	return err == nil
}

func readPackageScripts(dir string) map[string]string {
	data, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil {
		return nil
	}
	var manifest struct {
		Scripts map[string]string `json:"scripts"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil
	}
	return manifest.Scripts
}

// packageRunner picks the package manager from the lockfile actually present,
// so the button runs what the project is set up for rather than plain npm.
func packageRunner(dir string) string {
	switch {
	case exists(dir, "pnpm-lock.yaml"):
		return "pnpm"
	case exists(dir, "yarn.lock"):
		return "yarn"
	case exists(dir, "bun.lockb"), exists(dir, "bun.lock"):
		return "bun"
	default:
		return "npm"
	}
}

var makeTargetPattern = regexp.MustCompile(`^([a-zA-Z][a-zA-Z0-9._-]*):`)

var interestingMakeTargets = map[string]bool{
	"build": true, "all": true, "test": true, "run": true, "dev": true, "serve": true,
}

func readMakeTargets(dir string) []string {
	file, err := os.Open(filepath.Join(dir, "Makefile"))
	if err != nil {
		return nil
	}
	defer file.Close()

	found := map[string]bool{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		match := makeTargetPattern.FindStringSubmatch(scanner.Text())
		if match != nil && interestingMakeTargets[match[1]] {
			found[match[1]] = true
		}
	}
	targets := make([]string, 0, len(found))
	for target := range found {
		targets = append(targets, target)
	}
	sort.Strings(targets)
	return targets
}

var slugPattern = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(value string) string {
	slug := slugPattern.ReplaceAllString(strings.ToLower(strings.TrimSpace(value)), "-")
	return strings.Trim(slug, "-")
}

func taskGlyph(kind string) string {
	switch kind {
	case "serve", "run":
		return "▸"
	case "build":
		return "⚒"
	case "test":
		return "✔"
	case "check":
		return "⌁"
	default:
		return "·"
	}
}

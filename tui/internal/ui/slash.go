package ui

import "strings"

var slashCommands = map[string]string{
	"approval": "choose trust mode",
	"model":    "choose active model",
	"skills":   "review proposed skills",
	"tasks":    "run/edit project build commands",
	"git":      "stage, commit, push, diff",
	"compact":  "condense session context",
	"theme":    "switch terminal theme",
	"density":  "cycle response fold density",
	"clear":    "clear transcript",
	"help":     "show key help",
	"quit":     "exit harness",
}

// slashOrder fixes the order commands are listed and completed in, most
// reached-for first.
var slashOrder = []string{"model", "approval", "tasks", "git", "skills", "compact", "theme", "density", "clear", "help", "quit"}

func slashCommand(value string) (command, args string, ok bool) {
	if !strings.HasPrefix(value, "/") || strings.Contains(value[:minInt(len(value), 2)], "\n") {
		return "", "", false
	}
	parts := strings.Fields(strings.TrimPrefix(value, "/"))
	if len(parts) == 0 {
		return "", "", false
	}
	command = strings.ToLower(parts[0])
	if _, known := slashCommands[command]; !known {
		return command, strings.Join(parts[1:], " "), true
	}
	return command, strings.Join(parts[1:], " "), true
}

func slashHelp() string {
	items := make([]string, 0, len(slashCommands))
	for _, command := range slashOrder {
		items = append(items, "/"+command+" — "+slashCommands[command])
	}
	return strings.Join(items, " · ")
}

func slashMatches(value string) []string {
	if !strings.HasPrefix(value, "/") || strings.ContainsAny(value, " \n") {
		return nil
	}
	query := strings.TrimPrefix(value, "/")
	var matches []string
	for _, command := range slashOrder {
		if strings.HasPrefix(command, query) {
			matches = append(matches, "/"+command)
		}
	}
	return matches
}

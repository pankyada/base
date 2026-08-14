package ui

import "strings"

var slashCommands = map[string]string{
	"approval": "choose trust mode",
	"model":    "choose active model",
	"sessions": "resume a past session",
	"skills":   "review proposed skills",
	"tasks":    "run/edit project build commands",
	"inbox":    "answer parked questions",
	"git":      "stage, commit, push, diff",
	"compact":  "condense session context",
	"theme":    "pick a terminal theme",
	"density":  "pick response fold density",
	"clear":    "clear transcript",
	"help":     "list commands",
	"?":        "open the keys popup",
	"quit":     "exit harness",
}

// slashOrder fixes the order commands are listed and completed in, most
// reached-for first. "?" opens the full keys popup — a bare "?" cannot be a
// global keyboard shortcut (it's a real character in ordinary messages: "what
// does this do?"), so this is its only trigger. Left out of the list itself
// so the inline hint doesn't have to explain two different help surfaces;
// "/help" covers the discoverable case.
var slashOrder = []string{"model", "approval", "sessions", "tasks", "inbox", "git", "skills", "compact", "theme", "density", "clear", "help", "quit"}

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
	query, ok := slashQuery(value)
	if !ok {
		return nil
	}
	var matches []string
	for _, command := range slashOrder {
		if strings.HasPrefix(command, query) {
			matches = append(matches, "/"+command)
		}
	}
	return matches
}

// slashQuery centralizes the inline completion trigger rule. Slash commands
// only complete while the composer contains the command token, before args.
func slashQuery(value string) (string, bool) {
	if !strings.HasPrefix(value, "/") || strings.ContainsAny(value, " \n") {
		return "", false
	}
	return strings.TrimPrefix(value, "/"), true
}

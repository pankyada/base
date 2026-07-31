package ui

import "fmt"

func OSC9(message string) string { return fmt.Sprintf("\x1b]9;%s\x07", message) }

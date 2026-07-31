package ui

import (
	"fmt"
	"io"
	"time"
)

func BootSplash(out io.Writer, profile string, skip bool) {
	if skip {
		return
	}
	for _, step := range []string{"server ✓", "ws ✓", "profile " + profile + " ✓"} {
		_, _ = fmt.Fprintf(out, "\r◆ harness  %s", step)
		time.Sleep(120 * time.Millisecond)
	}
	_, _ = fmt.Fprintln(out, "\r\x1b[2K")
}

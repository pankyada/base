package ui

import (
	"strings"
	"testing"
	"time"
)

func TestStageStripRendersSkippedAndEscalatedStates(t *testing.T) {
	out := stripANSI(topBar("coding", "sess-1", true, time.Now(), 120, []StageItem{
		{Stage: "recon", State: "done"},
		{Stage: "plan", State: "skipped"},
		{Stage: "build", State: "escalated", Cost: 0.12},
	}))
	if !strings.Contains(out, "✓ recon") || !strings.Contains(out, "plan") || !strings.Contains(out, "!build") || !strings.Contains(out, "$0.1200") {
		t.Fatalf("stage strip missing state: %q", out)
	}
}

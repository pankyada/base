package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"harness-tui/internal/protocol"
)

// statusBadge is the one unambiguous answer to "what is the agent doing right
// now" — a solid-fill pill so it reads at a glance, not just a colored word
// among a dozen other segments. Running pulses between two accent shades and
// cycles the spinner glyph; ready stays a steady, calm green.
func statusBadge(running bool, frame int) string {
	if !running {
		bg := breathe(currentTheme.OK, blendHex(currentTheme.OK, currentTheme.Bg, 0.4), frame, 40)
		return lipgloss.NewStyle().Background(bg).Foreground(ColBg).Bold(true).Padding(0, 1).Render("● READY")
	}
	bg := breathe(currentTheme.Accent, blendHex(currentTheme.Accent, currentTheme.Bg, 0.4), frame, 16)
	return lipgloss.NewStyle().Background(bg).Foreground(ColBg).Bold(true).Padding(0, 1).
		Render(thinkingSpinChar(frame) + " RUNNING")
}

func statusBar(running bool, model, provider, approval string, tokensIn, tokensOut int, cost float64, contextTokens, contextWindow, queued, width, frame int, usage ...protocol.Usage) string {
	mode := statusBadge(running, frame)
	approvalStyle := StDim
	if approval == "danger" {
		approvalStyle = StAccent
	}
	segments := []string{
		mode,
		StInfo.Render(model),
		StDim.Render(provider),
		approvalStyle.Render("approval:" + approval),
	}
	// Before the first turn these are all zero — "in 0 · out 0 · $0.0000 · —"
	// is four segments of nothing competing with the hints that actually help
	// a new session. They appear as soon as they mean something.
	if tokensIn > 0 || tokensOut > 0 {
		segments = append(segments,
			StFaint.Render(fmt.Sprintf("in %d · out %d", tokensIn, tokensOut)),
			StFaint.Render(fmt.Sprintf("$%.4f", cost)),
		)
		if len(usage) > 0 {
			if label := usageLabel(usage[0]); label != "" {
				segments = append(segments, StDim.Render(label))
			}
		}
	}
	if contextWindow > 0 {
		segments = append(segments, StFaint.Render(contextGaugeCompact(contextTokens, contextWindow)))
	}
	segments = append(segments, StDim.Render("tab panels · ^b rail · /? keys"))
	if queued > 0 {
		segments = append(segments, StAccent.Render(fmt.Sprintf("queued:%d", queued)))
	}
	for len(segments) > 1 && lipgloss.Width(strings.Join(segments, "  ")) > width {
		segments = segments[:len(segments)-1]
	}
	return lipgloss.NewStyle().MaxWidth(maxInt(0, width)).Inline(true).Render(strings.Join(segments, "  "))
}

func providerLabel(auth, status string) string {
	if auth == "codex_oauth" {
		if status == "active" {
			return "provider: Codex subscription"
		}
		return "provider: Codex subscription (" + status + ")"
	}
	if auth == "api_key" {
		return "provider: OpenAI-compatible API"
	}
	return "provider: unknown"
}

func usageLabel(usage protocol.Usage) string {
	switch usage.CostBasis {
	case "api_equivalent":
		if usage.BillingMode == "subscription" {
			return "Codex · API-equivalent est."
		}
		return "API-equivalent est."
	case "api_estimate":
		return "API est."
	case "mixed":
		return "Mixed est."
	default:
		return ""
	}
}

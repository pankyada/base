package ui

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
)

type NoticeLevel string

const (
	NoticeInfo  NoticeLevel = "info"
	NoticeWarn  NoticeLevel = "warn"
	NoticeError NoticeLevel = "error"
)

type Notice struct {
	Level      NoticeLevel
	Message    string
	Detail     string
	Suggestion string
	CreatedAt  time.Time
}

type NoticeStack struct {
	Items          []Notice
	DisconnectedAt time.Time
}

func (n *NoticeStack) Add(level NoticeLevel, message, detail, suggestion string) {
	n.Items = append(n.Items, Notice{Level: level, Message: message, Detail: detail, Suggestion: suggestion, CreatedAt: time.Now()})
	if len(n.Items) > 4 {
		n.Items = n.Items[len(n.Items)-4:]
	}
}

func (n *NoticeStack) Clear() { n.Items = nil }

func (n *NoticeStack) SetDisconnected(disconnected bool) {
	if disconnected {
		if n.DisconnectedAt.IsZero() {
			n.DisconnectedAt = time.Now()
		}
		return
	}
	n.DisconnectedAt = time.Time{}
}

func (n *NoticeStack) Expire(now time.Time) {
	kept := n.Items[:0]
	for _, item := range n.Items {
		if now.Sub(item.CreatedAt) < 6*time.Second {
			kept = append(kept, item)
		}
	}
	n.Items = kept
}

func noticeStyle(level NoticeLevel) lipgloss.Style {
	switch level {
	case NoticeError:
		return StErr
	case NoticeWarn:
		return StAccent
	default:
		return StInfo
	}
}

func (n NoticeStack) View(width int) string {
	var lines []string
	if !n.DisconnectedAt.IsZero() {
		elapsed := int(time.Since(n.DisconnectedAt).Seconds())
		lines = append(lines, StAccent.Render("⚠ disconnected")+StDim.Render(" · retrying")+StFaint.Render(" · "+formatSeconds(elapsed)))
	}
	for _, item := range n.Items {
		prefix := "·"
		if item.Level == NoticeWarn {
			prefix = "!"
		}
		if item.Level == NoticeError {
			prefix = "✗"
		}
		lines = append(lines, noticeStyle(item.Level).Render(prefix+" "+item.Message))
		if item.Detail != "" {
			lines = append(lines, StDim.Render("  "+item.Detail))
		}
		if item.Suggestion != "" {
			lines = append(lines, StFaint.Render("  ↳ "+item.Suggestion))
		}
	}
	if len(lines) == 0 {
		return ""
	}
	return lipgloss.NewStyle().MaxWidth(maxInt(0, width)).Inline(true).Render(strings.Join(lines, "\n"))
}

func formatSeconds(seconds int) string {
	if seconds < 1 {
		return "now"
	}
	return fmt.Sprintf("retry %ds", seconds)
}

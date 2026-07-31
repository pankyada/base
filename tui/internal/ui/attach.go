package ui

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

// maxAttachmentBytes bounds how much file content is inlined into a message.
const maxAttachmentBytes = 128 * 1024

// Attachment is one file the user dropped onto the composer.
type Attachment struct {
	Path    string // absolute path on disk
	Display string // working-dir-relative when possible, else absolute
	Size    int64
	Binary  bool
}

// dropCandidate is a token from pasted text that might be a file path.
type dropCandidate struct {
	raw   string
	path  string
	start int
	end   int
}

// parseDroppedPaths finds file paths inside text a terminal produced from a
// drag-and-drop. Terminals vary: iTerm2 and GNOME Terminal shell-quote paths
// with spaces (backslash escapes or single quotes), and some emit file:// URLs.
// Only paths that exist on disk are returned, which is what keeps ordinary
// prose from being misread as a drop.
func parseDroppedPaths(text string) []dropCandidate {
	var out []dropCandidate
	for _, token := range splitDropTokens(text) {
		path := normalizeDroppedPath(token.raw)
		if path == "" {
			continue
		}
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			continue
		}
		token.path = path
		out = append(out, token)
	}
	return out
}

// splitDropTokens splits on unescaped whitespace while honouring single and
// double quotes, so "a b.txt" and a\ b.txt both survive as one token.
func splitDropTokens(text string) []dropCandidate {
	var tokens []dropCandidate
	var current strings.Builder
	start := -1
	var quote rune

	flush := func(end int) {
		if current.Len() > 0 && start >= 0 {
			tokens = append(tokens, dropCandidate{raw: current.String(), start: start, end: end})
		}
		current.Reset()
		start = -1
	}

	runes := []rune(text)
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				current.WriteRune(r)
			}
		case r == '\'' || r == '"':
			quote = r
			if start < 0 {
				start = i
			}
		case r == '\\' && i+1 < len(runes):
			// Escaped character (commonly "\ " from a dragged path).
			i++
			if start < 0 {
				start = i - 1
			}
			current.WriteRune(runes[i])
		case unicode.IsSpace(r):
			flush(i)
		default:
			if start < 0 {
				start = i
			}
			current.WriteRune(r)
		}
	}
	flush(len(runes))
	return tokens
}

// normalizeDroppedPath converts a token into an absolute path, or "" if the
// token could not plausibly be one.
func normalizeDroppedPath(token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return ""
	}
	if parsed, err := url.Parse(token); err == nil && parsed.Scheme == "file" {
		if decoded, err := url.PathUnescape(parsed.Path); err == nil {
			token = decoded
		} else {
			token = parsed.Path
		}
	}
	if strings.HasPrefix(token, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		token = filepath.Join(home, token[2:])
	}
	// Require something path-like; bare words are almost always prose.
	if !strings.ContainsAny(token, string(filepath.Separator)+"/") {
		return ""
	}
	absolute, err := filepath.Abs(token)
	if err != nil {
		return ""
	}
	return absolute
}

func newAttachment(path, workingDir string) Attachment {
	attachment := Attachment{Path: path, Display: path}
	if rel, err := filepath.Rel(workingDir, path); err == nil && !strings.HasPrefix(rel, "..") {
		attachment.Display = filepath.ToSlash(rel)
	}
	if info, err := os.Stat(path); err == nil {
		attachment.Size = info.Size()
	}
	attachment.Binary = looksBinary(path)
	return attachment
}

// looksBinary samples the head of the file for NUL bytes, the usual cheap
// heuristic for "this is not text we should inline".
func looksBinary(path string) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()
	buffer := make([]byte, 512)
	n, _ := file.Read(buffer)
	for _, b := range buffer[:n] {
		if b == 0 {
			return true
		}
	}
	return false
}

// attachmentsBlock renders attachments for the outgoing message. Text files are
// inlined so the model sees the content without a Read round-trip; binaries and
// oversized files are referenced by path instead.
func attachmentsBlock(attachments []Attachment) string {
	if len(attachments) == 0 {
		return ""
	}
	var b strings.Builder
	for _, attachment := range attachments {
		b.WriteString("\n\n")
		switch {
		case attachment.Binary:
			fmt.Fprintf(&b, "[attached file: %s (%s, binary — read it from disk if needed)]",
				attachment.Display, humanSize(attachment.Size))
		case attachment.Size > maxAttachmentBytes:
			fmt.Fprintf(&b, "[attached file: %s (%s, too large to inline — read it from disk if needed)]",
				attachment.Display, humanSize(attachment.Size))
		default:
			data, err := os.ReadFile(attachment.Path)
			if err != nil {
				fmt.Fprintf(&b, "[attached file: %s (unreadable: %v)]", attachment.Display, err)
				continue
			}
			fmt.Fprintf(&b, "[attached file: %s]\n```%s\n%s\n```",
				attachment.Display, codeFenceLang(attachment.Path), strings.TrimRight(string(data), "\n"))
		}
	}
	return b.String()
}

func codeFenceLang(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".go":
		return "go"
	case ".ts", ".tsx":
		return "typescript"
	case ".js", ".jsx":
		return "javascript"
	case ".py":
		return "python"
	case ".rs":
		return "rust"
	case ".json":
		return "json"
	case ".yaml", ".yml":
		return "yaml"
	case ".md":
		return "markdown"
	case ".sh", ".bash", ".zsh":
		return "bash"
	case ".sql":
		return "sql"
	case ".html":
		return "html"
	case ".css":
		return "css"
	default:
		return ""
	}
}

func humanSize(size int64) string {
	switch {
	case size >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(size)/(1<<20))
	case size >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(size)/(1<<10))
	default:
		return fmt.Sprintf("%d B", size)
	}
}

// attachmentBar renders the pending-attachment chips shown above the composer.
func attachmentBar(attachments []Attachment, width int) string {
	if len(attachments) == 0 {
		return ""
	}
	chips := make([]string, 0, len(attachments))
	for _, attachment := range attachments {
		label := attachment.Display
		if attachment.Binary {
			label += " ⃰"
		}
		chips = append(chips, StInfo.Render("📎 "+label)+StFaint.Render(" "+humanSize(attachment.Size)))
	}
	line := strings.Join(chips, StFaint.Render(" · "))
	return truncate(line, maxInt(1, width)) + StFaint.Render("  ctrl+r clears")
}

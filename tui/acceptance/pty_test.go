// Package acceptance runs the real, built TUI binary inside a pseudo
// terminal against a real harness server (with a fake OpenAI-compatible
// provider) to prove PT-007's live approval recovery end to end: a pending
// approval prompt must reappear with full actionable data after a transport
// reconnect, and PT-003's send-failure/composer-retention behavior over the
// same real transport.
//
// This is opt-in and guarded by HARNESS_TUI_PTY=1 so `go test ./...` stays
// fast; it spawns node (tsx) + the fake provider + the built TUI binary and
// drives a real pty, which is slow and occasionally environment-sensitive.
package acceptance

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/creack/pty"
)

// --- small raw TCP proxy, fully test-controlled -----------------------------
//
// The TUI talks to this proxy instead of talking to the harness directly.
// It forwards bytes transparently in both directions (WS framing included,
// since it operates below HTTP), so the TUI's own health probe and hello
// handshake work unmodified. sever() force-closes the current pair of legs,
// which is how this test simulates "the TUI's socket dies server-side"
// without touching the harness process (whose in-memory recoverable-approval
// registry only survives while that process keeps running — Core's
// documented contract in src/server/recoverable-approvals.ts).

type severingProxy struct {
	listener net.Listener
	target   string

	mu    sync.Mutex
	conns []net.Conn
}

func newSeveringProxy(t *testing.T, target string) *severingProxy {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("proxy listen: %v", err)
	}
	p := &severingProxy{listener: ln, target: target}
	go p.acceptLoop()
	return p
}

func (p *severingProxy) port() string {
	return fmt.Sprintf("%d", p.listener.Addr().(*net.TCPAddr).Port)
}

func (p *severingProxy) acceptLoop() {
	for {
		client, err := p.listener.Accept()
		if err != nil {
			return
		}
		go p.serve(client)
	}
}

func (p *severingProxy) serve(client net.Conn) {
	upstream, err := net.Dial("tcp", p.target)
	if err != nil {
		client.Close()
		return
	}
	p.mu.Lock()
	p.conns = append(p.conns, client, upstream)
	p.mu.Unlock()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); io.Copy(upstream, client) }()
	go func() { defer wg.Done(); io.Copy(client, upstream) }()
	wg.Wait()
	client.Close()
	upstream.Close()
}

// sever force-closes every connection pair currently proxied, simulating a
// transport drop. The TUI's read loop errors out and redials; the proxy's
// accept loop is untouched so the reconnect succeeds.
func (p *severingProxy) sever() {
	p.mu.Lock()
	conns := p.conns
	p.conns = nil
	p.mu.Unlock()
	for _, c := range conns {
		_ = c.Close()
	}
}

func (p *severingProxy) close() {
	p.listener.Close()
	p.sever()
}

// --- harness + fixture provider lifecycle -----------------------------------

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("free port: %v", err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

func waitHTTPOK(t *testing.T, url string, deadline time.Duration) {
	t.Helper()
	end := time.Now().Add(deadline)
	for time.Now().Before(end) {
		resp, err := http.Get(url)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				return
			}
		}
		time.Sleep(150 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", url)
}

func repoRoot(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	dir := wd
	for {
		if _, err := os.Stat(filepath.Join(dir, "pnpm-workspace.yaml")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("could not find repo root (pnpm-workspace.yaml) above " + wd)
		}
		dir = parent
	}
}

type harnessFixture struct {
	root         string
	tuiHome      string // isolated $HOME for the TUI process's own ~/.harness/config.json
	profilePath  string // fixture-p.yaml, passed to the TUI via -profile so it never falls back to a real user profile
	providerPort int
	harnessPort  int
	provider     *exec.Cmd
	harness      *exec.Cmd
	logs         *bytes.Buffer
	logsMu       sync.Mutex
}

func (f *harnessFixture) logf(format string, args ...any) {
	f.logsMu.Lock()
	defer f.logsMu.Unlock()
	fmt.Fprintf(f.logs, format+"\n", args...)
}

func (f *harnessFixture) tail() string {
	f.logsMu.Lock()
	defer f.logsMu.Unlock()
	s := f.logs.String()
	if len(s) > 20000 {
		return s[len(s)-20000:]
	}
	return s
}

func startFixture(t *testing.T) *harnessFixture {
	return startFixtureWithWorkflowMap(t, false)
}

func startWorkflowMapFixture(t *testing.T) *harnessFixture {
	return startFixtureWithWorkflowMap(t, true)
}

func startFixtureWithWorkflowMap(t *testing.T, workflowMap bool) *harnessFixture {
	t.Helper()
	root := t.TempDir()
	repo := repoRoot(t)

	profilesDir := filepath.Join(root, ".harness", "profiles")
	if err := os.MkdirAll(profilesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	promptPath := filepath.Join(root, "prompt.md")
	if err := os.WriteFile(promptPath, []byte("pty acceptance fixture prompt\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	artifactDir := filepath.Join(root, "artifacts", "fixture-p")
	if err := os.MkdirAll(artifactDir, 0o755); err != nil {
		t.Fatal(err)
	}

	// A fresh $HOME makes main.go's setup.EnsureInitialized think this is a
	// first run and shell out to the interactive `harness init` wizard
	// (which then fails: it wants a real terminal and a real default
	// profile). -profile bypasses profile *resolution* but not this
	// first-run gate, which only checks whether ~/.harness/config.json
	// exists — so pre-seed a minimal one to make it a no-op. Its
	// default_profile is never consulted because -profile is passed
	// explicitly on every launch in this test.
	tuiHome := filepath.Join(root, "tui-home")
	if err := os.MkdirAll(filepath.Join(tuiHome, ".harness"), 0o755); err != nil {
		t.Fatal(err)
	}
	seedConfig := `{"version":1,"default_profile":"fixture-p","profiles_dir":"~/.harness/profiles","surface":"tui"}`
	// The TUI's default approval mode is "danger", which tells the server to
	// auto-approve Bash; PT-007 needs a real prompt, so preset "bash" for the
	// fixture profile in the TUI's own prefs file.
	seedPrefs := `{"approval_mode_by_profile":{"fixture-p":"bash"}}`
	if err := os.WriteFile(filepath.Join(tuiHome, ".harness", "tui.json"), []byte(seedPrefs), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tuiHome, ".harness", "config.json"), []byte(seedConfig), 0o644); err != nil {
		t.Fatal(err)
	}
	workflowConfig := ""
	providerScript := ""
	if workflowMap {
		workflowConfig = `workflow:
  enabled: true
  playbook: pty-map
  min_intensity: { recon: 1, plan: 0, design: 0, build: 1, verify: 0, review: 0 }
  max_intensity: { recon: 1, plan: 0, design: 0, build: 1, verify: 0, review: 0 }
`
		playbookDir := filepath.Join(root, ".agents", "playbooks", "pty-map")
		if err := os.MkdirAll(playbookDir, 0o755); err != nil {
			t.Fatal(err)
		}
		playbook := "---\nname: pty-map\ndescription: isolated PTY workflow-map acceptance\nstages: [recon, build]\ntask_classes: [general]\ndefaults:\n  general: { recon: 1, build: 1 }\n---\n\n## recon\n### L1\nRequired artifact sections: ``\nExit criteria: fixture observed\n\n## build\n### L1\nRequired artifact sections: ``\nExit criteria: fixture observed\n"
		if err := os.WriteFile(filepath.Join(playbookDir, "PLAYBOOK.md"), []byte(playbook), 0o644); err != nil {
			t.Fatal(err)
		}
		providerScript = filepath.Join(root, "workflow-map-provider.mjs")
		providerSource := `import { createServer } from 'node:http'
const port = Number(process.env.CLIENT_ACCEPTANCE_PROVIDER_PORT || 0)
const server = createServer((req, res) => {
  if (req.url?.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }))
    return
  }
  if (!req.url?.endsWith('/chat/completions')) { res.writeHead(404); res.end(); return }
  let body = ''
  req.on('data', chunk => { body += chunk.toString() })
  req.on('end', () => setTimeout(() => {
    res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close', 'cache-control': 'no-cache' })
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'fixture complete' } }] }) + '\n\n')
    res.write('data: ' + JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 2, completion_tokens: 2 } }) + '\n\n')
    res.end('data: [DONE]\n\n')
  }, 4000))
})
server.listen(port, '127.0.0.1')
process.on('SIGTERM', () => server.close(() => process.exit(0)))
`
		if err := os.WriteFile(providerScript, []byte(providerSource), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	f := &harnessFixture{
		root:         root,
		tuiHome:      tuiHome,
		profilePath:  filepath.Join(profilesDir, "fixture-p.yaml"),
		providerPort: freePort(t),
		harnessPort:  freePort(t),
		logs:         &bytes.Buffer{},
	}

	// Bash requires an operator decision (no ACL "allow" override, no
	// approval_mode: yolo/danger) so the fixture provider's tool call
	// produces a real, actionable approval prompt.
	yaml := fmt.Sprintf(`name: fixture-p
model:
  base_url: http://127.0.0.1:%d/v1
  api_key_env: TEST_KEY
  id: fixture-model
system_prompt: %s
artifact_dir: %s
working_dir: %s
safety:
  enabled: false
improvement:
  enabled: false
tools:
  builtin:
    Bash: prompt
    AskUser: allow
%s`, f.providerPort, promptPath, artifactDir, root, workflowConfig)
	if err := os.WriteFile(filepath.Join(profilesDir, "fixture-p.yaml"), []byte(yaml), 0o644); err != nil {
		t.Fatal(err)
	}

	nodeBin, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not available on PATH; skipping live PTY acceptance")
	}

	if providerScript == "" {
		providerScript = filepath.Join(repo, "scripts", "client-acceptance-provider.mjs")
	}
	f.provider = exec.Command(nodeBin, providerScript)
	f.provider.Dir = repo
	f.provider.Env = append(os.Environ(), "CLIENT_ACCEPTANCE_PROVIDER_PORT="+fmt.Sprint(f.providerPort))
	stdout, _ := f.provider.StdoutPipe()
	stderr, _ := f.provider.StderrPipe()
	if err := f.provider.Start(); err != nil {
		t.Fatalf("start fake provider: %v", err)
	}
	go streamInto(f, "provider", stdout)
	go streamInto(f, "provider", stderr)

	stateDir := filepath.Join(root, "state")
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		t.Fatal(err)
	}
	f.harness = exec.Command(nodeBin, "--import", "tsx", filepath.Join(repo, "src", "server", "index.ts"),
		"--profiles", profilesDir, "--default-profile", "fixture-p")
	f.harness.Dir = repo
	f.harness.Env = append(os.Environ(),
		"HOME="+root,
		"HARNESS_STATE_DIR="+stateDir,
		"HARNESS_PORT="+fmt.Sprint(f.harnessPort),
		"TEST_KEY=fixture-key",
		"NODE_ENV=test",
	)
	hstdout, _ := f.harness.StdoutPipe()
	hstderr, _ := f.harness.StderrPipe()
	if err := f.harness.Start(); err != nil {
		t.Fatalf("start harness: %v", err)
	}
	go streamInto(f, "harness", hstdout)
	go streamInto(f, "harness", hstderr)

	waitHTTPOK(t, fmt.Sprintf("http://127.0.0.1:%d/models", f.providerPort), 30*time.Second)
	waitHTTPOK(t, fmt.Sprintf("http://127.0.0.1:%d/health", f.harnessPort), 30*time.Second)

	return f
}

func streamInto(f *harnessFixture, label string, r io.Reader) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		f.logf("[%s] %s", label, scanner.Text())
	}
}

func (f *harnessFixture) stop() {
	stop := func(cmd *exec.Cmd) {
		if cmd == nil || cmd.Process == nil {
			return
		}
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}
	stop(f.provider)
	stop(f.harness)
}

// --- pty-driven TUI ----------------------------------------------------------

var ansiRE = regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[=>]`)

func stripANSI(s string) string {
	return ansiRE.ReplaceAllString(s, "")
}

type ptyTUI struct {
	f      *os.File
	cmd    *exec.Cmd
	mu     sync.Mutex
	buf    bytes.Buffer
	closed bool
}

func launchTUI(t *testing.T, fixture *harnessFixture, binPath, port, userID string) *ptyTUI {
	t.Helper()
	// -profile pins the exact fixture profile file directly, so the launch
	// never depends on (or mutates) the real operator's ~/.harness/config.json
	// default-profile selection; HOME is isolated for the same reason (first-run
	// setup / prefs writes stay inside the fixture's temp dir).
	cmd := exec.Command(binPath, "-port", port, "-profile", fixture.profilePath, "-no-splash", "-no-motion", "-no-notify")
	cmd.Env = append(os.Environ(), "HOME="+fixture.tuiHome, "HARNESS_USER="+userID, "TERM=xterm-256color", "NO_COLOR=")
	ptyFile, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: 40, Cols: 120})
	if err != nil {
		t.Fatalf("pty start: %v", err)
	}
	p := &ptyTUI{f: ptyFile, cmd: cmd}
	go p.pump()
	return p
}

func (p *ptyTUI) pump() {
	buf := make([]byte, 4096)
	for {
		n, err := p.f.Read(buf)
		if n > 0 {
			p.mu.Lock()
			p.buf.Write(buf[:n])
			p.mu.Unlock()
		}
		if err != nil {
			return
		}
	}
}

func (p *ptyTUI) screen() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return stripANSI(p.buf.String())
}

// mark returns the current scrollback length so a later since(mark) can
// assert on output produced after an action. The buffer is scrollback, not a
// framebuffer: Bubble Tea redraws mean text never "disappears" from it, so
// tests assert what newly appears, never what is absent.
func (p *ptyTUI) mark() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.buf.Len()
}

func (p *ptyTUI) since(mark int) string {
	p.mu.Lock()
	defer p.mu.Unlock()
	raw := p.buf.String()
	if mark > len(raw) {
		mark = len(raw)
	}
	return stripANSI(raw[mark:])
}

func (p *ptyTUI) send(s string) {
	_, _ = p.f.Write([]byte(s))
}

func (p *ptyTUI) close() {
	p.mu.Lock()
	closed := p.closed
	p.closed = true
	p.mu.Unlock()
	if closed {
		return
	}
	_ = p.cmd.Process.Kill()
	_ = p.f.Close()
	_, _ = p.cmd.Process.Wait()
}

func waitForOn(t *testing.T, tui *ptyTUI, f *harnessFixture, deadline time.Duration, what string, check func() bool) {
	t.Helper()
	end := time.Now().Add(deadline)
	for time.Now().Before(end) {
		if check() {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for: %s\n--- screen ---\n%s\n--- fixture logs (tail) ---\n%s", what, tui.screen(), f.tail())
}

func buildTUIBinary(t *testing.T) string {
	t.Helper()
	repo := repoRoot(t)
	out := filepath.Join(t.TempDir(), "harness-tui-acceptance")
	cmd := exec.Command("go", "build", "-o", out, ".")
	cmd.Dir = filepath.Join(repo, "tui")
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build tui binary: %v\n%s", err, output)
	}
	return out
}

// --- the acceptance test ------------------------------------------------

func TestLiveApprovalRecoveryOverReconnect(t *testing.T) {
	if os.Getenv("HARNESS_TUI_PTY") != "1" {
		t.Skip("set HARNESS_TUI_PTY=1 to run the live PTY acceptance test")
	}

	binPath := buildTUIBinary(t)
	f := startFixture(t)
	defer f.stop()

	proxy := newSeveringProxy(t, fmt.Sprintf("127.0.0.1:%d", f.harnessPort))
	defer proxy.close()

	tui := launchTUI(t, f, binPath, proxy.port(), "pty-user")
	defer tui.close()

	// 1. Connected top bar, then the remembered per-profile approval mode
	// (seeded as "bash" in tui.json) must be applied once session_ready
	// names the real profile — otherwise the server's default "danger" mode
	// would auto-approve the fixture's Bash call and PT-007 has no prompt.
	waitForOn(t, tui, f, 20*time.Second, "top bar to show online", func() bool {
		return strings.Contains(tui.screen(), "● online")
	})
	waitForOn(t, tui, f, 10*time.Second, "the remembered bash approval mode to apply", func() bool {
		return strings.Contains(tui.screen(), "approval:bash")
	})

	// --- PT-003(b): composer text survives a send failure while disconnected.
	proxy.sever()
	waitForOn(t, tui, f, 10*time.Second, "top bar to show offline", func() bool {
		return strings.Contains(tui.screen(), "● offline") || strings.Contains(tui.screen(), "disconnected")
	})
	tui.send("unsent while offline")
	waitForOn(t, tui, f, 5*time.Second, "composer to show typed text", func() bool {
		return strings.Contains(tui.screen(), "unsent while offline")
	})
	tui.send("\r")
	waitForOn(t, tui, f, 5*time.Second, "a not-sent notice", func() bool {
		screen := tui.screen()
		return strings.Contains(screen, "not sent") || strings.Contains(screen, "disconnected")
	})
	if !strings.Contains(tui.screen(), "unsent while offline") {
		t.Fatalf("composer lost its text after a failed send:\n%s", tui.screen())
	}

	// Reconnect and confirm the earlier text is still there, unsent, then
	// actually send it.
	waitForOn(t, tui, f, 20*time.Second, "top bar to show online again", func() bool {
		return strings.Contains(tui.screen(), "● online")
	})
	// The reconnect re-resumes the prior session (PT-024); wait for that to
	// settle the way an operator would before sending again.
	waitForOn(t, tui, f, 20*time.Second, "the prior session to be restored after reconnect", func() bool {
		return strings.Contains(tui.screen(), "restored")
	})
	time.Sleep(500 * time.Millisecond)
	if !strings.Contains(tui.screen(), "unsent while offline") {
		t.Fatalf("composer text disappeared across reconnect:\n%s", tui.screen())
	}
	// Pressing Enter on the retained composer must now deliver it: the fixture
	// provider answers any plain message with "fixture complete". An emptied
	// composer would send nothing and this would time out.
	sentMark := tui.mark()
	tui.send("\r")
	waitForOn(t, tui, f, 15*time.Second, "the retained message to actually send", func() bool {
		return strings.Contains(tui.since(sentMark), "fixture complete")
	})

	// --- PT-007: trigger a tool call that needs approval.
	tui.send("CA_AUDIT_A\r")
	waitForOn(t, tui, f, 20*time.Second, "an approval prompt with tool name and args", func() bool {
		screen := tui.screen()
		return strings.Contains(screen, "APPROVAL REQUIRED") && strings.Contains(screen, "Bash") && strings.Contains(screen, "CA_AUDIT_A")
	})
	firstPromptScreen := tui.screen()
	if !strings.Contains(firstPromptScreen, "printf") {
		t.Fatalf("approval prompt missing tool args (expected the Bash command in the JSON preview):\n%s", firstPromptScreen)
	}

	// Sever the transport (the harness process itself keeps running, so its
	// in-memory recoverable-approval registry for this session/user survives)
	// and wait for the TUI to redial.
	severMark := tui.mark()
	proxy.sever()
	waitForOn(t, tui, f, 10*time.Second, "top bar to show offline after severing mid-approval", func() bool {
		return strings.Contains(tui.screen(), "● offline") || strings.Contains(tui.screen(), "disconnected")
	})
	waitForOn(t, tui, f, 20*time.Second, "top bar to show online after reconnect", func() bool {
		return strings.Contains(tui.screen(), "● online")
	})

	// 6. The same approval prompt must reappear with full actionable data —
	// tool name and args, not just an ID (never reconstructed authority).
	// Only output produced after the sever counts: the prompt must be
	// re-rendered from recovered server data, not merely still be in scrollback.
	waitForOn(t, tui, f, 20*time.Second, "the recovered approval prompt with full data", func() bool {
		after := tui.since(severMark)
		return strings.Contains(after, "APPROVAL REQUIRED") && strings.Contains(after, "Bash") && strings.Contains(after, "printf")
	})

	// 7. Approve through the normal control path and confirm the tool ran /
	// a correlated ack landed, with no duplicate prompt left behind.
	approveMark := tui.mark()
	tui.send("y")
	waitForOn(t, tui, f, 20*time.Second, "the approved tool to run and the turn to finish", func() bool {
		return strings.Contains(tui.since(approveMark), "fixture complete")
	})
	// A single approve must settle the single recovered prompt: no fresh
	// approval banner may be rendered after the decision.
	if after := tui.since(approveMark); strings.Contains(after, "APPROVAL REQUIRED") {
		t.Fatalf("a new approval prompt appeared after approving the recovered one:\n%s", after)
	}

	if t.Failed() {
		t.Logf("fixture logs (tail):\n%s", f.tail())
	}
}

func TestWorkflowMapPTYCompactDetailsCloseAndReconnect(t *testing.T) {
	if os.Getenv("HARNESS_TUI_PTY") != "1" {
		t.Skip("set HARNESS_TUI_PTY=1 to run the isolated workflow-map PTY acceptance test")
	}
	binPath := buildTUIBinary(t)
	f := startWorkflowMapFixture(t)
	defer f.stop()
	proxy := newSeveringProxy(t, fmt.Sprintf("127.0.0.1:%d", f.harnessPort))
	defer proxy.close()
	tui := launchTUI(t, f, binPath, proxy.port(), "pty-map-user")
	defer tui.close()

	waitForOn(t, tui, f, 20*time.Second, "TUI online against isolated workflow fixture", func() bool {
		return strings.Contains(tui.screen(), "● online")
	})
	tui.send("WF_MAP_PTY\r")
	waitForOn(t, tui, f, 20*time.Second, "compact actual workflow path", func() bool {
		screen := tui.screen()
		return strings.Contains(screen, "MAP observed") && strings.Contains(screen, "recon#1")
	})
	if screen := tui.screen(); !strings.Contains(screen, "entry → recon#1") {
		t.Fatalf("compact map did not show the observed entry edge:\n%s", screen)
	}
	mark := tui.mark()
	tui.send("\x07") // ctrl+g: documented workflow-map details key
	waitForOn(t, tui, f, 5*time.Second, "details expansion through the real PTY", func() bool {
		return strings.Contains(tui.since(mark), "WORKFLOW MAP · OBSERVED PATH")
	})
	closeMark := tui.mark()
	tui.send("\x1b")
	waitForOn(t, tui, f, 5*time.Second, "Escape to close details and return to compact map", func() bool {
		screen := tui.since(closeMark)
		return strings.Contains(screen, "MAP observed") && !strings.Contains(screen, "WORKFLOW MAP · OBSERVED PATH")
	})

	// The fake provider holds the active stage request for four seconds. Cut
	// only the TUI's proxied socket during that window; the harness and its
	// in-process map projection remain alive for scoped recovery.
	severMark := tui.mark()
	proxy.sever()
	waitForOn(t, tui, f, 10*time.Second, "workflow-map TUI connection to go offline", func() bool {
		return strings.Contains(tui.screen(), "● offline") || strings.Contains(tui.screen(), "disconnected")
	})
	waitForOn(t, tui, f, 20*time.Second, "workflow-map TUI reconnect and run restoration", func() bool {
		screen := tui.since(severMark)
		return strings.Contains(screen, "● online") && strings.Contains(screen, "restored")
	})
	waitForOn(t, tui, f, 15*time.Second, "the same run's workflow map after reconnect recovery", func() bool {
		screen := tui.since(severMark)
		return strings.Contains(screen, "MAP observed") && strings.Contains(screen, "recon#1")
	})
	mark = tui.mark()
	tui.send("\x07")
	waitForOn(t, tui, f, 5*time.Second, "recovered map details through the real PTY", func() bool {
		return strings.Contains(tui.since(mark), "WORKFLOW MAP · OBSERVED PATH")
	})
}

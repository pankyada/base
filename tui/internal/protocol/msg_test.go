package protocol

import (
	"encoding/json"
	"testing"
)

func TestDecodeToken(t *testing.T) {
	m, err := DecodeServer([]byte(`{"type":"token","content":"hi"}`))
	if err != nil {
		t.Fatal(err)
	}
	if m.Type != "token" || m.Content != "hi" {
		t.Fatalf("got %+v", m)
	}
}

func TestDecodeToolStart(t *testing.T) {
	m, err := DecodeServer([]byte(`{"type":"tool_start","name":"read","input":{"path":"a.go"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if m.Name != "read" || m.Input["path"] != "a.go" {
		t.Fatalf("got %+v", m)
	}
}

func TestDecodeStats(t *testing.T) {
	m, _ := DecodeServer([]byte(`{"type":"stats","tokens_in":10,"tokens_out":5,"cost_usd":0.01}`))
	if m.TokensIn != 10 || m.TokensOut != 5 {
		t.Fatalf("got %+v", m)
	}
}

func TestDecodeTodos(t *testing.T) {
	m, _ := DecodeServer([]byte(`{"type":"todos","todos":[{"id":"1","content":"x","status":"pending","priority":"high"}]}`))
	if len(m.Todos) != 1 || m.Todos[0].Content != "x" {
		t.Fatalf("got %+v", m)
	}
}

func TestDecodePending(t *testing.T) {
	m, err := DecodeServer([]byte(`{"type":"pending","pending":[{"id":"p1","run_id":"r1","session_id":"s1","user":"alice","profile":"p","prompt":"Pick","kind":"select","options":["a","b"],"created_at":"2026-08-07T00:00:00Z","expires_at":"2026-08-08T00:00:00Z","state":"open","answered_at":null}]}`))
	if err != nil || len(m.Pending) != 1 || m.Pending[0].ID != "p1" || m.Pending[0].Options[1] != "b" {
		t.Fatalf("decoded=%+v err=%v", m, err)
	}
}

func TestEncodeClientHello(t *testing.T) {
	b, err := json.Marshal(Hello("alice"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"type":"hello","user_id":"alice","protocol_version":2}` {
		t.Fatalf("got %s", b)
	}
}

func TestEncodeClientHelloIncludesProfileOverride(t *testing.T) {
	b, err := json.Marshal(Hello("alice", "data-analyst"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"type":"hello","user_id":"alice","protocol_version":2,"profile":"data-analyst"}` {
		t.Fatalf("got %s", b)
	}
}

func TestHelloWithWorkingDirIsAdditive(t *testing.T) {
	b, err := json.Marshal(HelloWithWorkingDir("alice", "coding", "/work/project"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"type":"hello","user_id":"alice","protocol_version":2,"profile":"coding","working_dir":"/work/project"}` {
		t.Fatalf("hello with working directory = %s", b)
	}
}

func TestEncodeMessage(t *testing.T) {
	b, _ := json.Marshal(Message("do it"))
	if string(b) != `{"type":"message","content":"do it"}` {
		t.Fatalf("got %s", b)
	}
}

func TestEncodeRevampClientMessages(t *testing.T) {
	cases := []struct {
		name string
		msg  ClientMessage
		want string
	}{
		{"models_list", ModelsList(), `{"type":"models_list"}`},
		{"set_model", SetModel("gpt-5.4-mini"), `{"type":"set_model","model":"gpt-5.4-mini"}`},
		{"approval", SetApprovalMode("danger"), `{"type":"set_approval_mode","mode":"danger"}`},
		{"runtime subscribe", RuntimeSubscribe("s1"), `{"type":"runtime_subscribe","session_id":"s1"}`},
		{"skills_list", SkillsList(), `{"type":"skills_list"}`},
		{"commands_list", CommandsList(), `{"type":"commands_list"}`},
		{"skill_get", SkillGet("linting", "proposed"), `{"type":"skill_get","name":"linting","source":"proposed"}`},
		{"skill_save", SkillSave("linting", "---\nname: linting\ndescription: x\n---"), `{"type":"skill_save","name":"linting","content":"---\nname: linting\ndescription: x\n---"}`},
		{"skill_promote", SkillPromote("linting"), `{"type":"skill_promote","name":"linting"}`},
		{"skill_discard", SkillDiscard("linting"), `{"type":"skill_discard","name":"linting"}`},
		{"skills_mine", SkillsMine(), `{"type":"skills_mine"}`},
		{"compact", Compact(), `{"type":"compact"}`},
		{"pending_list", PendingList(), `{"type":"pending_list"}`},
		{"pending_answer", PendingAnswer("p1", "evening"), `{"type":"pending_answer","pending_id":"p1","value":"evening"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := json.Marshal(tc.msg)
			if err != nil || string(got) != tc.want {
				t.Fatalf("encoded=%s err=%v want=%s", got, err, tc.want)
			}
		})
	}
}

func TestDecodeRevampServerMessages(t *testing.T) {
	cases := []struct {
		raw  string
		want func(ServerMessage) bool
	}{
		{`{"type":"tool_prompt","id":"t1","name":"Bash","risk":"danger","reason":"destructive"}`, func(m ServerMessage) bool { return m.Risk == "danger" && m.Reason == "destructive" }},
		{`{"type":"runtime","snapshot":{"session_id":"s1","actionable":[{"id":"t1","name":"Bash","input":{"command":"pwd"}}]}}`, func(m ServerMessage) bool {
			return m.Runtime != nil && m.Runtime.SessionID == "s1" && len(m.Runtime.Actionable) == 1 && m.Runtime.Actionable[0].Input["command"] == "pwd"
		}},
		{`{"type":"stats","context_window":128000,"context_tokens":64000}`, func(m ServerMessage) bool { return m.ContextWindow == 128000 && m.ContextTokens == 64000 }},
		{`{"type":"models","current":"gpt-5.4-mini","models":[{"id":"gpt-5.4-mini","available":true}]}`, func(m ServerMessage) bool { return m.Current == "gpt-5.4-mini" && len(m.Models) == 1 }},
		{`{"type":"skills","proposed":[{"name":"x","source":"proposed"}],"installed":[]}`, func(m ServerMessage) bool { return len(m.Proposed) == 1 && m.Proposed[0].Source == "proposed" }},
		{`{"type":"commands","commands":[{"name":"review","description":"review","template":"Review $ARGUMENTS"}]}`, func(m ServerMessage) bool {
			return len(m.Commands) == 1 && m.Commands[0].Template == "Review $ARGUMENTS"
		}},
		{`{"type":"notice","level":"warn","message":"check","detail":"details"}`, func(m ServerMessage) bool { return m.Level == "warn" && m.Detail == "details" }},
	}
	for _, tc := range cases {
		m, err := DecodeServer([]byte(tc.raw))
		if err != nil || !tc.want(m) {
			t.Fatalf("decoded=%+v err=%v", m, err)
		}
	}
}

func TestDecodeWorkflowMapFrames(t *testing.T) {
	observation, err := DecodeServer([]byte(`{"type":"workflow_map","observation":{"event_id":"event-2","revision":2,"kind":"transition","scope":{"run_id":"run-1","session_id":"session-1","profile":"coding"},"transition":{"transition_id":"edge-1","from_attempt_id":"attempt-1","to_attempt_id":"attempt-2","kind":"retry"}}}`))
	if err != nil || observation.WorkflowMapObservation == nil || observation.WorkflowMapObservation.Revision != 2 || observation.WorkflowMapObservation.Transition == nil || observation.WorkflowMapObservation.Transition.Kind != "retry" {
		t.Fatalf("observation=%+v err=%v", observation, err)
	}
	snapshot, err := DecodeServer([]byte(`{"type":"workflow_map","snapshot":{"version":1,"scope":{"run_id":"run-1","session_id":"session-1","profile":"coding"},"revision":4,"availability":{"state":"partial","reason":"event_gap"},"attempts":[{"attempt_id":"attempt-1","pass_id":"pass-1","playbook":"coding","stage":"build","attempt":1,"intensity":2,"tier":"balanced","model":"fixture","state":"done","cost_usd":0}],"transitions":[],"advice":[]}}`))
	if err != nil || snapshot.WorkflowMapSnapshot == nil || snapshot.WorkflowMapSnapshot.Revision != 4 || snapshot.WorkflowMapSnapshot.Attempts[0].CostUSD == nil || *snapshot.WorkflowMapSnapshot.Attempts[0].CostUSD != 0 {
		t.Fatalf("snapshot=%+v err=%v", snapshot, err)
	}
}

func TestEncodeWorkflowMapRecoveryRequest(t *testing.T) {
	scope := WorkflowMapScope{RunID: "run-1", SessionID: "session-1", Profile: "coding"}
	var after uint64 = 7
	got, err := json.Marshal(WorkflowMap(scope, &after))
	if err != nil || string(got) != `{"type":"workflow_map","scope":{"run_id":"run-1","session_id":"session-1","profile":"coding"},"after_revision":7}` {
		t.Fatalf("encoded=%s err=%v", got, err)
	}
	got, err = json.Marshal(WorkflowMap(scope, nil))
	if err != nil || string(got) != `{"type":"workflow_map","scope":{"run_id":"run-1","session_id":"session-1","profile":"coding"}}` {
		t.Fatalf("snapshot request encoded=%s err=%v", got, err)
	}
}

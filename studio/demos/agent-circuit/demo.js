const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const money = number => `$${number.toFixed(3)}`;
const agents = [
  {id:'lead',name:'Orchestrator',role:'LEAD · BALANCED',icon:'⌘',x:29,y:233,brief:'Break the checkout brief into bounded tasks, delegate in parallel, and synthesize verified results.',tool:'DelegateFanout',args:{agents:['researcher','builder','security']},cost:.019,start:0,end:120},
  {id:'research',name:'Researcher',role:'RESEARCH · ECONOMY',icon:'⌕',x:276,y:76,brief:'Trace checkout behavior and collect evidence for the implementation and review.',tool:'Read',args:{path:'src/checkout/session.ts'},cost:.012,start:15,end:49},
  {id:'builder',name:'Builder',role:'BUILD · BALANCED',icon:'⌁',x:276,y:244,brief:'Implement idempotency handling and run the focused checkout regression suite.',tool:'Bash',args:{command:'pnpm test -- checkout',cwd:'/workspace/checkout'},cost:.047,start:20,end:84},
  {id:'security',name:'Security',role:'AUDIT · ECONOMY',icon:'◇',x:276,y:411,brief:'Review untrusted payment input and confirm the patch keeps validation at the trust boundary.',tool:'Grep',args:{pattern:'idempotency|signature',path:'src/checkout'},cost:.014,start:19,end:53},
  {id:'reviewer',name:'Reviewer',role:'VERIFY · CRITIC',icon:'⊞',x:581,y:244,brief:'Combine implementation, research evidence, and security findings. Verify the final artifact before delivery.',tool:'Read',args:{path:'artifacts/checkout-review.md'},cost:.026,start:85,end:108},
  {id:'delivery',name:'Delivery',role:'OUTPUT · SYNTHESIS',icon:'↗',x:840,y:244,brief:'Package the reviewed change, test evidence, and limitations for the operator. No deployment is performed.',tool:'Write',args:{path:'artifacts/checkout-summary.md'},cost:.009,start:108,end:120},
];
const edges = [
  {id:'delegate-research',from:'lead',to:'research',d:'M216 293 H244 V136 H276',kind:'delegation',time:15,description:'Lead delegates investigation to Researcher. This edge represents parent → child lineage.'},
  {id:'delegate-build',from:'lead',to:'builder',d:'M216 293 H244 V304 H276',kind:'delegation',time:20,description:'Lead delegates the implementation task to Builder with an inherited share of the run budget.'},
  {id:'delegate-security',from:'lead',to:'security',d:'M216 293 H244 V471 H276',kind:'delegation',time:19,description:'Lead delegates an independent security audit. Audit runs in parallel with implementation.'},
  {id:'research-review',from:'research',to:'reviewer',d:'M463 136 H531 Q541 136 541 146 V294 Q541 304 551 304 H581',kind:'handoff',time:49,description:'Explicit fixture handoff: Researcher shares checkout-evidence.md with Reviewer. This is artifact transfer, not a delegation edge.',artifact:'checkout-evidence.md'},
  {id:'build-review',from:'builder',to:'reviewer',d:'M463 304 H581',kind:'handoff',time:84,description:'Builder must finish before the implementation artifact is available to Reviewer.',artifact:'checkout.patch'},
  {id:'security-review',from:'security',to:'reviewer',d:'M463 471 H531 Q541 471 541 461 V314 Q541 304 551 304 H581',kind:'handoff',time:53,description:'Explicit fixture handoff: Security shares trust-boundary findings with Reviewer.',artifact:'security-findings.md'},
  {id:'review-delivery',from:'reviewer',to:'delivery',d:'M768 304 H840',kind:'handoff',time:108,description:'Reviewer releases a verified summary to Delivery after all required inputs are available.',artifact:'checkout-review.md'},
];
let cursor = 55, playing = false, speed = 1, selected = 'builder', view = 'circuit', scenario = 'normal';
let decision = null, retried = false, reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const announce = text => { $('#announcement').textContent = text; };
function effectiveDecision(){ return cursor >= 55 ? decision : null; }
function effectiveRepair(){ return retried && cursor >= 74; }
function stateOf(agent){
  const choice = effectiveDecision();
  if(agent.id === 'lead') return cursor >= 120 ? ['done','Complete','Final summary delivered'] : cursor < 20 ? ['working','Planning','Decomposing the brief'] : ['waiting','Coordinating','Collecting worker results'];
  if(agent.id === 'builder'){
    if(cursor < agent.start) return ['queued','Queued','Waiting for delegation'];
    if(cursor >= 55 && choice === 'deny') return ['failed','Denied','Execution denied by operator'];
    if(cursor >= 55 && !choice) return ['needs-you','Needs your approval','Run focused checkout tests'];
    if(scenario === 'failure' && cursor >= 73 && !effectiveRepair()) return ['failed','Test failed','Idempotency regression detected'];
    if(cursor >= 84) return ['done','Complete',scenario === 'failure' ? 'Regression fixed · tests passed' : 'Patch ready · tests passed'];
    return ['working',cursor >= 55 ? 'Running tests' : 'Building',cursor >= 55 ? 'Executing approved test command' : 'Implementing idempotency checks'];
  }
  if(['reviewer','delivery'].includes(agent.id)){
    if(cursor >= 55 && choice !== 'approve') return ['waiting','Blocked upstream',choice === 'deny' ? 'Builder execution was denied' : 'Builder needs your permission'];
    if(scenario === 'failure' && cursor >= 73 && !effectiveRepair()) return ['waiting','Blocked upstream','Builder needs a repair cycle'];
  }
  if(cursor < agent.start) return ['queued','Queued','Waiting for delegation'];
  if(cursor >= agent.end) return ['done','Complete',({research:'Evidence shared with Reviewer',security:'Trust boundaries checked',reviewer:'Review accepted · evidence linked',delivery:'Summary ready to inspect'})[agent.id]];
  return ['working',agent.id === 'research' ? 'Reading' : agent.id === 'security' ? 'Auditing' : agent.id === 'reviewer' ? 'Reviewing' : 'Packaging',({research:'Tracing checkout behavior',security:'Checking payment input',reviewer:'Combining three workstreams',delivery:'Preparing the final summary'})[agent.id]];
}
function costOf(agent){
  let time = cursor;
  if(agent.id === 'builder' && cursor >= 55 && effectiveDecision() !== 'approve') time=55;
  if(['reviewer','delivery'].includes(agent.id) && (effectiveDecision() !== 'approve' || scenario === 'failure' && cursor >= 73 && !effectiveRepair())) return 0;
  if(agent.id === 'builder' && scenario === 'failure' && cursor >= 73 && !effectiveRepair()) time=73;
  return agent.cost * Math.max(0,Math.min(1,(time-agent.start)/(agent.end-agent.start)));
}
function eventHistory(agent){
  const records = [[agent.start,`${agent.name} ${agent.id === 'lead' ? 'received the mission' : 'joined the run'}.`]];
  if(agent.id==='builder'){
    records.push([30,'Implementation changes prepared.'],[55,'Bash requested operator approval.']);
    if(decision) records.push([55,decision==='approve'?'Operator approved this command.':'Operator denied execution.']);
    if(decision==='approve' && scenario==='failure') records.push([73,'Regression test failed: duplicate payment accepted.']);
    if(retried) records.push([74,'Repair cycle started in the demo.']);
    if(decision==='approve' && (scenario==='normal'||effectiveRepair())) records.push([84,'Fixture regression suite passed.']);
  }else if(agent.id==='research') records.push([29,'Read checkout/session.ts.'],[49,'Shared checkout-evidence.md with Reviewer.']);
  else if(agent.id==='security') records.push([36,'Checked signature and idempotency validation.'],[53,'Shared security-findings.md with Reviewer.']);
  else if(agent.id==='lead') records.push([20,'Delegated three bounded workstreams.'],[55,'Builder reached an approval boundary.']);
  else if(effectiveDecision()==='approve' && (scenario==='normal'||effectiveRepair())) records.push([agent.end,agent.id==='reviewer'?'Review completed; evidence attached.':'Summary delivered. No deployment performed.']);
  return records.filter(([time])=>time<=cursor).reverse().slice(0,4);
}
function renderNodes(){
  $('#nodes').innerHTML=agents.map(a=>{const [state,label,task]=stateOf(a);return `<button class="node ${a.id} ${state} ${selected===a.id?'selected':''}" style="left:${a.x}px;top:${a.y}px" data-agent="${a.id}" aria-pressed="${selected===a.id}" aria-label="${a.name}: ${label}">${state==='needs-you'?'<span class="node-badge">DECISION</span>':''}<span class="node-top"><span class="avatar">${a.icon}</span><span><span class="node-title">${a.name}</span><span class="node-role">${a.role}</span></span></span><span class="state-chip">${label}</span><span class="node-task">${task}</span><span class="node-bottom"><span>${a.id==='lead'?'ROOT':a.id==='delivery'?'ARTIFACT':'WORKER'}</span><span>${money(costOf(a))}</span></span></button>`;}).join('');
  $('#edge-paths').innerHTML=edges.map(edge=>{
    const target=stateOf(agents.find(a=>a.id===edge.to))[0];
    const arrived=cursor>=edge.time && (edge.from!=='builder'||effectiveDecision()==='approve'&&(scenario==='normal'||effectiveRepair())) && (edge.from!=='reviewer'||stateOf(agents.find(a=>a.id==='reviewer'))[0]==='done');
    let status=arrived?(target==='working'?'active':'completed'):'idle';
    if(edge.from==='builder' && ['needs-you','failed'].includes(stateOf(agents[2])[0])) status=stateOf(agents[2])[0]==='failed'?'failed':'waiting';
    if(edge.to==='builder'&&stateOf(agents[2])[0]==='needs-you') status='waiting';
    return `<path class="edge ${edge.kind} ${status}" d="${edge.d}" marker-end="url(#arrow)"/><path class="edge-hit" d="${edge.d}" tabindex="0" role="button" aria-label="Inspect ${edge.kind}: ${edge.from} to ${edge.to}" data-edge="${edge.id}"/>`;
  }).join('')+'<text class="edge-label" x="488" y="125">evidence</text><text class="edge-label" x="480" y="293">implementation</text><text class="edge-label" x="485" y="488">findings</text>';
}
function renderLanes(){
  $('#lanes').innerHTML=agents.map(a=>{const [state,label]=stateOf(a);let end=Math.min(cursor,a.end);if(state==='queued'||state==='waiting')end=a.start;if(a.id==='builder'&&effectiveDecision()!=='approve')end=Math.min(end,55);if(a.id==='builder'&&scenario==='failure'&&!effectiveRepair())end=Math.min(end,73);const width=Math.max(0,end-a.start)/1.2;const waiting=a.id==='builder'&&cursor>=55&&effectiveDecision()!=='approve';return `<div class="lane"><button data-agent="${a.id}">${a.name}<small>${label}</small></button><div class="lane-track"><i class="lane-bar ${state==='failed'?'failure':waiting?'wait':''}" style="left:${a.start/1.2}%;width:${width}%"></i><i class="lane-cursor" style="left:${cursor/1.2}%"></i></div></div>`}).join('');
}
function renderInspector(){
  const edge=edges.find(e=>e.id===selected);
  if(edge){$('#inspector-content').innerHTML=`<div class="eyebrow">${edge.kind.toUpperCase()}</div><h2 style="margin-top:14px">${agents.find(a=>a.id===edge.from).name} → ${agents.find(a=>a.id===edge.to).name}</h2><p class="detail-copy">${escape(edge.description)}</p><div class="detail-section"><p class="detail-label">EVIDENCE CONTRACT</p><p class="detail-copy">${edge.kind==='delegation'?'Parent / child identity from agent_spawn.frame.':'Only an explicit addressed handoff may create this connection. Shared tool usage does not imply communication.'}</p></div>${edge.artifact?`<div class="detail-section"><p class="detail-label">EXPECTED ARTIFACT</p><p class="detail-copy">${edge.artifact}</p><p class="detail-copy">Scheduled at ${clock(edge.time)} in the successful fixture. Inspect worker state to confirm availability.</p></div>`:''}<div class="detail-section"><button class="artifact-button" data-agent="${edge.to}">Inspect receiving agent →</button></div>`;return;}
  const a=agents.find(a=>a.id===selected), [state,label]=stateOf(a);
  const needsApproval=a.id==='builder'&&state==='needs-you';
  const failed=a.id==='builder'&&state==='failed'&&decision==='approve';
  const done=a.id==='delivery'&&state==='done';
  $('#inspector-content').innerHTML=`<div class="inspector-title ${a.id}"><span class="avatar">${a.icon}</span><div><h2>${a.name}</h2><div class="profile">${a.role.toLowerCase()}</div></div></div><div class="status-line ${['needs-you','failed'].includes(state)?'warn':''}">${label}</div><p class="detail-copy">${a.brief}</p>${needsApproval?`<div class="request"><div class="request-top">Permission request <span>CAUTION</span></div><pre>${escape(JSON.stringify({tool:a.tool,...a.args},null,2))}</pre><p>Runs repository test scripts through the shell. Scripts may execute code or write local files.</p><div class="request-actions"><button id="deny">Deny</button><button class="approve" id="approve">Approve once ↗</button></div></div>`:failed?`<div class="request"><div class="request-top">Regression detected <span>FAILED</span></div><pre>FAIL checkout/idempotency\nExpected: duplicate rejected\nReceived: payment accepted</pre><p>Reviewer stays blocked. Start a simulated repair cycle to inspect recovery.</p><div class="request-actions"><button class="approve" id="retry">Simulate repair ↻</button></div></div>`:a.id==='builder'&&decision==='deny'&&cursor>=55?'<div class="request"><div class="request-top">Command denied</div><p>No execution occurred. Downstream work remains blocked.</p><button class="artifact-button" id="reconsider">Reset demo decision</button></div>':`<div class="detail-section"><p class="detail-label">${done?'DELIVERED ARTIFACT':'TOOL CONTEXT · FIXTURE'}</p>${done?'<button class="artifact-button" id="artifact">▧ checkout-summary.md ↗</button>':`<pre>${escape(JSON.stringify({tool:a.tool,...a.args},null,2))}</pre>`}</div>`}<div class="mini-metrics"><div><span>SPEND · EST.</span><strong>${money(costOf(a))}</strong></div><div><span>SCOPE</span><strong style="font-size:12px">${a.id==='lead'?'Root run':'Inherited budget'}</strong></div></div><div class="detail-section"><p class="detail-label">RECENT EVENTS</p><ol class="event-list">${eventHistory(a).map(([time,text])=>`<li><time>${clock(time)}</time>${escape(text)}</li>`).join('')||'<li>No events at this cursor.</li>'}</ol></div>`;
}
function render(){
  const focused=document.activeElement;
  const focusAgent=focused?.dataset?.agent, focusEdge=focused?.dataset?.edge;
  const builder=stateOf(agents[2])[0], blocked=cursor>=55&&effectiveDecision()!=='approve', failure=scenario==='failure'&&cursor>=73&&!effectiveRepair()&&decision==='approve';
  const done=cursor>=120&&!blocked&&!failure;
  const status=done?'Mission complete':builder==='needs-you'?'Waiting for your decision':builder==='failed'?(decision==='deny'?'Execution denied':'Regression needs repair'):cursor<20?'Assembling the team':'Team is making progress';
  $('#run-status').textContent=status;
  $('#run-detail').textContent=done?'Reviewed summary ready. No deployment performed.':blocked?'Builder is blocked. Review waits downstream.':failure?'Failure isolated to Builder. Evidence stays available.':'Parallel workstreams converge into one verified result.';
  const spend=agents.reduce((sum,a)=>sum+costOf(a),0);
  $('#spend').textContent=money(spend);$('#budget-left').textContent=`${Math.round((.5-spend)*200)}% remaining`;$('#budget-fill').style.width=`${spend*200}%`;
  const active=agents.filter(a=>stateOf(a)[0]==='working').length;
  $('#agent-count').innerHTML=`${active} <small>working / 6 total</small>`;
  $('.signal').style.background=blocked||failure?'var(--red)':done?'#839575':'var(--teal)';
  $('#attention').classList.toggle('clear',!blocked&&!failure);
  $('#attention-text').innerHTML=blocked?`<strong>${decision==='deny'?'Execution denied':'Decision point'}</strong> · Builder ${decision==='deny'?'cannot continue':'requests shell access'}`:failure?'<strong>Repair needed</strong> · Checkout regression detected':done?'<strong>Mission complete</strong> · Reviewed artifact ready':`<strong>${cursor<20?'Planning':'In motion'}</strong> · ${cursor<20?'Lead prepares bounded tasks':'Evidence and execution share one timeline'}`;
  $('#inspect-decision').textContent=done?'Open delivery ↗':blocked||failure?'Inspect request ↗':'Follow lead ↗';
  $('#time').textContent=clock(cursor);$('#scrubber').value=cursor;$('#scrubber').style.setProperty('--progress',`${cursor/1.2}%`);
  const phase=cursor<15?['A brief becomes a plan','Lead turns the mission into bounded work.']:cursor<49?['Three workstreams, one mission','Independent workers investigate, build, and audit.']:blocked?['Permission before execution','A real pause in the workflow, visible at a glance.']:failure?['Failure with a visible boundary','A repair cycle is required before review can start.']:cursor<85?['Evidence meets implementation','Work resumes after explicit permission.']:cursor<108?['Converge before delivery','Reviewer combines implementation, evidence, and findings.']:['A result with receipts','Open Delivery to inspect the final fixture artifact.'];
  $('#beat-title').textContent=phase[0];$('#beat-subtitle').textContent=phase[1];
  $('#play').textContent=playing?'Ⅱ':'▶';$('#play').setAttribute('aria-label',playing?'Pause demo':'Play demo');
  $('#replay-label').textContent=playing?'PLAYING · FIXTURE':blocked?'PAUSED · DECISION POINT':'PAUSED · REPLAY';
  document.body.classList.toggle('paused',!playing);document.body.classList.toggle('still',reduced);
  $('#motion').textContent=reduced?'Motion off':'Motion on';$('#motion').setAttribute('aria-pressed',String(reduced));
  renderNodes();renderLanes();renderInspector();
  if(focusAgent)document.querySelector(`[data-agent="${focusAgent}"]`)?.focus({preventScroll:true});
  if(focusEdge)document.querySelector(`[data-edge="${focusEdge}"]`)?.focus({preventScroll:true});
}
function fit(){
  const container=$('#circuit-view');const scale=Math.max(.65,Math.min(1,(container.clientWidth-2)/1060));
  $('#circuit').style.zoom=scale;container.scrollLeft=0;
}
function seek(time){playing=false;cursor=time;render();}
function select(id){selected=id;render();}
function pauseAtBoundary(){
  if(cursor>=55&&!decision){cursor=55;playing=false;selected='builder';announce('Builder needs your approval.');return true;}
  if(cursor>=73&&scenario==='failure'&&decision==='approve'&&!effectiveRepair()){cursor=73;playing=false;selected='builder';announce('Test failed. Simulate a repair to continue.');return true;}
  if(decision==='deny'&&cursor>=55){playing=false;return true;}return false;
}
function showArtifact(){
  const artifact=document.createElement('dialog');artifact.innerHTML='<form method="dialog"><button class="dialog-close" aria-label="Close artifact">×</button></form><div class="eyebrow">SIMULATED ARTIFACT · NOT A REAL TEST REPORT</div><h2>Checkout release summary</h2><p>Fixture result: idempotency handling implemented, focused regression suite passed, and trust-boundary review completed.</p><dl><dt>Evidence</dt><dd>checkout-evidence.md · security-findings.md · checkout.patch</dd><dt>Validation</dt><dd>24 fixture tests passed. These are story data, not tests executed against your repository.</dd><dt>Delivery boundary</dt><dd>No commit, deployment, or payment operation occurred.</dd></dl>';document.body.append(artifact);artifact.addEventListener('close',()=>artifact.remove());artifact.showModal();
}
document.addEventListener('click',event=>{
  const agent=event.target.closest('[data-agent]');if(agent){select(agent.dataset.agent);return;}
  const edge=event.target.closest('[data-edge]');if(edge){select(edge.dataset.edge);return;}
  const milestone=event.target.closest('[data-time]');if(milestone){seek(Number(milestone.dataset.time));return;}
  const tab=event.target.closest('[data-view]');if(tab){view=tab.dataset.view;document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.view===view)));$('#circuit-view').hidden=view!=='circuit';$('#lanes-view').hidden=view!=='lanes';if(view==='circuit')fit();return;}
  switch(event.target.closest('button')?.id){
    case 'approve':decision='approve';cursor=56;playing=true;announce('Demo command approved once. Playback resumed.');render();$('#play').focus();break;
    case 'deny':decision='deny';playing=false;announce('Demo command denied. Downstream work stays blocked.');render();$('#play').focus();break;
    case 'retry':retried=true;cursor=74;playing=true;announce('Simulated repair started.');render();$('#play').focus();break;
    case 'reconsider':decision=null;cursor=55;render();$('#approve').focus();break;
    case 'play':if(playing)playing=false;else if(cursor>=120){cursor=0;decision=null;retried=false;playing=true;}else{playing=true;pauseAtBoundary();}render();break;
    case 'speed':speed=speed===1?2:speed===2?4:1;$('#speed').textContent=`${speed}×`;break;
    case 'restart':cursor=0;decision=null;retried=false;selected='lead';playing=true;render();break;
    case 'motion':reduced=!reduced;render();break;
    case 'fit':fit();break;
    case 'inspect-decision':select(cursor>=120&&stateOf(agents[5])[0]==='done'?'delivery':cursor>=55&&['needs-you','failed'].includes(stateOf(agents[2])[0])?'builder':'lead');$('#inspector-content').scrollIntoView({block:'nearest',behavior:'instant'});break;
    case 'about':$('#notes').showModal();break;
    case 'artifact':showArtifact();break;
  }
});
document.addEventListener('keydown',event=>{const edge=event.target.closest('[data-edge]');if(edge&&['Enter',' '].includes(event.key)){event.preventDefault();select(edge.dataset.edge);}if(event.target.matches('[role=tab]')&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const target=event.target.id==='circuit-tab'?$('#lanes-tab'):$('#circuit-tab');target.click();target.focus();}});
$('#scrubber').addEventListener('input',event=>seek(Number(event.target.value)));
$('#scenario').addEventListener('change',event=>{scenario=event.target.value;decision=null;retried=false;cursor=55;playing=false;selected='builder';render();announce(`${scenario==='normal'?'Checkout release':'Recovery drill'} loaded at the decision point.`);});
window.addEventListener('resize',fit);
setInterval(()=>{if(!playing)return;cursor=Math.min(120,cursor+speed);pauseAtBoundary();if(cursor>=120)playing=false;render();},1000);
render();fit();

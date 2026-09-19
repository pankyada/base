'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import Link from 'next/link'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useSharedHarnessWS } from '../../components/chrome/SocketProvider'
import { buildScopedUrl } from '../../lib/scopedRequest'
import { layoutProjects, type TrackedFileSize } from './town-model'
import { TownScene as TownLandscapeScene } from './town-scene'
import { HISTORICAL_REFERENCES, TOWN_MODE_KEY, isTownHumanEndpoint, parseTownMode, projectAgentPresence, townAnswerReceiptLabel, townConversationGroups, townLayoutStamp, type AgentPresence, type TownCommunicationMessage, type TownMode } from './town-world-model'

type Project = { id: string; path: string; parent_id?: string; remote?: string; size?: TrackedFileSize; git: { head?: string; dirty?: boolean; last_commit_at?: string; status: string; error?: string }; scanned_at: string; display: { name: string; description?: string } }
type Task = { id: string; project_id: string; title: string; prompt: string; state: string; revision: number; agent_id?: string; depends_on: string[]; workspace_mode: string; session_id?: string; run_id?: string; block_reason?: string; terminal_evidence?: string; created_at: string; updated_at: string }
type Message = Omit<TownCommunicationMessage, 'created_at'> & { id: string; revision: number; created_at: string }
type Quota = { provider: string; account_scope: string; status: string; fetched_at?: string; expires_at?: string; windows: Array<{ used_percent: number; window_minutes?: number; resets_at?: string; exhausted?: boolean }>; source: string; last_error?: string }
type Snapshot = { cursor: number; generated_at: string; settings: { revision: number; discovery_root: string; saved_viewpoints: Array<{ id: string; name: string; position: [number,number,number]; target: [number,number,number] }>; pinned_project_ids: string[] }; discovery: { status: 'complete'|'partial'|'error'; root: string; scanned_at: string; project_count: number; skipped_count: number; error_count: number; warnings: string[] } | null; projects: Project[]; agents: Array<{id:string;display_name:string;state?:string;profile:string;home_project_id?:string;task_id?:string;session_id?:string;run_id?:string}>; tasks: Task[]; messages: Message[]; quota: Quota }

export type TownControlGroup = 'navigation' | 'view' | 'projects' | 'operations'
export type TownCardSelection =
  | { type: 'project'; id: string }
  | { type: 'resident'; id: string }
  | { type: 'discovery'; id: string }
  | { type: 'hall' }

export interface TownUIState {
  rail: { group: TownControlGroup | null; pinned: boolean }
  card: TownCardSelection | null
}

export interface TownSavedViewPose {
  position: [number, number, number]
  target: [number, number, number]
}

export function applyTownSavedView(controls: Pick<OrbitControls, 'object' | 'target' | 'update'>, view: TownSavedViewPose): void {
  controls.target.set(...view.target)
  controls.object.position.set(...view.position)
  controls.update()
}

export type TownUIAction =
  | { type: 'group-enter'; group: TownControlGroup }
  | { type: 'group-leave'; group: TownControlGroup }
  | { type: 'group-toggle'; group: TownControlGroup }
  | { type: 'select-card'; selection: TownCardSelection }
  | { type: 'close-card' }
  | { type: 'escape' }

export const initialTownUIState: TownUIState = { rail: { group: null, pinned: false }, card: null }

export function townUIReducer(state: TownUIState, action: TownUIAction): TownUIState {
  switch (action.type) {
    case 'group-enter':
      if (state.rail.group === action.group && state.rail.pinned) return state
      return { ...state, rail: { group: action.group, pinned: false } }
    case 'group-leave':
      return state.rail.group === action.group && !state.rail.pinned
        ? { ...state, rail: { group: null, pinned: false } }
        : state
    case 'group-toggle':
      return state.rail.group === action.group && state.rail.pinned
        ? { ...state, rail: { group: null, pinned: false } }
        : { ...state, rail: { group: action.group, pinned: true } }
    case 'select-card':
      return { ...state, rail: { group: null, pinned: false }, card: action.selection }
    case 'close-card':
      return { ...state, card: null }
    case 'escape':
      return state.rail.group
        ? { ...state, rail: { group: null, pinned: false } }
        : { ...state, card: null }
  }
}

export const TOWN_LABELS_KEY = 'base.town.labels.v1'

export function readTownLabelsVisible(storage: Pick<Storage, 'getItem'>): boolean {
  // Keep the map quiet by default; the communication marker remains visible
  // even when optional office labels are off.
  return storage.getItem(TOWN_LABELS_KEY) === 'true'
}

export function writeTownLabelsVisible(visible: boolean, storage: Pick<Storage, 'setItem'>): void {
  storage.setItem(TOWN_LABELS_KEY, String(visible))
}

const endpoint = process.env.NEXT_PUBLIC_HARNESS_HTTP_URL || 'http://localhost:7337'
const activeStates = new Set(['dispatching','running','waiting_user'])
const controlGroups: Array<{ id: TownControlGroup; label: string; icon: 'navigation'|'view'|'projects'|'operations' }> = [
  { id: 'navigation', label: 'Navigate', icon: 'navigation' },
  { id: 'view', label: 'View', icon: 'view' },
  { id: 'projects', label: 'Projects', icon: 'projects' },
  { id: 'operations', label: 'Operations', icon: 'operations' },
]

function TownIcon({ kind }: { kind: 'navigation'|'view'|'projects'|'operations' }) {
  const paths: Record<typeof kind, string> = {
    navigation: 'M4 10.5 12 4l8 6.5M6.5 9.5V20h11V9.5M9.5 20v-6h5v6',
    view: 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
    projects: 'M3.5 7.5h7l2 2h8v9h-17v-11ZM3.5 7.5v-3h6l2 3',
    operations: 'M12 3.5 19 6v5.3c0 4.1-2.8 7.5-7 9.2-4.2-1.7-7-5.1-7-9.2V6l7-2.5ZM9 12l2 2 4-4',
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={paths[kind]} /></svg>
}

function TaskCard({
  task,
  messages,
  agentName,
  names,
  userId,
  busy,
  draft,
  onDraftChange,
  onDispatch,
  onCancel,
  onSend,
  onOpenProject,
  onOpenAgent,
}: {
  task: Task
  messages: Message[]
  agentName?: string
  names?: Record<string, string>
  userId: string
  busy: boolean
  draft: string
  onDraftChange: (value: string) => void
  onDispatch: () => void
  onCancel: () => void
  onSend: () => void
  onOpenProject?: () => void
  onOpenAgent?: () => void
}) {
  return <article className="town-task-card" data-state={task.state}>
    <div className="town-task-top"><b>{task.title}</b><span>{task.state.replaceAll('_',' ')}</span></div>
    <p>{task.prompt}</p>
    <div className="town-task-meta">{task.workspace_mode}{agentName ? ` · ${agentName}` : ''}</div>
    <details className="town-work-record"><summary>Work record</summary><div>{task.block_reason?<p>Held because: {task.block_reason}</p>:null}{task.session_id?<span>Session · {task.session_id.slice(0,8)}</span>:null}{task.run_id?<span>Run · {task.run_id.slice(0,8)}</span>:null}{task.terminal_evidence?<p>Terminal evidence: {task.terminal_evidence}</p>:null}</div></details>
    {messages.length ? <details className="town-task-messages"><summary>Worker conversation · {messages.length}</summary>{messages.map(message => <p key={message.id}><b>{isTownHumanEndpoint(message.from, userId) ? 'You' : names?.[message.from] ?? 'Unknown worker'}:</b> {message.body}{isTownHumanEndpoint(message.from, userId) && message.kind === 'status' ? <small className="town-message-state">{message.state === 'acknowledged' ? 'Read by worker' : 'Delivered · awaiting worker read'}</small> : message.kind === 'answer' ? <small className="town-message-state">{townAnswerReceiptLabel(message) ?? 'Reply recorded · continuation receipt pending'}</small> : null}</p>)}</details> : null}
    {agentName ? <div className="town-direct-message"><label>Message {agentName}<input aria-label={`Message ${agentName}`} value={draft} onChange={event => onDraftChange(event.target.value)} maxLength={4000}/></label><button type="button" onClick={onSend} disabled={busy || !draft.trim()}>Send</button></div> : null}
    {onOpenProject || onOpenAgent ? <div className="town-task-links">{onOpenProject ? <button type="button" onClick={onOpenProject}>Open office ↗</button> : null}{onOpenAgent ? <button type="button" onClick={onOpenAgent}>Open worker ↗</button> : null}</div> : null}
    {['draft','ready','queued_quota','queued_dependency','queued_workspace','queued_concurrency','failed','interrupted'].includes(task.state) ? <button type="button" onClick={onDispatch} disabled={busy}>Retry through gates</button> : null}
    {activeStates.has(task.state) ? <button type="button" onClick={onCancel} disabled={busy}>Cancel worker</button> : null}
  </article>
}

function MessageLedger({ messages, userId, names, questionDrafts, sendingQuestion, answerFeedback, onDraftChange, onAnswer }: {
  messages: Message[]
  userId: string
  names?: Record<string, string>
  questionDrafts: Record<string, string>
  sendingQuestion?: string
  answerFeedback?: Record<string, string>
  onDraftChange: (id: string, value: string) => void
  onAnswer: (question: Message, body: string) => void
}) {
  const ordered = [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const endpointName = (value: string) => isTownHumanEndpoint(value, userId) ? 'You' : names?.[value] ?? 'Unknown worker'
  return <div className="town-message-ledger">
    {ordered.map(message => {
      const isQuestion = message.kind === 'question' && isTownHumanEndpoint(message.to, userId) && message.state === 'delivered' && Boolean(message.continuation_id)
      const approval = Boolean(message.options?.includes('allow') && message.options?.includes('deny'))
      const receipt = message.kind === 'answer' ? townAnswerReceiptLabel(message) ?? 'Reply recorded · continuation receipt pending' : undefined
      const submitAnswer = (body: string) => { onDraftChange(message.id, body); onAnswer(message, body) }
      return <article className={`town-message town-message--${message.kind}`} key={message.id} data-state={message.state}>
        <div className="town-message-head"><b>{endpointName(message.from)}</b><span>to {endpointName(message.to)} · {message.kind}</span><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString()}</time></div>
        <p>{message.body}</p>
        {message.kind === 'status' && isTownHumanEndpoint(message.from, userId) ? <small className="town-message-state">{message.state === 'acknowledged' ? 'Read by worker' : 'Delivered · awaiting worker read'}</small> : null}
        {receipt ? <small className={`town-receipt${message.answer_outcome?.resumed ? ' town-receipt--success' : message.answer_outcome?.state?.startsWith('queued_') ? ' town-receipt--queued' : ' town-receipt--error'}`}>{receipt}</small> : null}
        {answerFeedback?.[message.id] ? <small className="town-receipt town-receipt--pending">{answerFeedback[message.id]}</small> : null}
        {isQuestion ? <div className="town-question-composer"><strong>Your answer</strong>{approval ? <div className="town-choice-row"><button type="button" onClick={()=>submitAnswer('allow')} disabled={sendingQuestion===message.id}>Allow</button><button type="button" onClick={()=>submitAnswer('deny')} disabled={sendingQuestion===message.id}>Deny</button></div> : <>{message.options?.length ? <div className="town-choice-row">{message.options.map(option=><button type="button" key={option} onClick={()=>submitAnswer(option)} disabled={sendingQuestion===message.id}>{option}</button>)}</div> : null}<textarea aria-label={`Reply to ${message.from}`} value={questionDrafts[message.id]??''} onChange={event=>onDraftChange(message.id,event.target.value)} placeholder="Write a clear answer…" maxLength={4000}/><button type="button" onClick={()=>submitAnswer(questionDrafts[message.id]?.trim()??'')} disabled={sendingQuestion===message.id||!questionDrafts[message.id]?.trim()}>{sendingQuestion===message.id?'Sending your reply…':'Send reply'}</button></>}</div> : null}
        {isQuestion && answerFeedback?.[message.id]?.startsWith('Delivery unconfirmed') ? <button type="button" className="town-retry-answer" onClick={()=>onAnswer(message, questionDrafts[message.id]?.trim() ?? '')} disabled={sendingQuestion===message.id || !questionDrafts[message.id]?.trim()}>Retry same reply</button> : null}
      </article>
    })}
  </div>
}

export function TownClient() {
  const {userId,operator}=useSharedHarnessWS();const profile=operator.profile
  const scope=useMemo(()=>({userId,profile}),[userId,profile])
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);const [loadError,setLoadError]=useState('');const [selected,setSelected]=useState<string>();const [selectedAgent,setSelectedAgent]=useState<string>();const [mode,setMode]=useState<TownMode>('day');const [labelsVisible,setLabelsVisible]=useState(false);const [reducedMotion,setReducedMotion]=useState(false);const [instruction,setInstruction]=useState('');const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [taskTitle,setTaskTitle]=useState('');const [taskPrompt,setTaskPrompt]=useState('');const [quotaBusy,setQuotaBusy]=useState(false);const [layoutRevision,setLayoutRevision]=useState(0);const [viewName,setViewName]=useState('');const [projectSearch,setProjectSearch]=useState('');const [messageDrafts,setMessageDrafts]=useState<Record<string,string>>({});const [questionDrafts,setQuestionDrafts]=useState<Record<string,string>>({});const [sendingQuestion,setSendingQuestion]=useState<string>();const [answerFeedback,setAnswerFeedback]=useState<Record<string,string>>({});const answerKeys=useRef<Record<string,string>>({})
  const [ui,dispatchUI]=useReducer(townUIReducer,initialTownUIState)
  const controls=useRef<OrbitControls|null>(null);const focusProject=useRef<((id:string)=>void)|null>(null);const focusOverview=useRef<(()=>void)|null>(null);const cursor=useRef(0);const refreshRef=useRef<()=>void>(()=>{});const groupTriggerRefs=useRef<Partial<Record<TownControlGroup,HTMLButtonElement|null>>>({});const groupWrapperRefs=useRef<Partial<Record<TownControlGroup,HTMLDivElement|null>>>({});const cardCloseRef=useRef<HTMLButtonElement|null>(null);const suppressFocusOpen=useRef<TownControlGroup|null>(null)
  useEffect(()=>{setMode(parseTownMode(localStorage.getItem(TOWN_MODE_KEY)));setLabelsVisible(readTownLabelsVisible(localStorage));const query=window.matchMedia('(prefers-reduced-motion: reduce)');setReducedMotion(query.matches);const change=(event:MediaQueryListEvent)=>setReducedMotion(event.matches);query.addEventListener('change',change);return()=>query.removeEventListener('change',change)},[])
  useEffect(()=>{
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||(!ui.rail.group&&!ui.card))return
      event.preventDefault()
      const focusedGroup=ui.rail.group
      const restoreGroupFocus=ui.rail.pinned&&focusedGroup
      dispatchUI({type:'escape'})
      if(restoreGroupFocus)requestAnimationFrame(()=>{suppressFocusOpen.current=focusedGroup;groupTriggerRefs.current[focusedGroup]?.focus()})
      else if(!focusedGroup&&ui.card)requestAnimationFrame(()=>document.querySelector<HTMLElement>('.town-world')?.focus({preventScroll:true}))
    }
    document.addEventListener('keydown',onKeyDown)
    return()=>document.removeEventListener('keydown',onKeyDown)
  },[ui])
  useEffect(()=>{
    if(!ui.card)return
    requestAnimationFrame(()=>cardCloseRef.current?.focus({preventScroll:true}))
  },[ui.card])
  const refresh=useCallback(async()=>{try{const response=await fetch(buildScopedUrl(endpoint,'/town/snapshot',scope));if(!response.ok)throw new Error(`Town snapshot unavailable (${response.status})`);const next=await response.json() as Snapshot;cursor.current=next.cursor;setSnapshot(next);setLoadError('')}catch(error){setLoadError(error instanceof Error?error.message:'Town unavailable')}},[scope])
  useEffect(()=>{refreshRef.current=()=>{void refresh()};void refresh();const poll=setInterval(()=>void refresh(),15000);let source:EventSource|undefined;let retry:ReturnType<typeof setTimeout>|undefined;let disposed=false;let queued=false
    const changed=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;if(!disposed)void refresh()})}
    const connect=()=>{if(disposed)return;source=new EventSource(buildScopedUrl(endpoint,'/town/events',scope,{after:String(cursor.current)}));const kinds=['project.discovered','project.updated','discovery.completed','settings.updated','task.created','task.transitioned','task.assigned','message.created','message.answered','message.acknowledged','quota.updated','continuation.closed','resync'];for(const kind of kinds)source.addEventListener(kind,changed);source.onerror=()=>{source?.close();if(!disposed)retry=setTimeout(connect,1500)}}
    connect();return()=>{disposed=true;clearInterval(poll);source?.close();if(retry)clearTimeout(retry)}
  },[refresh,scope])
  const project=snapshot?.projects.find(item=>item.id===selected)
  const visibleProjects=(snapshot?.projects??[]).filter(item=>`${item.display.name} ${item.path}`.toLowerCase().includes(projectSearch.toLowerCase())).slice(0,300)
  const activeProjectIds=useMemo(()=>new Set((snapshot?.tasks??[]).filter(task=>activeStates.has(task.state)).map(task=>task.project_id)),[snapshot?.tasks])
  const pinnedProjectIds=useMemo(()=>new Set(snapshot?.settings.pinned_project_ids??[]),[snapshot?.settings.pinned_project_ids])
  const layoutInputs=useRef({projects:[] as Project[],active:new Set<string>(),pinned:new Set<string>()});layoutInputs.current={projects:snapshot?.projects??[],active:activeProjectIds,pinned:pinnedProjectIds}
  const layoutStamp=townLayoutStamp((snapshot?.projects??[]).map(item=>item.id),layoutRevision)
  const layout=useMemo(()=>layoutProjects(layoutInputs.current.projects,layoutInputs.current.active,layoutInputs.current.pinned),[layoutStamp])
  const people=useMemo(()=>projectAgentPresence(snapshot?.agents??[],snapshot?.tasks??[],layout),[snapshot?.agents,snapshot?.tasks,layout])
  const questions=snapshot?.messages.filter(item=>item.kind==='question'&&isTownHumanEndpoint(item.to,userId)&&item.state==='delivered'&&item.continuation_id)??[]
  const allTasks=snapshot?.tasks??[]
  const quota=snapshot?.quota
  const quotaLabel=!quota?(loadError?'UNAVAILABLE':'CHECKING'):quota.status.toUpperCase()
  const card=ui.card
  const cardResident=card?.type==='resident'?people.find(person=>person.id===card.id):undefined
  const cardProjectId=card?.type==='project'?card.id:card?.type==='resident'?cardResident?.projectId:undefined
  const cardProject=snapshot?.projects.find(item=>item.id===cardProjectId)
  const residentTaskId=card?.type==='resident'?cardResident?.taskId:undefined
  const cardTasks=card?.type==='resident'
    ? (residentTaskId ? snapshot?.tasks.filter(task=>task.id===residentTaskId)??[] : [])
    : cardProject ? snapshot?.tasks.filter(task=>task.project_id===cardProject.id)??[] : []
  const cardTaskIds=new Set(cardTasks.map(task=>task.id))
  const cardQuestions=questions.filter(question=>card?.type==='resident'?Boolean(question.task_id&&cardTaskIds.has(question.task_id)):question.project_id===cardProjectId||Boolean(question.task_id&&cardTaskIds.has(question.task_id)))
  const cardMessages=(snapshot?.messages??[]).filter(message=>card?.type==='resident'
    ? Boolean(message.task_id && cardTaskIds.has(message.task_id))
    : message.project_id===cardProjectId)
  const councilMessages=(snapshot?.messages??[]).filter(message=>!isTownHumanEndpoint(message.from,userId)&&!isTownHumanEndpoint(message.to,userId))
  const councilGroups=townConversationGroups(councilMessages)
  const agentNames=useMemo(()=>Object.fromEntries((snapshot?.agents??[]).map(agent=>[agent.id,agent.display_name])),[snapshot?.agents])
  const cardPeople=people.filter(person=>person.projectId===cardProjectId)
  const lastCommit=(p:Project)=>p.git.last_commit_at?new Date(p.git.last_commit_at).toLocaleDateString():p.git.status==='unknown'?'unknown':'not recorded'
  const trackedFiles=(size?:TrackedFileSize)=>{
    if(!size)return 'Unmeasured'
    if(size.tracked_regular_files===undefined)return size.status==='unknown'?'Unavailable':'No count recorded'
    const count=new Intl.NumberFormat().format(size.tracked_regular_files)
    return size.status==='complete'?`${count} tracked files`:`≥ ${count} tracked files · ${size.status}`
  }
  const selectProject=(id:string)=>{setSelected(id);setSelectedAgent(undefined);dispatchUI({type:'select-card',selection:{type:'project',id}})}
  const selectResident=(person:AgentPresence)=>{setSelectedAgent(person.id);setSelected(person.projectId);dispatchUI({type:'select-card',selection:{type:'resident',id:person.id}});if(person.projectId)focusProject.current?.(person.projectId)}
  const selectDiscovery=(id:string)=>{setSelected(undefined);setSelectedAgent(undefined);dispatchUI({type:'select-card',selection:{type:'discovery',id}})}
  const selectHall=()=>{setSelected(undefined);setSelectedAgent(undefined);dispatchUI({type:'select-card',selection:{type:'hall'}})}
  const returnCentre=()=>{setSelected(undefined);setSelectedAgent(undefined);focusOverview.current?.();dispatchUI({type:'close-card'})}
  const closeCard=()=>{dispatchUI({type:'close-card'});requestAnimationFrame(()=>document.querySelector<HTMLElement>('.town-world')?.focus({preventScroll:true}))}
  const focusTemple=()=>{selectHall();if(focusProject.current)focusProject.current('town-temple');else if(controls.current){controls.current.target.set(0,1,0);controls.current.object.position.set(31,25,34)}}
  const act=async(path:string,method:string,payload:unknown)=>{setBusy(true);setNotice('');try{const response=await fetch(buildScopedUrl(endpoint,path,scope),{method,headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw new Error(result.error??`Request failed (${response.status})`);await refresh();return result}catch(error){setNotice(error instanceof Error?error.message:'Town action failed');return null}finally{setBusy(false)}}
  const startOrchestrator=async()=>{if(!snapshot||!instruction.trim())return;const result=await act('/town/orchestrate','POST',{instruction:instruction.trim(),project_ids:selected?[selected]:undefined,revision:snapshot.cursor});if(result){setNotice(result.decision==='queued'?`Orchestrator queued · ${result.reason}`:'Orchestrator run started');setInstruction('')}}
  const dispatchTask=async(task:Task)=>{const result=await act(`/town/tasks/${task.id}/dispatch`,'POST',{revision:task.revision});if(result)setNotice(result.decision==='queued'?`Task queued · ${result.reason}`:'Worker started')}
  const cancelTask=async(task:Task)=>{await act(`/town/tasks/${task.id}/cancel`,'POST',{revision:task.revision})}
  const createTask=async()=>{if(!snapshot||!project||!taskTitle.trim()||!taskPrompt.trim())return;const result=await act('/town/tasks','POST',{project_id:project.id,title:taskTitle.trim(),prompt:taskPrompt.trim(),workspace_mode:'shared_checkout',revision:snapshot.cursor});if(result){setTaskTitle('');setTaskPrompt('');setNotice('Task saved as draft')}}
  const refreshProjects=async()=>{if(!snapshot)return;const result=await act('/town/discovery/refresh','POST',{});if(result){setLayoutRevision(value=>value+1);setNotice(`Survey complete · ${result.projects.length} offices found`)}}
  const refreshQuota=async()=>{setQuotaBusy(true);try{const response=await fetch(buildScopedUrl(endpoint,'/town/quota',scope));if(!response.ok)throw new Error(`Capacity check failed (${response.status})`);const nextQuota=await response.json() as Quota;setSnapshot(current=>current?{...current,quota:nextQuota}:current)}catch(error){setNotice(error instanceof Error?error.message:'Capacity unavailable')}finally{setQuotaBusy(false)}}
  const answerQuestion=async(question:Message, body:string)=>{if(!body.trim()||sendingQuestion)return;setSendingQuestion(question.id);setAnswerFeedback(current=>({...current,[question.id]:'Sending your reply…'}));const storageKey=`base.town.answer-key.v1:${question.id}`;let answerKey: string | undefined = answerKeys.current[question.id];if(!answerKey){try{answerKey=sessionStorage.getItem(storageKey)??undefined}catch{}answerKey??=crypto.randomUUID();answerKeys.current[question.id]=answerKey;try{sessionStorage.setItem(storageKey,answerKey!)}catch{}}const resolvedAnswerKey=answerKey!;try{const response=await fetch(buildScopedUrl(endpoint,`/town/messages/${question.id}/answer`,scope),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:question.revision,body:body.trim(),answer_key:resolvedAnswerKey})});const result=await response.json().catch(()=>({}));if(!response.ok){setAnswerFeedback(current=>({...current,[question.id]:`Reply rejected · ${result.error??`Request failed (${response.status})`}`}));setNotice(result.error??`Reply rejected (${response.status})`);return}const receipt=townAnswerReceiptLabel(result.message??{answer_outcome:{resumed:Boolean(result.resumed),state:result.state,error:result.resume_error}});setAnswerFeedback(current=>({...current,[question.id]:receipt??'Reply received · receipt recorded'}));setQuestionDrafts(current=>({...current,[question.id]:''}));await refresh()}catch(error){setAnswerFeedback(current=>({...current,[question.id]:'Delivery unconfirmed · refresh or retry'}));setNotice(error instanceof Error?error.message:'Delivery unconfirmed')}finally{setSendingQuestion(undefined)}}
  const saveView=async(view:{name:string;position:[number,number,number];target:[number,number,number]})=>{if(!snapshot)return;const name=viewName.trim()||view.name;if(!name)return;const saved=[...snapshot.settings.saved_viewpoints,{...view,name,id:crypto.randomUUID()}];const result=await act('/town/settings','PATCH',{revision:snapshot.settings.revision,saved_viewpoints:saved});if(result)setViewName('')}
  const saveCurrentView=()=>{const current=controls.current;if(!current)return;const p=current.object.position,t=current.target;void saveView({name:`View ${(snapshot?.settings.saved_viewpoints.length??0)+1}`,position:[p.x,p.y,p.z],target:[t.x,t.y,t.z]})}
  const togglePin=async()=>{if(!snapshot||!project)return;const pins=new Set(snapshot.settings.pinned_project_ids);pins.has(project.id)?pins.delete(project.id):pins.add(project.id);const result=await act('/town/settings','PATCH',{revision:snapshot.settings.revision,pinned_project_ids:[...pins]});if(result)setLayoutRevision(value=>value+1)}
  const sendWorkerMessage=async(task:Task)=>{if(!snapshot||!messageDrafts[task.id]?.trim())return;const result=await act('/town/messages','POST',{project_id:task.project_id,task_id:task.id,from:userId,to:task.agent_id??'worker',kind:'status',body:messageDrafts[task.id].trim(),revision:snapshot.cursor});if(result){setMessageDrafts(current=>({...current,[task.id]:''}));setNotice('Message delivered · awaiting worker read')}}
  const loadView=(view:Snapshot['settings']['saved_viewpoints'][number])=>{if(controls.current)applyTownSavedView(controls.current,view)}
  const setTownMode=(next:TownMode)=>{setMode(next);localStorage.setItem(TOWN_MODE_KEY,next)}
  const toggleLabels=()=>setLabelsVisible(current=>{const next=!current;writeTownLabelsVisible(next,localStorage);return next})
  const taskCard=(task:Task, links=false)=><TaskCard key={task.id} task={task} messages={snapshot?.messages.filter(message=>message.task_id===task.id)??[]} agentName={snapshot?.agents.find(agent=>agent.id===task.agent_id)?.display_name} names={agentNames} userId={userId} busy={busy} draft={messageDrafts[task.id]??''} onDraftChange={value=>setMessageDrafts(current=>({...current,[task.id]:value}))} onDispatch={()=>void dispatchTask(task)} onCancel={()=>void cancelTask(task)} onSend={()=>void sendWorkerMessage(task)} onOpenProject={links?()=>{selectProject(task.project_id);focusProject.current?.(task.project_id)}:undefined} onOpenAgent={links&&task.agent_id?()=>{const person=people.find(item=>item.id===task.agent_id);if(person)selectResident(person)}:undefined}/> 
  const quotaDetail=<>
    <p className="town-subtle">{quota?.source??(snapshot?'Awaiting provider check':'Capacity state unavailable until the Town snapshot loads')}{quota?.last_error?` · ${quota.last_error}`:''}</p>
    {quota?.status==='unsupported'?<p className="town-capacity-help">No authoritative quota reader is available for {profile||'the selected profile'} ({quota.provider}). Automatic dispatch stays queued until live capacity is verified.</p>:null}
    {quota?.windows.map((window,index)=><div className="town-window" key={index}><span>{window.window_minutes?`${window.window_minutes} min window`:`Window ${index+1}`}</span><strong>{Math.max(0,100-window.used_percent)}% remaining</strong><div><i style={{width:`${Math.max(0,100-window.used_percent)}%`}}/></div></div>)}
    <small className="town-freshness">{quota?.fetched_at?`Checked ${new Date(quota.fetched_at).toLocaleTimeString()}`:'Capacity has not been verified'}</small>
  </>
  const renderGroup=(group:TownControlGroup)=>{
    if(group==='navigation')return <div className="town-group-content town-navigation-links">
      <p className="town-panel-kicker">BASE / HARNESS</p>
      <Link href="/">Analyst workspace <span>↗</span></Link><Link href="/ops">Operations room <span>↗</span></Link><Link href="/home">Assistant home <span>↗</span></Link><Link href="/town" aria-current="page">Orchestrator Town <span>●</span></Link>
      <small>Signed in as {userId} · {profile||'loading profile'}</small>
    </div>
    if(group==='view')return <div className="town-group-content">
      <span className="town-panel-kicker">WORLD VIEW</span>
      <div className="town-setting-row"><span>Lighting</span><div className="town-mode-switch" role="group" aria-label="Town lighting"><button type="button" aria-pressed={mode==='day'} onClick={()=>setTownMode('day')}>Day</button><button type="button" aria-pressed={mode==='night'} onClick={()=>setTownMode('night')}>Night</button></div></div>
      <div className="town-setting-row"><span>Map labels</span><button className="town-switch" type="button" role="switch" aria-label="Map labels" aria-checked={labelsVisible} onClick={toggleLabels}><i/><b>{labelsVisible?'On':'Off'}</b></button></div>
      <button className="town-action-row" type="button" onClick={returnCentre}><span className="town-action-icon">⌖</span><span><b>Return to centre</b><small>Fit the active district</small></span></button>
      <button className="town-action-row" type="button" onClick={focusTemple}><span className="town-action-icon">⌂</span><span><b>Focus Town Temple</b><small>View the command landmark</small></span></button>
      <div className="town-saved-views"><span className="town-panel-kicker">SAVED VIEWS</span>
        {snapshot?<label className="town-view-name"><span className="town-sr-only">Saved viewpoint name</span><input value={viewName} onChange={event=>setViewName(event.target.value)} placeholder={`View ${snapshot.settings.saved_viewpoints.length+1}`} maxLength={64}/><button type="button" onClick={saveCurrentView} disabled={!controls.current}>Save view</button></label>:<p className="town-subtle">Views are available after the Town connects.</p>}
        {snapshot?.settings.saved_viewpoints.length?<div className="town-saved-view-list">{snapshot.settings.saved_viewpoints.map(view=><button type="button" key={view.id} onClick={()=>loadView(view)}><span>◉</span>{view.name}</button>)}</div>:<small className="town-muted">No saved viewpoints yet.</small>}
      </div>
      <div className="town-help-card"><b>Navigate the town</b><span>Drag to orbit · right-drag to pan · scroll to zoom. Arrow keys orbit; + and − zoom.</span><span>Office labels and building clicks open the matching detail card.</span><span className="town-legend"><i className="legend-office"/> Office <i className="legend-active"/> Active work <i className="legend-pin"/> Pinned <i className="legend-resident"/> Resident</span></div>
    </div>
    if(group==='projects')return <div className="town-group-content">
      <div className="town-panel-heading"><div><span className="town-panel-kicker">PROJECT REGISTRY</span><h2>{snapshot?.projects.length??0} offices</h2></div><button type="button" className="town-small-action" onClick={()=>void refreshProjects()} disabled={busy||!snapshot}>{busy?'Surveying…':'Survey'}</button></div>
      <label className="town-search"><span className="town-sr-only">Search projects by name or path</span><span aria-hidden="true">⌕</span><input value={projectSearch} onChange={event=>setProjectSearch(event.target.value)} placeholder="Search name or path"/></label>
      {snapshot?<div className={`town-discovery-summary town-discovery-summary--${snapshot.discovery?.status??'unknown'}`}><b>{snapshot.discovery?`${snapshot.discovery.status==='complete'?'Survey complete':snapshot.discovery.status==='partial'?'Partial survey':'Survey failed'} · ${snapshot.discovery.project_count} repos`:'Survey not run'}</b><span title={snapshot.discovery?.root??snapshot.settings.discovery_root}>Root · {snapshot.discovery?.root??snapshot.settings.discovery_root}</span><small>{snapshot.discovery?`${new Date(snapshot.discovery.scanned_at).toLocaleString()}${snapshot.discovery.warnings.length?` · ${snapshot.discovery.warnings.join(', ')}`:''}${snapshot.discovery.error_count?` · ${snapshot.discovery.error_count} errors`:''}${snapshot.discovery.skipped_count?` · ${snapshot.discovery.skipped_count} skipped`:''}`:'No completed discovery record'}</small></div>:<p className="town-subtle">{loadError?`Registry unavailable · ${loadError}`:'Loading project registry…'}</p>}
      <div className="town-directory-list">{visibleProjects.map(item=><button type="button" key={item.id} className={item.id===selected?'is-selected':''} onClick={()=>{selectProject(item.id);focusProject.current?.(item.id)}} title={item.path}><span>{item.display.name}</span><small>{item.path}</small></button>)}</div>
      {visibleProjects.length===300?<small className="town-muted">Showing first 300 matches. Refine the search.</small>:null}
      <span className="town-panel-footnote">All surveyed offices remain available here, including distant inactive repositories.</span>
    </div>
    return <div className="town-group-content town-operations-content">
      <span className="town-panel-kicker">REAL TOWN OPERATIONS</span><p className="town-operation-context">{userId} · {profile||'loading profile'} · {snapshot?`cursor ${snapshot.cursor}`:'waiting for snapshot'}</p>
      <section className="town-operation-section town-orchestrator-form"><div className="town-section-title"><h3>ORCHESTRATOR</h3><span>{quotaLabel}</span></div><p>Starts real orchestrator work. Workers begin only when provider capacity is verified.</p><label className="town-sr-only" htmlFor="town-instruction">Orchestrator instruction</label><textarea id="town-instruction" value={instruction} onChange={event=>setInstruction(event.target.value)} placeholder="Ask the orchestrator to inspect or coordinate work…" maxLength={20000}/><div className="town-command-actions"><select aria-label="Project scope" value={selected??''} onChange={event=>setSelected(event.target.value||undefined)}><option value="">All discovered projects</option>{snapshot?.projects.map(item=><option key={item.id} value={item.id}>{item.display.name}</option>)}</select><button type="button" onClick={()=>void startOrchestrator()} disabled={busy||!instruction.trim()||!snapshot}>Dispatch ↗</button></div></section>
      <section className="town-operation-section"><div className="town-section-title"><h3>WORK ORDERS</h3><span>{snapshot?allTasks.length.toString().padStart(2,'0'):'—'}</span></div>{!snapshot?<p role="status" className="town-subtle">{loadError?'Work order state unavailable. Reconnect to refresh real records.':'Loading durable work orders…'}</p>:allTasks.length?allTasks.map(task=>taskCard(task)):<p className="town-subtle">No work orders recorded.</p>}</section>
      <section className="town-operation-section"><div className="town-section-title"><h3>RESIDENTS</h3><span>{people.length.toString().padStart(2,'0')}</span></div>{people.length?people.map(person=><button type="button" className={`town-resident${selectedAgent===person.id?' is-selected':''}`} key={person.id} onClick={()=>selectResident(person)}><i data-pose={person.pose}/><span><b>{person.name}</b><small>{person.label}{person.taskTitle?` · ${person.taskTitle}`:''}</small></span><small className="town-resident-open">Details ↗</small></button>):<p className="town-subtle">No persisted agents yet. Residents appear when the harness creates an agent record.</p>}</section>
      <section className="town-operation-section"><div className="town-section-title"><h3>NEEDS YOUR WORD</h3><span>{snapshot?questions.length.toString().padStart(2,'0'):'—'}</span></div>{questions.length?<MessageLedger messages={questions} userId={userId} names={agentNames} questionDrafts={questionDrafts} sendingQuestion={sendingQuestion} answerFeedback={answerFeedback} onDraftChange={(id,value)=>setQuestionDrafts(current=>({...current,[id]:value}))} onAnswer={(question,body)=>void answerQuestion(question,body)}/>:<p className="town-subtle">{snapshot?'No open questions.':loadError?'Question state unavailable until Town reconnects.':'Loading durable questions…'}</p>}</section>
      <section className="town-operation-section"><div className="town-section-title"><h3>CAPACITY EVIDENCE</h3><span className={`town-status-dot town-status-dot--${quota?.status??'unknown'}`}/></div>{quotaDetail}<button type="button" className="town-small-action town-capacity-refresh" onClick={()=>void refreshQuota()} disabled={quotaBusy}>{quotaBusy?'Checking capacity…':'Check capacity'}</button></section>
      <section className="town-operation-section town-refresh-actions"><div className="town-section-title"><h3>REFRESH</h3></div><button type="button" className="town-action-row" onClick={()=>void refreshRef.current()}><span className="town-action-icon">↻</span><span><b>{loadError?'Reconnect to Town':'Refresh Town snapshot'}</b><small>Reload records and live state</small></span></button><small className="town-freshness">Last snapshot {snapshot?new Date(snapshot.generated_at).toLocaleTimeString():'not yet received'}</small></section>
    </div>
  }
  const cardTitle=card?.type==='project'?cardProject?.display.name??'Project office':card?.type==='resident'?cardResident?.name??'Town resident':card?.type==='discovery'?HISTORICAL_REFERENCES.find(site=>site.id===card.id)?.title??'Historical reference':'Town Hall'
  const cardKicker=card?.type==='project'?'PROJECT OFFICE':card?.type==='resident'?'RESIDENT':card?.type==='discovery'?'LANDSCAPE REFERENCE':'COMMAND HALL'
  const stateDescription=cardProject?activeProjectIds.has(cardProject.id)?`${cardTasks.length} work orders · ${cardTasks.filter(task=>activeStates.has(task.state)).length} active`:`${cardTasks.length} work orders · ${cardProject.git.status==='known'?(cardProject.git.dirty?'Git dirty':'Git clean'):`Git ${cardProject.git.status}`}`:''

  return <main className="town-page" data-testid="orchestrator-town" data-town-mode={mode}>
    <section className="town-canvas" aria-label="Orchestrator Town 3D canvas">
      <TownLandscapeScene projects={snapshot?.projects??[]} agents={snapshot?.agents??[]} tasks={snapshot?.tasks??[]} messages={snapshot?.messages??[]} userId={userId} layout={layout} selected={selected} activeProjectIds={activeProjectIds} pinnedProjectIds={pinnedProjectIds} layoutRevision={layoutRevision} mode={mode} reducedMotion={reducedMotion} labelsVisible={labelsVisible} onSelectHall={selectHall} onSelect={selectProject} onSelectAgent={selectResident} onSelectDiscovery={selectDiscovery} onReady={value=>{controls.current=value}} onFocusReady={focus=>{focusProject.current=focus}} onOverviewReady={overview=>{focusOverview.current=overview}}/>
      <nav className="town-control-rail" aria-label="Town controls">
        {controlGroups.map(group=>{
          const isOpen=ui.rail.group===group.id
          const badge=group.id==='view'?mode.toUpperCase():group.id==='projects'?snapshot?.projects.length??'—':group.id==='operations'?questions.length?questions.length:quota?.status==='available'?'OK':loadError?'!':'·':null
          const isError=group.id==='operations'&&(Boolean(loadError)||Boolean(quota?.last_error)||quota?.status==='exhausted'||quota?.status==='unsupported')
          return <div key={group.id} ref={element=>{groupWrapperRefs.current[group.id]=element}} className="town-control-group" data-open={isOpen?'true':'false'} data-pinned={isOpen&&ui.rail.pinned?'true':'false'} onPointerEnter={()=>dispatchUI({type:'group-enter',group:group.id})} onPointerLeave={()=>{if(!groupWrapperRefs.current[group.id]?.contains(document.activeElement))dispatchUI({type:'group-leave',group:group.id})}} onFocusCapture={()=>{if(suppressFocusOpen.current===group.id){suppressFocusOpen.current=null;return}dispatchUI({type:'group-enter',group:group.id})}} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))dispatchUI({type:'group-leave',group:group.id})}}>
            <button ref={element=>{groupTriggerRefs.current[group.id]=element}} className="town-control-trigger" type="button" aria-label={isError?`${group.label}, attention required`:group.label} aria-expanded={isOpen} aria-controls={`town-panel-${group.id}`} onClick={()=>dispatchUI({type:'group-toggle',group:group.id})}>
              <TownIcon kind={group.icon}/><span>{group.label}</span>{badge!==null?<small className={isError?'is-error':''}>{badge}</small>:null}
            </button>
            <div id={`town-panel-${group.id}`} className="town-control-panel" role="region" aria-label={`${group.label} controls`} hidden={!isOpen}>{renderGroup(group.id)}</div>
          </div>
        })}
      </nav>
      {card?<aside className="town-selection-card" aria-label={`${cardTitle} details`} data-testid="town-selection-card">
        <header className="town-card-header"><div><span className="town-panel-kicker">{cardKicker}</span><h2>{cardTitle}</h2>{stateDescription?<small>{stateDescription}</small>:null}</div><button ref={cardCloseRef} type="button" className="town-close-button" aria-label="Close details" onClick={closeCard}>×</button></header>
        <div className="town-card-body">
          {card?.type==='project'&&cardProject?<>
            {cardProject.display.description?<p className="town-card-description">{cardProject.display.description}</p>:null}
            <p className="town-project-path" title={cardProject.path}>{cardProject.path}</p>
            <div className="town-facts"><span>TRACKED SIZE <b>{trackedFiles(cardProject.size)}</b></span><span>GIT STATE <b>{cardProject.git.status==='known'?(cardProject.git.dirty?'DIRTY':'CLEAN'):cardProject.git.status.toUpperCase()}</b></span><span>HEAD <b>{cardProject.git.head?.slice(0,8)??'UNKNOWN'}</b></span><span>LAST COMMIT <b>{lastCommit(cardProject)}</b></span></div>
            {cardProject.size?<small className="town-size-source">Measured from Git tracked regular files · {new Date(cardProject.size.measured_at).toLocaleString()}{cardProject.size.max_entries?` · limit ${cardProject.size.max_entries.toLocaleString()}`:''}</small>:null}
            {cardProject.git.error?<p className="town-inline-error">Git state unavailable · {cardProject.git.error}</p>:null}
            <button type="button" className="town-pin-action" onClick={()=>void togglePin()} disabled={busy}>{pinnedProjectIds.has(cardProject.id)?'Unpin office':'Pin near Town Hall'}</button>
            <details className="town-task-create"><summary>Post a work order</summary><label>Title<input value={taskTitle} onChange={event=>setTaskTitle(event.target.value)} maxLength={200}/></label><label>Work description<textarea value={taskPrompt} onChange={event=>setTaskPrompt(event.target.value)} maxLength={20000}/></label><button type="button" onClick={()=>void createTask()} disabled={busy||!taskTitle.trim()||!taskPrompt.trim()}>Save draft</button></details>
            <div className="town-card-section"><div className="town-section-title"><h3>WORK ORDERS</h3><span>{cardTasks.length.toString().padStart(2,'0')}</span></div>{cardTasks.length?cardTasks.map(task=>taskCard(task)):<p className="town-subtle">No work orders here. The building is an office.</p>}</div>
            <div className="town-card-section"><div className="town-section-title"><h3>RESIDENTS HERE</h3><span>{cardPeople.length.toString().padStart(2,'0')}</span></div>{cardPeople.length?cardPeople.map(person=><button type="button" className="town-resident" key={person.id} onClick={()=>selectResident(person)}><i data-pose={person.pose}/><span><b>{person.name}</b><small>{person.label}{person.taskTitle?` · ${person.taskTitle}`:''}</small></span></button>):<p className="town-subtle">No residents are assigned to this office.</p>}</div>
            {cardMessages.length?<div className="town-card-section"><div className="town-section-title"><h3>CONVERSATION</h3><span>{cardMessages.length.toString().padStart(2,'0')}</span></div><MessageLedger messages={cardMessages} userId={userId} names={agentNames} questionDrafts={questionDrafts} sendingQuestion={sendingQuestion} answerFeedback={answerFeedback} onDraftChange={(id,value)=>setQuestionDrafts(current=>({...current,[id]:value}))} onAnswer={(question,body)=>void answerQuestion(question,body)}/></div>:null}
          </>:null}
          {card?.type==='resident'?<>
            {cardResident?<div className="town-resident-detail"><span className="town-resident-avatar" data-pose={cardResident.pose}><i/></span><div><b>{cardResident.label}</b><small>{cardResident.taskTitle??'No current work order'}</small></div></div>:<p className="town-subtle">This resident is not in the current snapshot.</p>}
            {snapshot?.agents.find(agent=>agent.id===card.id)?<div className="town-facts"><span>PROFILE <b>{snapshot.agents.find(agent=>agent.id===card.id)?.profile}</b></span><span>RUNTIME STATE <b>{snapshot.agents.find(agent=>agent.id===card.id)?.state??'UNKNOWN'}</b></span><span>SESSION <b>{snapshot.agents.find(agent=>agent.id===card.id)?.session_id?.slice(0,8)??'NOT LINKED'}</b></span><span>RUN <b>{snapshot.agents.find(agent=>agent.id===card.id)?.run_id?.slice(0,8)??'NOT LINKED'}</b></span></div>:null}
            {cardProject?<button type="button" className="town-link-project" onClick={()=>{dispatchUI({type:'select-card',selection:{type:'project',id:cardProject.id}});focusProject.current?.(cardProject.id)}}>View {cardProject.display.name} office ↗</button>:<p className="town-subtle">No project is linked to this resident in the current task projection.</p>}
            {cardMessages.length?<div className="town-card-section"><div className="town-section-title"><h3>CONVERSATION</h3><span>{cardMessages.length.toString().padStart(2,'0')}</span></div><MessageLedger messages={cardMessages} userId={userId} names={agentNames} questionDrafts={questionDrafts} sendingQuestion={sendingQuestion} answerFeedback={answerFeedback} onDraftChange={(id,value)=>setQuestionDrafts(current=>({...current,[id]:value}))} onAnswer={(question,body)=>void answerQuestion(question,body)}/></div>:null}
            {cardTasks.length?<div className="town-card-section"><div className="town-section-title"><h3>LINKED WORK ORDER</h3><span>{cardTasks.length.toString().padStart(2,'0')}</span></div>{cardTasks.map(task=>taskCard(task))}</div>:null}
          </>:null}
          {card?.type==='discovery'?(()=>{const site=HISTORICAL_REFERENCES.find(item=>item.id===card.id);return site?<section className="town-history-card"><span className="town-panel-kicker">SOURCED LANDSCAPE DETAIL</span><h3>{site.title}</h3><p>{site.caption}</p><a href={site.href} target="_blank" rel="noreferrer">{site.source} ↗</a></section>:<p className="town-subtle">This reference is not available.</p>})():null}
          {card?.type==='hall'?<>
            <p className="town-card-description">The Town Hall keeps durable council correspondence beside the command work orders. Every exchange below comes from a persisted agent message.</p>
            <div className="town-card-section"><div className="town-section-title"><h3>COUNCIL CORRESPONDENCE</h3><span>{councilMessages.length.toString().padStart(2,'0')}</span></div>{councilGroups.length?councilGroups.map(group=>{const workerId=group.messages.flatMap(message=>[message.from,message.to]).find(id=>!isTownHumanEndpoint(id,userId)&&agentNames[id]);const worker=workerId?people.find(person=>person.id===workerId):undefined;return <details className="town-council-group" key={group.key} open><summary><b>{group.taskId?`Work order ${group.taskId.slice(0,8)}`:'Unassigned council thread'}</b><small>{group.threadId?`thread ${group.threadId.slice(0,8)} · `:''}{group.messages.length} exchange{group.messages.length===1?'':'s'}{group.earlierStatusCount?` · ${group.earlierStatusCount} earlier update${group.earlierStatusCount===1?'':'s'}`:''}</small></summary><MessageLedger messages={group.messages as Message[]} userId={userId} names={agentNames} questionDrafts={questionDrafts} sendingQuestion={sendingQuestion} answerFeedback={answerFeedback} onDraftChange={(id,value)=>setQuestionDrafts(current=>({...current,[id]:value}))} onAnswer={(question,body)=>void answerQuestion(question,body)}/><div className="town-council-links"><button type="button" className="town-link-project" onClick={()=>{selectProject(group.projectId);focusProject.current?.(group.projectId)}}>Open exact office ↗</button>{worker?<button type="button" className="town-link-project" onClick={()=>selectResident(worker)}>Open exact worker ↗</button>:null}</div></details>}) : <p className="town-subtle">No agent-to-agent correspondence recorded.</p>}</div>
            <div className="town-card-section"><div className="town-section-title"><h3>WORK ORDERS</h3><span>{allTasks.length.toString().padStart(2,'0')}</span></div>{allTasks.length?allTasks.map(task=>taskCard(task,true)):<p className="town-subtle">No work orders recorded.</p>}</div>
            <div className="town-command-card"><span className="town-panel-kicker">GIVE THE TOWN A CHARGE</span><label className="town-sr-only" htmlFor="town-instruction-card">Orchestrator instruction</label><textarea id="town-instruction-card" value={instruction} onChange={event=>setInstruction(event.target.value)} placeholder="Ask the orchestrator to inspect or coordinate work…" maxLength={20000}/><div className="town-command-actions"><select aria-label="Project scope" value={selected??''} onChange={event=>setSelected(event.target.value||undefined)}><option value="">All discovered projects</option>{snapshot?.projects.map(item=><option key={item.id} value={item.id}>{item.display.name}</option>)}</select><button type="button" onClick={()=>void startOrchestrator()} disabled={busy||!instruction.trim()||!snapshot}>Dispatch ↗</button></div></div>
            <div className="town-facts"><span>KNOWN OFFICES <b>{snapshot?.projects.length??'—'}</b></span><span>RESIDENTS <b>{people.length}</b></span><span>OPEN QUESTIONS <b>{questions.length}</b></span><span>PROVIDER CAPACITY <b>{quotaLabel}</b></span></div>
            <div className="town-card-section"><div className="town-section-title"><h3>CAPACITY EVIDENCE</h3><span className={`town-status-dot town-status-dot--${quota?.status??'unknown'}`}/></div>{quotaDetail}<button type="button" className="town-small-action town-capacity-refresh" onClick={()=>void refreshQuota()} disabled={quotaBusy}>{quotaBusy?'Checking capacity…':'Check capacity'}</button></div>
            <button type="button" className="town-link-project" onClick={()=>dispatchUI({type:'group-toggle',group:'operations'})}>Open all operations ↗</button>
          </>:null}
        </div>
      </aside>:null}
      {loadError?<span className="town-sr-only" role="alert">Town connection unavailable · {loadError}</span>:notice?<div className="town-toast" role="status" aria-live="polite">{notice}</div>:null}
    </section>
  </main>
}

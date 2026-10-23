const $ = id => document.getElementById(id);
const chat = $('chat');
let state = null;
let activePlan = null;
let chatBusy = false;
let toastTimer;
let taskFilter = 'all';
let priorityFilter = 'all';
let planTab = 'proposed';

const titles = { overview:'Overview', tasks:'Tasks', plans:'Study plans', recovery:'Recovery', exams:'Exams', assistant:'Assistant', activity:'Activity / Integrations' };
const sessionId = sessionStorage.getItem('studymate-session') || crypto.randomUUID();
sessionStorage.setItem('studymate-session', sessionId);
const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const daysBetween = (left, right) => Math.round((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86400000);

function notify(message, error = false) {
  const element = $('toast'); element.textContent = message; element.classList.toggle('error', error); element.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { element.hidden = true; }, 3500);
}
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type':'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function showView(view) {
  if (!titles[view]) view = 'overview';
  document.querySelectorAll('[data-view]').forEach(section => { const active = section.dataset.view === view; section.hidden = !active; section.classList.toggle('active', active); });
  document.querySelectorAll('[data-nav]').forEach(link => { const active = link.dataset.nav === view; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  $('view-title').textContent = titles[view];
  document.title = `StudyMate AI | ${titles[view]}`;
}
function navigate(view) { if (location.hash.slice(1) === view) showView(view); else location.hash = view; }
window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
showView(location.hash.slice(1));

function dateCaption(date) {
  if (!date) return 'No deadline';
  const delta = daysBetween(date, state.today);
  if (delta < 0) return `Overdue · ${date}`;
  if (delta === 0) return 'Due today';
  if (delta === 1) return 'Due tomorrow';
  return `Due ${date}`;
}
function renderTasks() {
  const all = state.tasks;
  const tasks = all.filter(task => (taskFilter === 'all' || (taskFilter === 'open' ? !task.done : task.done)) && (priorityFilter === 'all' || task.priority === priorityFilter));
  $('task-heading').textContent = taskFilter === 'all' ? 'All tasks' : taskFilter === 'open' ? 'Open tasks' : 'Completed tasks';
  $('task-total').textContent = `${all.filter(task => !task.done).length} open`;
  $('task-list').innerHTML = tasks.length ? tasks.map(task => {
    const copies = all.filter(other => other.id !== task.id && other.title.toLowerCase() === task.title.toLowerCase() && other.due === task.due && other.priority === task.priority && other.done === task.done).length;
    const deadlineClass = !task.due ? '' : daysBetween(task.due, state.today) < 0 ? 'overdue' : daysBetween(task.due, state.today) <= 1 ? 'soon' : '';
    return `<article class="task-row ${task.done?'done':''}"><button class="check" data-task-toggle="${task.id}" data-next="${task.done?'open':'done'}" aria-label="Mark ${safe(task.title)} ${task.done?'incomplete':'complete'}">${task.done?'✓':''}</button><div class="task-info"><div class="task-name">${safe(task.title)}${copies ? ' <span class="duplicate-flag" title="Existing saved records are preserved">duplicate record</span>' : ''}</div><div class="task-meta"><span class="priority ${safe(task.priority)}">${safe(task.priority)}</span><span class="deadline ${deadlineClass}">${safe(dateCaption(task.due))}</span>${task.estimateMinutes ? `<span>${task.estimateMinutes} min estimate</span>` : ''}</div></div><button class="task-detail-button" data-task-open="${task.id}" aria-label="Open details for ${safe(task.title)}" title="Task details">Details</button></article>`;
  }).join('') : `<div class="empty">${taskFilter === 'completed' ? 'No completed tasks yet.' : taskFilter === 'open' ? 'No open tasks. Nice work.' : 'No tasks match these filters.'}</div>`;
  const priorities = [...all.filter(task => !task.done)].sort((a,b) => (a.due || '9999').localeCompare(b.due || '9999') || ({ high:0,medium:1,low:2 }[a.priority]-{ high:0,medium:1,low:2 }[b.priority])).slice(0,5);
  $('overview-priorities').innerHTML = priorities.length ? priorities.map(task => `<div class="priority-row"><span class="priority ${safe(task.priority)}">${safe(task.priority)}</span><b>${safe(task.title)}</b><small>${safe(dateCaption(task.due))}</small><a href="#tasks" aria-label="Open tasks">View</a></div>`).join('') : '<div class="empty">No open tasks. Add one when you are ready.</div>';
}
function approvedPlan() { return state.plans.find(plan => plan.status === 'approved') || null; }
function planRow(plan) { const label=plan.kind==='recovery'?'RECOVERY':plan.kind==='scenario'?'WHAT-IF':'STUDY PLAN'; return `<button class="plan-record" data-plan-detail="${safe(plan.id)}"><span class="record-kind ${plan.kind !== 'standard' ? 'recovery-kind' : ''}">${label}</span><b>${plan.minutes} min · ${plan.allocations.length} task(s)</b><span>${safe(plan.status)}${plan.outcome ? ` · ${safe(plan.outcome.status)}` : ''}</span><small>${safe(new Date(plan.createdAt).toLocaleString())}</small></button>`; }
function renderPlanRecords() {
  const plans = planTab === 'history' ? state.plans : state.plans.filter(plan => plan.status === planTab);
  $('plan-tab-title').textContent = planTab === 'history' ? 'Plan history' : `${planTab[0].toUpperCase()}${planTab.slice(1)} plans`;
  $('plan-tab-label').textContent = planTab === 'proposed' ? 'PENDING REVIEW' : planTab === 'approved' ? 'SAVED SCHEDULES' : 'PERSISTED PROPOSALS AND DECISIONS';
  $('plan-records').innerHTML = plans.length ? plans.map(planRow).join('') : `<div class="empty">${planTab === 'proposed' ? 'No proposal waiting for review. Ask the assistant to build a plan from your saved tasks.' : planTab === 'approved' ? 'No approved plan yet. Approve a proposal to save your first study schedule.' : 'Plan decisions will appear here.'}</div>`;
  document.querySelectorAll('[data-plan-tab]').forEach(tab => { const active = tab.dataset.planTab === planTab; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
}
function allocationMarkup(plan, emptyLabel) {
  if (!plan?.allocations?.length) return `<div class="empty compact-empty">${emptyLabel}</div>`;
  return plan.allocations.map((item,index) => `<div class="schedule-item"><span class="schedule-time">${String(index+1).padStart(2,'0')}<small> / ${item.minutes}m</small></span><div><b>${safe(item.title)}</b><small>${safe(item.reason)}${item.due ? ` · ${safe(item.due)}` : ''}</small></div><span class="schedule-kind">${plan.kind === 'recovery' ? 'revised' : safe(item.priority)}</span></div>`).join('');
}
function planMarkup(plan) {
  if (!plan) return '<div class="empty">Select a saved plan or request a new proposal in Assistant.</div>';
  const title = plan.status === 'approved' ? 'Approved plan' : plan.status === 'cancelled' ? 'Cancelled proposal' : `${plan.kind === 'recovery' ? 'Recovery proposal' : plan.kind === 'scenario' ? 'What-if proposal' : 'Proposed study session'} · ${plan.minutes} min`;
  const unplanned = (plan.unplanned || []).map(id => state.tasks.find(task => task.id === id)?.title || `Task ${id}`);
  return `<div class="plan-title">${safe(title)}</div><p class="plan-rationale">${safe(plan.rationale || 'Prioritized using saved tasks, deadlines, exam dates and priorities.')}</p><div class="plan-allocations">${allocationMarkup(plan,'There are no open tasks in this proposal.')}</div>${unplanned.length ? `<div class="conflict-note"><b>Still open, outside this time window:</b> ${unplanned.map(safe).join(', ')}. Their deadlines have not changed.</div>` : ''}${plan.outcome ? `<div class="outcome-badge">Recorded session outcome: ${safe(plan.outcome.status)}${plan.outcome.remainingMinutes ? ` · ${plan.outcome.remainingMinutes} min remaining` : ''}</div>` : ''}${plan.status === 'proposed' ? `<div class="plan-actions"><button class="approve" data-plan-action="approve" data-plan-id="${safe(plan.id)}">Approve &amp; save</button><button class="cancel" data-plan-action="cancel" data-plan-id="${safe(plan.id)}">Cancel proposal</button></div><div class="plan-adjust"><label for="adjust-minutes">Recalculate available time</label><input id="adjust-minutes" type="number" min="5" max="720" step="1" value="${plan.minutes}"><button class="adjust-button" data-plan-adjust>Recalculate</button></div><p class="helper">A proposal does not change tasks or the approved schedule.</p>` : ''}`;
}
function renderPlanDetails() {
  const plan = activePlan || state.plans.find(item => item.status === 'proposed') || null;
  $('plan-preview').hidden = !plan; $('plan-preview').innerHTML = plan ? planMarkup(plan) : '';
  const latest = approvedPlan();
  $('schedule-list').innerHTML = latest ? `<div class="approved-summary"><span class="eyebrow">LATEST APPROVED · ${latest.minutes} MIN</span>${allocationMarkup(latest,'No tasks were allocated.')}</div>` : '<div class="empty">No approved schedule yet. Review a proposal before it becomes your saved plan.</div>';
}
function renderRecovery() {
  const recovery = activePlan && ['recovery','scenario'].includes(activePlan.kind) ? activePlan : state.plans.find(plan => ['recovery','scenario'].includes(plan.kind)) || null;
  const source = recovery?.sourcePlanId ? state.plans.find(plan => plan.id === recovery.sourcePlanId) : null;
  const approved = approvedPlan();
  const session = activePlan?.status === 'approved' ? activePlan : source || approved;
  $('recovery-session-status').textContent = session ? `${session.minutes} min · ${session.status}` : 'No approved session';
  $('recovery-session-info').innerHTML = session ? `<p>Session ${safe(session.id)} · ${session.allocations.length} task block(s) · ${session.outcome ? `last check-in: ${safe(session.outcome.status)}` : 'no outcome recorded yet'}.</p>` : '<div class="empty">Approve a study plan first. Its unfinished tasks can then be carried into a recovery proposal.</div>';
  $('recovery-source').innerHTML = allocationMarkup(session,'No approved plan to compare yet.');
  $('recovery-current').innerHTML = allocationMarkup(recovery,'Your revised proposal will appear here after you set the available time.');
  if (recovery && session) {
    const old = new Map(session.allocations.map(item => [item.taskId,item.minutes])); const next = new Map(recovery.allocations.map(item => [item.taskId,item.minutes]));
    const diffs = [...new Set([...old.keys(),...next.keys()])].map(id => ({ title:state.tasks.find(task => task.id === id)?.title || `Task ${id}`, before:old.get(id)||0, after:next.get(id)||0 })).filter(item => item.before !== item.after);
    $('recovery-diff').innerHTML = `<b>What changed</b><p>${diffs.length ? diffs.map(item => `${safe(item.title)}: ${item.before} → ${item.after} min`).join(' · ') : 'The allocated task minutes are unchanged.'}</p>${(recovery.unplanned || []).length ? `<p class="conflict-note">Still open but outside the revised window: ${(recovery.unplanned || []).map(id => safe(state.tasks.find(task => task.id === id)?.title || `Task ${id}`)).join(', ')}.</p>` : ''}`;
  } else $('recovery-diff').innerHTML = '';
  $('recovery-preview').innerHTML = recovery ? planMarkup(recovery) : '';
  $('session-outcome').value = session?.outcome?.status || 'not-completed';
  $('remaining-minutes').value = session?.outcome?.remainingMinutes || 20;
  if (!recovery) $('recovery-minutes').value = session?.outcome?.remainingMinutes || 30;
  $('session-outcome-form').dataset.planId = session?.id || '';
  $('session-outcome-form').querySelector('button').disabled = !session;
  $('build-recovery').disabled = !approved;
  $('build-recovery').title = approved ? 'Create a proposal from this approved session’s unfinished work.' : 'Approve a study plan first to enable session recovery.';
  $('remaining-minutes').disabled = $('session-outcome').value !== 'partial';
}
function renderExams() {
  const exams = [...state.exams].sort((a,b) => a.date.localeCompare(b.date));
  const upcoming = exams.filter(exam => daysBetween(exam.date,state.today) >= 0);
  $('exam-count').textContent = upcoming.length;
  $('exam-list').innerHTML = exams.length ? exams.map(exam => {
    const days = daysBetween(exam.date,state.today); const countdown = days < 0 ? 'Past' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`;
    const related = state.tasks.filter(task => task.title.toLowerCase().includes(exam.subject.toLowerCase()) || exam.subject.toLowerCase().includes(task.title.toLowerCase()));
    return `<article class="exam-card"><div><span class="eyebrow">${safe(countdown.toUpperCase())}</span><h3>${safe(exam.subject)}</h3><time datetime="${safe(exam.date)}">${safe(exam.date)}</time></div><div class="exam-related"><b>Related preparation tasks</b>${related.length ? related.map(task => `<span class="${task.done?'done-text':''}">${task.done ? 'Done' : 'Open'} · ${safe(task.title)}</span>`).join('') : '<span>No subject-matched tasks saved.</span>'}</div></article>`;
  }).join('') : '<div class="empty">No exams saved. Add an exam date to see its countdown and matched preparation tasks.</div>';
}
function activityMarkup(item) { return `<button class="activity-item" data-activity-detail="${safe(item.id)}"><span class="activity-symbol">${item.action.startsWith('MCP') ? 'MCP' : 'LOG'}</span><span><b>${safe(item.action)}</b><small>${safe(item.detail)} · ${safe(new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:state.timezone}).format(new Date(item.at)))}</small></span><span class="activity-chevron" aria-hidden="true">&#8599;</span></button>`; }
function renderActivity() {
    $('exam-count').textContent = upcoming.length;
  $('exam-list').innerHTML = exams.length ? exams.map(exam => {
    const days = daysBetween(exam.date,state.today); const countdown = days < 0 ? 'Past' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`;
    const related = state.tasks.filter(task => task.title.toLowerCase().includes(exam.subject.toLowerCase()) || exam.subject.toLowerCase().includes(task.title.toLowerCase()));
    return `<article class="exam-card"><div><span class="eyebrow">${safe(countdown.toUpperCase())}</span><h3>${safe(exam.subject)}</h3><time datetime="${safe(exam.date)}">${safe(exam.date)}</time></div><div class="exam-related"><b>Related preparation tasks</b>${related.length ? related.map(task => `<span class="${task.done?'done-text':''}">${task.done ? 'Done' : 'Open'} · ${safe(task.title)}</span>`).join('') : '<span>No subject-matched tasks saved.</span>'}</div></article>`;
  }).join('') : '<div class="empty">No exams saved. Add an exam date to see its countdown and matched preparation tasks.</div>';
}
function activityMarkup(item) { return `<button class="activity-item" data-activity-detail="${safe(item.id)}"><span class="activity-symbol">${item.action.startsWith('MCP') ? 'MCP' : 'LOG'}</span><span><b>${safe(item.action)}</b><small>${safe(item.detail)} · ${safe(new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:state.timezone}).format(new Date(item.at)))}</small></span><span class="activity-chevron" aria-hidden="true">&#8599;</span></button>`; }
function renderActivity() {
  const entries = state.history || [];
  $('activity-list').innerHTML = entries.length ? entries.slice(0,30).map(activityMarkup).join('') : '<div class="empty">No saved actions or MCP requests yet.</div>';
  $('overview-activity').innerHTML = entries.length ? entries.slice(0,3).map(activityMarkup).join('') : '<div class="empty">Saved task and plan activity will appear here.</div>';
}
function renderRiskAndMemory() {
  const radar = state.riskRadar;
  $('risk-radar').innerHTML = radar?.items?.length ? radar.items.map(item => `<article class="risk-item"><b>Deadline conflict · ${safe(item.deadline)}</b><p>${safe(item.evidence)}</p><a href="#recovery">Compare a what-if &#8599;</a></article>`).join('') : `<div class="${radar?.assessed ? 'risk-clear' : 'empty'}">${safe(radar?.message || 'Risk assessment unavailable.')}</div>`;
  const prefs = state.preferences || {};
  $('preferred-minutes').value = prefs.preferredMinutes || '';
  $('study-priorities').value = (prefs.priorities || []).join(', ');
  $('reminders-enabled').checked = prefs.remindersEnabled !== false;
  $('reminder-form').hidden = prefs.remindersEnabled === false;
  const reminders = state.reminders || [];
  $('reminder-list').innerHTML = prefs.remindersEnabled === false ? '<div class="empty">Reminders are disabled. Re-enable them to see upcoming reminders.</div>' : reminders.length ? reminders.filter(item => !['completed','dismissed'].includes(item.status)).slice(0,8).map(item => `<article class="reminder-item"><div><b>${safe(item.title)}</b><small>${safe(item.reason)} · ${safe(item.snoozedUntil || item.due)} · ${safe(item.status)}</small></div><input aria-label="Edit reminder date" type="date" value="${safe(item.snoozedUntil || item.due)}" data-reminder-date="${safe(item.id)}"><button class="reminder-action" data-reminder-edit="${safe(item.id)}">Save date</button><button class="reminder-action" data-reminder-snooze="${safe(item.id)}">Snooze 1 day</button><button class="reminder-action" data-reminder-complete="${safe(item.id)}">Done</button><button class="reminder-action" data-reminder-dismiss="${safe(item.id)}">Dismiss</button></article>`).join('') || '<div class="empty">No upcoming reminders.</div>' : '<div class="empty">Task deadline reminders will appear here when saved.</div>';
}
function renderOverview() {
  const pending = state.tasks.filter(task => !task.done).sort((a,b) => (a.due||'9999').localeCompare(b.due||'9999'));
  const nearest = pending.find(task => task.due);
  $('pending-count').textContent = pending.length; $('completed-count').textContent = state.tasks.length-pending.length;
  $('next-deadline').textContent = nearest ? (daysBetween(nearest.due,state.today) < 0 ? 'Overdue' : daysBetween(nearest.due,state.today) === 0 ? 'Today' : nearest.due) : '—';
  $('deadline-caption').textContent = nearest?.title || 'No dates set';
  $('today-label').textContent = new Intl.DateTimeFormat(undefined,{dateStyle:'full',timeZone:state.timezone}).format(new Date());
  $('overview-date').textContent = new Intl.DateTimeFormat(undefined,{dateStyle:'full',timeZone:state.timezone}).format(new Date());
  const hour=Number(new Intl.DateTimeFormat('en-US',{hour:'numeric',hour12:false,timeZone:state.timezone}).format(new Date()));
  $('greeting').textContent = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const approved = approvedPlan();
  $('overview-next').innerHTML = pending.length ? `<a class="next-action-link" href="#assistant"><span class="eyebrow">RECOMMENDED NEXT ACTION</span><b>${approved ? 'Review your saved session or request recovery' : 'Build a time-bounded study plan'}</b><small>${approved ? `${approved.minutes} min approved · ${approved.allocations.length} task block(s)` : `${pending.length} open task(s) ready for planning`}</small></a>` : '<div class="next-action-empty">No open tasks. Add a task or exam when needed.</div>';
  $('overview-session').innerHTML = approved ? `<div class="overview-session-row"><b>${approved.minutes}-minute approved session</b><span>${approved.outcome ? `Outcome: ${safe(approved.outcome.status)}` : 'Outcome not recorded'}</span><a href="#recovery">Record outcome / recover &#8599;</a></div>` : '<p>No approved session yet. Create a plan, review it and save it to enable recovery.</p>';
  $('overview-schedule').innerHTML = approved ? `<p class="timeline-note">Approved focus blocks · no clock times are scheduled.</p>${allocationMarkup(approved,'No focus blocks in the approved plan.')}` : '<div class="empty">No approved study blocks yet. <a href="#assistant">Ask StudyMate to make a plan</a>.</div>';
  const upcomingTasks=pending.filter(task=>task.due).slice(0,3).map(task=>`<a class="upcoming-item" href="#tasks"><span class="upcoming-kind">TASK</span><b>${safe(task.title)}</b><small>${safe(dateCaption(task.due))}</small></a>`);
  const upcomingExams=state.exams.filter(exam=>daysBetween(exam.date,state.today)>=0).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,3).map(exam=>`<a class="upcoming-item" href="#exams"><span class="upcoming-kind exam-kind">EXAM</span><b>${safe(exam.subject)}</b><small>${safe(dateCaption(exam.date))}</small></a>`);
  $('overview-upcoming').innerHTML=upcomingTasks.length||upcomingExams.length?[...upcomingExams,...upcomingTasks].slice(0,5).join(''):'<div class="empty">No upcoming dated tasks or exams. <a href="#tasks">Add a deadline</a>.</div>';
  const unresolved=approved && ['partial','not-completed'].includes(approved.outcome?.status)?[...new Set([...approved.allocations.map(item=>item.taskId),...(approved.unplanned||[])])].filter(id=>state.tasks.some(task=>task.id===id&&!task.done)):[];
  $('overview-recovery-alert').hidden=!unresolved.length;
  $('overview-recovery-alert').innerHTML=unresolved.length?`<div class="panel-heading"><div><span class="eyebrow">RECOVERY NEEDED</span><h2>${unresolved.length} approved-plan task${unresolved.length===1?'':'s'} still open after your ${safe(approved.outcome.status==='partial'?'partial':'missed')} session</h2></div><a class="quick-action" href="#recovery">Review options</a></div><p>${unresolved.map(id=>safe(state.tasks.find(task=>task.id===id)?.title||`Task ${id}`)).join(' · ')}</p>`:'';
  renderRiskAndMemory();
}
function renderAssistantContext() {
  const latest = approvedPlan(); const open = state.tasks.filter(task => !task.done).length;
  $('assistant-context').innerHTML = `<div class="context-line"><span>Open tasks</span><b>${open}</b></div><div class="context-line"><span>Saved exams</span><b>${state.exams.length}</b></div><div class="context-line"><span>Latest approved plan</span><b>${latest ? `${latest.minutes} min` : 'None'}</b></div><p>Say “I have only 40 minutes left today” to propose a revision from approved open work. Ask “What changed?” to compare saved plan history.</p>`;
}
function render() {
  if (!state) return;
  $('service-status').textContent=state.integrations?.server==='online'?'StudyMate is online':'Checking StudyMate';
  $('service-detail').textContent=`${state.integrations?.mcp || 'MCP unavailable'} · ${state.integrations?.gemini==='configured'?'Gemini configured':'Gemini optional'}`;
  $('service-dot').classList.toggle('service-offline',state.integrations?.server!=='online');
  renderOverview(); renderTasks(); renderPlanRecords(); renderPlanDetails(); renderRecovery(); renderExams(); renderActivity(); renderAssistantContext();
}
async function refresh() { state = await request('/api/state');
  if (activePlan) activePlan = state.plans.find(plan => plan.id === activePlan.id) || null;
  if (!activePlan) activePlan = state.plans.find(plan => plan.status === 'proposed') || null;
  render();
}
function addMessage(text,user=false) { const el=document.createElement('div'); el.className=`message ${user?'user-message':'coach-message'}`; el.textContent=text; chat.appendChild(el); chat.scrollTop=chat.scrollHeight; }
function addAssistantTasks(tasks) {
  const card=document.createElement('div');card.className='assistant-task-card';card.setAttribute('aria-label','Tasks returned from StudyMate MCP');
  card.innerHTML=`<b>Saved tasks · retrieved via MCP</b>${tasks.slice(0,5).map(task=>`<button type="button" data-assistant-task="${task.id}">${safe(task.title)} <span>${safe(task.due||'No deadline')}</span></button>`).join('')}`;
  card.addEventListener('click',event=>{const button=event.target.closest('[data-assistant-task]');if(button)openTaskDetails(button.dataset.assistantTask);});chat.appendChild(card);chat.scrollTop=chat.scrollHeight;
}
function openTaskDetails(id) {
  const task=state.tasks.find(item=>item.id===Number(id)); if(!task)return;
  $('task-detail-title').textContent=task.title; $('detail-task-id').value=task.id; $('detail-task-name').value=task.title; $('detail-task-due').value=task.due||''; $('detail-task-priority').value=task.priority; $('detail-task-estimate').value=task.estimateMinutes||'';
  $('detail-task-toggle').dataset.next=task.done?'open':'done'; $('detail-task-toggle').textContent=task.done?'Reopen task':'Mark complete'; $('task-detail-dialog').showModal(); $('detail-task-name').focus();
}
async function sendMessage(text) {
  if (chatBusy) return;
  chatBusy=true; addMessage(text,true); const send=$('chat-form').querySelector('button'); send.disabled=true; document.querySelectorAll('[data-prompt]').forEach(button=>button.disabled=true);
  try {
    const data=await request('/api/chat',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({message:text,sessionId,activePlanId:activePlan?.status==='proposed'?activePlan.id:undefined})});
    addMessage(data.reply||'Done.');
    if (data.tasks?.length) addAssistantTasks(data.tasks);
    if (data.plan) { activePlan=data.plan; navigate(data.plan.kind==='recovery' || data.plan.kind==='scenario'?'recovery':'plans'); }
    if (data.source==='planner' && data.comparison) navigate('recovery');
    if (data.tasks||data.task||data.plan||data.comparison||data.source==='fallback') await refresh();
  } catch(error) { addMessage(error.message); notify(error.message,true); }
  finally { chatBusy=false; send.disabled=false; document.querySelectorAll('[data-prompt]').forEach(button=>button.disabled=false); $('message').focus(); }
}
async function createTask(payload,form,closeDrawer=false) {
  const button=form.querySelector('[type=submit]'); button.disabled=true;
  try { await request('/api/tasks',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(payload)}); form.reset(); await refresh(); notify('Task saved.'); if(closeDrawer)$('task-drawer').close(); navigate('tasks'); }
  catch(error) { notify(error.message,true); }
  finally { button.disabled=false; }
}
async function showConfirm(action,plan) {
  const dialog=$('confirm-dialog'); const completing=action==='complete'; $('confirm-title').textContent=action==='approve'?'Approve this plan?':completing?'Mark this task complete?':'Cancel this proposal?';
  $('confirm-copy').textContent=action==='approve'?'This will save the proposed schedule. Tasks remain open until you mark them complete.':completing?`Mark “${plan.title}” complete in your saved tasks?`:'This proposal will be marked cancelled. Your approved schedule stays unchanged.';
  $('confirm-accept').textContent=action==='approve'?'Approve plan':completing?'Mark complete':'Cancel proposal';
  return new Promise(resolve=>{
    let settled=false; const finish=value=>{if(settled)return;settled=true;dialog.close();resolve(value);};
    $('confirm-cancel').onclick=()=>finish(false); $('confirm-accept').onclick=()=>finish(true);
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);},{once:true});
        dialog.showModal(); $('confirm-cancel').focus();
  });
}
async function planAction(action,id,button) {
  const plan=state.plans.find(item=>item.id===id);
  if(!plan||plan.status!=='proposed'){notify('This proposal is no longer available. Refresh and try again.',true);return;}
  if(!await showConfirm(action,plan))return;
  button.disabled=true;
  try { const result=await request(`/api/plans/${encodeURIComponent(id)}/${action}`,{method:'POST',body:'{}'}); activePlan=result.plan; await refresh(); activePlan=result.plan; render(); addMessage(action==='approve'?'Plan approved and saved. Your tasks remain open until you mark them complete.':'Plan cancelled. Your approved schedule is unchanged.'); notify(action==='approve'?'Plan approved and saved.':'Proposal cancelled.'); }
  catch(error){notify(error.message,true);button.disabled=false;}
}

document.querySelectorAll('[data-open-task],#open-task-drawer').forEach(button=>button.addEventListener('click',()=>{$('task-drawer').showModal();$('quick-task-title').focus();}));
$('overview-chat-form').addEventListener('submit',event=>{event.preventDefault();const input=$('overview-message');const message=input.value.trim();if(message){input.value='';navigate('assistant');sendMessage(message);}});
$('quick-task-form').addEventListener('submit',event=>{event.preventDefault();createTask({title:$('quick-task-title').value.trim(),due:$('quick-task-due').value||null,priority:$('quick-task-priority').value,estimateMinutes:$('quick-task-estimate').value||null},event.currentTarget,true);});
$('sidebar-toggle').addEventListener('click',event=>{const shell=$('app-shell');if(matchMedia('(max-width:700px)').matches){const open=shell.classList.toggle('mobile-nav-open');$('mobile-nav-scrim').hidden=!open;event.currentTarget.setAttribute('aria-expanded',String(open));event.currentTarget.setAttribute('aria-label',open?'Close navigation':'Open navigation');if(open)$('sidebar').querySelector('[data-nav]').focus();return;}const collapsed=shell.classList.toggle('sidebar-collapsed');event.currentTarget.setAttribute('aria-expanded',String(!collapsed));event.currentTarget.setAttribute('aria-label',collapsed?'Expand sidebar':'Collapse sidebar');localStorage.setItem('studymate-sidebar-collapsed',String(collapsed));});
function closeMobileNav(){ $('app-shell').classList.remove('mobile-nav-open'); $('mobile-nav-scrim').hidden=true;const mobile=matchMedia('(max-width:700px)').matches,collapsed=$('app-shell').classList.contains('sidebar-collapsed');$('sidebar-toggle').setAttribute('aria-expanded',String(mobile?false:!collapsed));$('sidebar-toggle').setAttribute('aria-label',mobile?'Open navigation':collapsed?'Expand sidebar':'Collapse sidebar'); }
document.querySelectorAll('[data-nav]').forEach(link=>link.addEventListener('click',()=>{if(matchMedia('(max-width:700px)').matches)closeMobileNav();}));
$('mobile-nav-scrim').addEventListener('click',closeMobileNav);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('app-shell').classList.contains('mobile-nav-open')){closeMobileNav();$('sidebar-toggle').focus();}});
window.addEventListener('resize',()=>{if(!matchMedia('(max-width:700px)').matches)closeMobileNav();});
if(localStorage.getItem('studymate-sidebar-collapsed')==='true'){$('app-shell').classList.add('sidebar-collapsed');$('sidebar-toggle').setAttribute('aria-expanded','false');$('sidebar-toggle').setAttribute('aria-label','Expand sidebar');}
if(matchMedia('(max-width:700px)').matches){$('sidebar-toggle').setAttribute('aria-expanded','false');$('sidebar-toggle').setAttribute('aria-label','Open navigation');}

document.querySelectorAll('[data-task-filter]').forEach(button=>button.addEventListener('click',()=>{taskFilter=button.dataset.taskFilter;document.querySelectorAll('[data-task-filter]').forEach(item=>item.classList.toggle('active',item===button));renderTasks();}));
$('priority-filter').addEventListener('change',event=>{priorityFilter=event.target.value;renderTasks();});
$('task-list').addEventListener('click',async event=>{const details=event.target.closest('[data-task-open]');if(details){openTaskDetails(details.dataset.taskOpen);return;}const button=event.target.closest('[data-task-toggle]');if(!button)return;const done=button.dataset.next==='done';const task=state.tasks.find(item=>item.id===Number(button.dataset.taskToggle));if(done&&task&&!await showConfirm('complete',task))return;button.disabled=true;try{await request(`/api/tasks/${button.dataset.taskToggle}/${done?'complete':'reopen'}`,{method:'POST',body:'{}'});await refresh();notify(done?'Task marked complete.':'Task reopened.');}catch(error){button.disabled=false;notify(error.message,true);}});
$('task-detail-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const id=$('detail-task-id').value;const button=form.querySelector('[type=submit]');button.disabled=true;try{await request(`/api/tasks/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({title:$('detail-task-name').value.trim(),due:$('detail-task-due').value||null,priority:$('detail-task-priority').value,estimateMinutes:$('detail-task-estimate').value||null})});$('task-detail-dialog').close();await refresh();notify('Task details saved.');}catch(error){notify(error.message,true);}finally{button.disabled=false;}});
$('detail-task-toggle').addEventListener('click',async event=>{const button=event.currentTarget;const id=$('detail-task-id').value;const done=button.dataset.next==='done';try{await request(`/api/tasks/${encodeURIComponent(id)}/${done?'complete':'reopen'}`,{method:'POST',body:'{}'});$('task-detail-dialog').close();await refresh();notify(done?'Task marked complete.':'Task reopened.');}catch(error){notify(error.message,true);}});
document.querySelectorAll('[data-plan-tab]').forEach(button=>button.addEventListener('click',()=>{planTab=button.dataset.planTab;renderPlanRecords();}));
document.querySelector('[role="tablist"]').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=[...document.querySelectorAll('[data-plan-tab]')],index=tabs.indexOf(event.target.closest('[data-plan-tab]'));const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].focus();tabs[next].click();});
$('plan-records').addEventListener('click',event=>{const button=event.target.closest('[data-plan-detail]');if(!button)return;activePlan=state.plans.find(plan=>plan.id===button.dataset.planDetail)||null;renderPlanDetails();if(['recovery','scenario'].includes(activePlan?.kind)){navigate('recovery');renderRecovery();}else $('plan-preview').scrollIntoView({behavior:'smooth',block:'nearest'});});
$('exam-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;try{const result=await request('/api/exams',{method:'POST',body:JSON.stringify({subject:$('exam-subject').value.trim(),date:$('exam-date').value})});event.currentTarget.reset();await refresh();notify(result.duplicate?'That exam date is already saved.':'Exam date saved.');}catch(error){notify(error.message,true);}finally{button.disabled=false;}});
$('recovery-form').addEventListener('submit',async event=>{event.preventDefault();const button=$('build-recovery');const source=approvedPlan();if(!source){notify('Approve a study plan first. You can still build a what-if alternative.',true);return;}const minutes=Number($('recovery-minutes').value);if(!Number.isInteger(minutes)||minutes<5||minutes>720){notify('Choose a whole number from 5 to 720 minutes.',true);return;}button.disabled=true;button.textContent='Building recovery...';try{const result=await request(`/api/plans/${encodeURIComponent(source.id)}/recover`,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({minutes})});activePlan=result.plan;await refresh();activePlan=result.plan;render();notify('Recovery proposal built from the approved session. Nothing was applied.');}catch(error){notify(error.message,true);}finally{button.disabled=false;button.textContent='Build recovery proposal';}});
$('build-scenario-alt').addEventListener('click',async event=>{const button=event.currentTarget;const minutes=Number($('recovery-minutes').value);if(!Number.isInteger(minutes)||minutes<5||minutes>720){notify('Choose a whole number from 5 to 720 minutes.',true);return;}button.disabled=true;try{const result=await request('/api/plans',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({minutes,kind:'scenario',focusSubject:$('focus-subject').value.trim()||null})});activePlan=result.plan;await refresh();activePlan=result.plan;render();notify('What-if alternative built from saved open tasks. Nothing was applied.');}catch(error){notify(error.message,true);}finally{button.disabled=false;}});
$('session-outcome').addEventListener('change',event=>{$('remaining-minutes').disabled=event.target.value!=='partial';});
$('session-outcome-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const id=form.dataset.planId;if(!id){notify('Approve a plan before recording its outcome.',true);return;}const outcome=$('session-outcome').value;const remainingMinutes=Number($('remaining-minutes').value);if(outcome==='partial'&&(!Number.isInteger(remainingMinutes)||remainingMinutes<1||remainingMinutes>720)){notify('Enter remaining minutes from 1 to 720.',true);return;}const button=form.querySelector('button');button.disabled=true;try{await request(`/api/plans/${encodeURIComponent(id)}/outcome`,{method:'POST',body:JSON.stringify({outcome,remainingMinutes})});await refresh();if(outcome==='partial')$('recovery-minutes').value=remainingMinutes;notify('Session check-in saved.');}catch(error){notify(error.message,true);}finally{button.disabled=false;}});
$('chat-form').addEventListener('submit',event=>{event.preventDefault();const input=$('message');const message=input.value.trim();if(message){input.value='';sendMessage(message);}});
$('preferences-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('[type=submit]');const raw=$('study-priorities').value.split(',').map(value=>value.trim()).filter(Boolean);button.disabled=true;try{await request('/api/preferences',{method:'PATCH',body:JSON.stringify({preferredMinutes:$('preferred-minutes').value||null,priorities:raw})});await refresh();notify('Your explicit study preferences were saved.');}catch(error){notify(error.message,true);}finally{button.disabled=false;}});
$('clear-memory').addEventListener('click',async()=>{try{await request('/api/preferences',{method:'DELETE'});await refresh();notify('Optional study preferences cleared. Tasks and plans are kept.');}catch(error){notify(error.message,true);}});
$('reminders-enabled').addEventListener('change',async event=>{try{await request('/api/preferences',{method:'PATCH',body:JSON.stringify({remindersEnabled:event.target.checked})});await refresh();notify(event.target.checked?'In-app reminders enabled.':'Reminders disabled.');}catch(error){event.target.checked=!event.target.checked;notify(error.message,true);}});
$('reminder-form').addEventListener('submit',async event=>{event.preventDefault();try{await request('/api/reminders',{method:'POST',body:JSON.stringify({title:$('reminder-title').value.trim(),due:$('reminder-date').value})});event.currentTarget.reset();await refresh();notify('Reminder saved.');}catch(error){notify(error.message,true);}});
$('reminder-list').addEventListener('click',async event=>{const button=event.target.closest('[data-reminder-edit],[data-reminder-snooze],[data-reminder-complete],[data-reminder-dismiss]');if(!button)return;const id=button.dataset.reminderEdit||button.dataset.reminderSnooze||button.dataset.reminderComplete||button.dataset.reminderDismiss;try{if(button.dataset.reminderEdit){const date=$(`[data-reminder-date="${CSS.escape(id)}"]`).value;await request(`/api/reminders/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({due:date})});}else{const action=button.dataset.reminderSnooze?'snooze':button.dataset.reminderComplete?'complete':'dismiss';let until; if(action==='snooze'){const d=new Date(`${state.today}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);until=d.toISOString().slice(0,10);}await request(`/api/reminders/${encodeURIComponent(id)}/${action}`,{method:'POST',body:JSON.stringify({until})});}await refresh();notify('Reminder updated.');}catch(error){notify(error.message,true);}});
$('activity-list').addEventListener('click',showActivityDetail);$('overview-activity').addEventListener('click',showActivityDetail);
function showActivityDetail(event){const button=event.target.closest('[data-activity-detail]');if(!button)return;const item=state.history.find(entry=>entry.id===button.dataset.activityDetail);if(!item)return;$('activity-detail-title').textContent=item.action;$('activity-detail-copy').textContent=item.detail;$('activity-detail-time').textContent=new Intl.DateTimeFormat(undefined,{dateStyle:'full',timeStyle:'long',timeZone:state.timezone}).format(new Date(item.at));$('activity-detail-dialog').showModal();}
document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>sendMessage(button.dataset.prompt)));
document.addEventListener('click',async event=>{
  const action=event.target.closest('[data-plan-action]');
  if(action){await planAction(action.dataset.planAction,action.dataset.planId,action);return;}
  if(event.target.closest('[data-plan-adjust]')){const input=$('adjust-minutes');const minutes=Number(input.value);if(!Number.isInteger(minutes)||minutes<5||minutes>720){notify('Choose a whole number from 5 to 720 minutes.',true);input.focus();return;}sendMessage(`Actually, make that ${minutes} minutes.`);}
});
$('run-mcp-demo').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;button.textContent='Calling MCP tool...';try{const result=await request('/api/mcp/call',{method:'POST',body:JSON.stringify({name:'list_tasks',arguments:{}})});$('integration-result').textContent=JSON.stringify(result.result,null,2);$('integration-result').hidden=false;await refresh();notify('MCP list_tasks call completed.');}catch(error){$('integration-result').textContent=`MCP request error: ${error.message}`;$('integration-result').hidden=false;notify(error.message,true);}finally{button.disabled=false;button.textContent='Call list_tasks tool';}});


/* STUDYMATE — FULL-SCREEN NEON INTRO */
(function startStudyMateIntro() {
  if (sessionStorage.getItem('studymate-intro-seen')) return;
  sessionStorage.setItem('studymate-intro-seen', 'true');

  const style = document.createElement('style');
  style.textContent = `
    #sm-neon-intro {
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      height: 100dvh !important;
      z-index: 2147483647 !important;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: #05040d;
      color: #fff;
      font-family: inherit;
      opacity: 1;
      visibility: visible;
      transition: opacity .8s ease, visibility .8s ease;
    }
    #sm-neon-intro.sm-intro-out {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }
    #sm-neon-intro .sm-orb {
      position: absolute;
      width: min(70vw, 620px);
      aspect-ratio: 1;
      border-radius: 50%;
      filter: blur(90px);
      opacity: .38;
      pointer-events: none;
      animation: smOrbPulse 3s ease-in-out infinite alternate;
    }
    #sm-neon-intro .sm-orb-a {
      background: #792bff;
      top: -28%;
      left: -15%;
    }
    #sm-neon-intro .sm-orb-b {
          background: #006dff;
      bottom: -35%;
      right: -15%;
      animation-delay: -.9s;
    }
    #sm-neon-intro .sm-intro-content {
      position: relative;
      z-index: 2;
      width: min(90%, 700px);
      text-align: center;
      animation: smIntroRise 1s cubic-bezier(.2,.8,.2,1) both;
    }
    #sm-neon-intro .sm-logo {
      width: 116px;
      height: 116px;
      margin: 0 auto 30px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(151,112,255,.8);
      border-radius: 34px;
      background: linear-gradient(135deg,rgba(129,56,255,.25),rgba(0,178,255,.2));
      box-shadow: 0 0 28px #7c3cff88, 0 0 80px #176bff55,
        inset 0 0 28px #9d6bff22;
      animation: smLogoFloat 2.4s ease-in-out infinite;
    }
    #sm-neon-intro .sm-logo svg {
      width: 72px;
      height: 72px;
      filter: drop-shadow(0 0 12px #4ba8ff);
    }
    #sm-neon-intro .sm-brand {
      margin: 0;
      font-size: clamp(38px, 7vw, 68px);
      line-height: 1.08;
      letter-spacing: -2px;
      font-weight: 850;
      background: linear-gradient(100deg,#fff 10%,#bba2ff 44%,#45c9ff 85%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      filter: drop-shadow(0 0 20px #603cff55);
    }
    #sm-neon-intro .sm-tagline {
      margin: 18px 0 0;
      color: #c8c5e7;
      font-size: clamp(16px, 2.5vw, 21px);
      letter-spacing: .5px;
    }
    #sm-neon-intro .sm-loading {
      width: 180px;
      height: 3px;
      margin: 38px auto 0;
      overflow: hidden;
      border-radius: 99px;
      background: #25213e;
    }
    #sm-neon-intro .sm-loading span {
      display: block;
      width: 45%;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg,#963cff,#29c8ff);
      box-shadow: 0 0 14px #7180ff;
      animation: smLoading 2.4s ease-in-out forwards;
    }
    @keyframes smIntroRise {
      from { opacity: 0; transform: translateY(24px) scale(.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes smLogoFloat {
      0%,100% { transform: translateY(0) rotate(-2deg); }
      50% { transform: translateY(-9px) rotate(2deg); }
    }
    @keyframes smOrbPulse {
      from { transform: scale(.9); opacity: .25; }
      to { transform: scale(1.12); opacity: .48; }
    }
    @keyframes smLoading {
      from { width: 0; }
      to { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      #sm-neon-intro *, #sm-neon-intro *::before {
        animation-duration: .01ms !important;
      }
    }
  `;
  document.head.appendChild(style);

  const intro = document.createElement('div');
  intro.id = 'sm-neon-intro';
  intro.setAttribute('role', 'status');
  intro.setAttribute('aria-label', 'Welcome to StudyMate AI');
  intro.innerHTML = `
    <div class="sm-orb sm-orb-a"></div>
    <div class="sm-orb sm-orb-b"></div>
    <div class="sm-intro-content">
      <div class="sm-logo">
        <svg viewBox="0 0 80 80" fill="none" aria-hidden="true">
          <path d="M40 8 65 22v28L40 66 15 50V22L40 8Z"
                      stroke="url(#smGradient)" stroke-width="3.5"
            stroke-linejoin="round"/>
          <path d="m27 31 13-8 13 8v16l-13 8-13-8V31Z"
            stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>
          <path d="m34 37 6-4 6 4v7l-6 4-6-4v-7Z"
            fill="url(#smGradient)"/>
          <defs>
            <linearGradient id="smGradient" x1="15" y1="8" x2="65" y2="66">
              <stop stop-color="#bd7aff"/>
              <stop offset="1" stop-color="#22caff"/>
            </linearGradient>
          </defs>
        </svg>
      </div>
      <h1 class="sm-brand">StudyMate AI</h1>
      <p class="sm-tagline">Your goals. Your time. Your next breakthrough.</p>
      <div class="sm-loading"><span></span></div>
    </div>
  `;
  document.body.appendChild(intro);

  const finishIntro = () => {
    intro.classList.add('sm-intro-out');
    window.setTimeout(() => intro.remove(), 850);
  };

  window.setTimeout(finishIntro, 3000);
})();

/* STUDYMATE — QUICK STUDY TOOLS */
(function addStudyTools() {
  if (document.getElementById('sm-study-tools')) return;

  const css = document.createElement('style');
  css.textContent = `
    #sm-study-tools {
      position: fixed;
      left: 16px;
      bottom: 18px;
      z-index: 900;
      font-family: inherit;
    }
    #sm-tools-toggle {
      border: 1px solid #7956ff;
      border-radius: 15px;
      padding: 13px 17px;
      background: linear-gradient(120deg,#5421a5,#075ca9);
      color: white;
      font: inherit;
      font-size: 15px;
      font-weight: 750;
      cursor: pointer;
      box-shadow: 0 0 22px #7442ff55, 0 0 28px #008bff22;
    }
    #sm-tools-panel {
      position: absolute;
      left: 0;
      bottom: 58px;
      width: min(320px, calc(100vw - 32px));
      max-height: min(78vh, 720px);
      overflow-y: auto;
      padding: 18px;
      box-sizing: border-box;
      border: 1px solid #57418e;
      border-radius: 19px;
      background: rgba(12,10,28,.98);
      color: #f4f0ff;
      box-shadow: 0 0 35px #572cff33, 0 0 45px #087fff22;
      backdrop-filter: blur(18px);
    }
    #sm-tools-panel[hidden] { display: none; }
    #sm-tools-panel h3 { margin: 0 0 12px; font-size: 21px; }
    #sm-tools-panel .sm-tool-link,
    #sm-tools-panel .sm-tool-action {
      display: block;
      width: 100%;
      box-sizing: border-box;
      margin-top: 8px;
      padding: 13px;
      border: 1px solid #292546;
      border-radius: 11px;
      background: #171329;
      color: #f5f1ff;
      font: inherit;
      font-size: 16px;
      text-align: left;
      text-decoration: none;
      cursor: pointer;
    }
    #sm-tools-panel .sm-tool-link:hover,
    #sm-tools-panel .sm-tool-action:hover {
      border-color: #6f55ff;
      background: #21183f;
    }
    #sm-focus-time {
      margin: 15px 0 10px;
      color: #8bdcff;
      font-size: 42px;
      line-height: 1.15;
      font-weight: 850;
            font-variant-numeric: tabular-nums;
      text-align: center;
      letter-spacing: 1px;
    }
    #sm-focus-settings {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: end;
      margin-top: 15px;
    }
    #sm-focus-settings label {
      display: block;
      margin-bottom: 6px;
      color: #d2c9f7;
      font-size: 14px;
      font-weight: 650;
    }
    #sm-focus-minutes {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      padding: 11px;
      border: 1px solid #57418e;
      border-radius: 10px;
      background: #100d20;
      color: #fff;
      font: inherit;
      font-size: 17px;
    }
    #sm-focus-apply {
      padding: 11px 12px;
      border: 1px solid #57418e;
      border-radius: 10px;
      background: #21183f;
      color: white;
      font: inherit;
      font-size: 15px;
      cursor: pointer;
    }
    #sm-focus-start {
      text-align: center !important;
      background: linear-gradient(100deg,#652bce,#086ebd) !important;
      border-color: #7c6aff !important;
      font-weight: 800 !important;
      text-align: center;
    }
    #sm-focus-reset { text-align: center !important; }
    #sm-focus-hint {
      margin: 8px 0 0;
      color: #b8b0d8;
      font-size: 13px;
      line-height: 1.45;
      text-align: center;
    }
    @media(max-width:700px) {
      #sm-study-tools { left: 10px; bottom: 10px; }
      #sm-tools-toggle { font-size: 14px; padding: 11px 13px; }
      #sm-tools-panel { max-height: 75vh; }
    }
  `;
  document.head.appendChild(css);

  const root = document.createElement('div');
  root.id = 'sm-study-tools';
  root.innerHTML = `
    <button id="sm-tools-toggle" type="button"
      aria-expanded="false" aria-controls="sm-tools-panel">
      ✦ Study Tools
    </button>
    <section id="sm-tools-panel" aria-label="Quick study tools" hidden>
      <h3>Quick study tools</h3>
      <a class="sm-tool-link" href="#overview">⌂ Overview</a>
      <a class="sm-tool-link" href="#tasks">✓ Tasks & deadlines</a>
      <a class="sm-tool-link" href="#plans">▤ Study plans</a>
      <a class="sm-tool-link" href="#recovery">↻ Catch-up & recovery</a>
      <a class="sm-tool-link" href="#exams">◇ Exam countdowns</a>
      <a class="sm-tool-link" href="#assistant">✧ StudyMate assistant</a>

      <div id="sm-focus-settings">
        <div>
          <label for="sm-focus-minutes">Focus duration (minutes)</label>
          <input id="sm-focus-minutes" type="number" min="1" max="180" step="1" value="25" inputmode="numeric">
        </div>
        <button id="sm-focus-apply" type="button">Set time</button>
      </div>
      <div id="sm-focus-time" role="timer" aria-live="off">25:00</div>
      <button class="sm-tool-action" id="sm-focus-start" type="button">Start focus</button>
      <button class="sm-tool-action" id="sm-focus-reset" type="button">Reset timer</button>
      <p id="sm-focus-hint">Choose 1–180 minutes. A beep will play when the timer ends.</p>
    </section>
  `;
  document.body.appendChild(root);

  const toggle = document.getElementById('sm-tools-toggle');
  const panel = document.getElementById('sm-tools-panel');
  const display = document.getElementById('sm-focus-time');
  const start = document.getElementById('sm-focus-start');
  const reset = document.getElementById('sm-focus-reset');
  const minutesInput = document.getElementById('sm-focus-minutes');
    const apply = document.getElementById('sm-focus-apply');
  const hint = document.getElementById('sm-focus-hint');

  let duration = 25 * 60;
  let remaining = duration;
  let timer = null;
  let finished = false;

  function updateTimer() {
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    display.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function stopTimer() {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  }

  function playCompletionBeep() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const audio = new AudioContextClass();
      const playTone = (frequency, startAt, length) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, audio.currentTime + startAt);
        gain.gain.exponentialRampToValueAtTime(0.22, audio.currentTime + startAt + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + startAt + length);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(audio.currentTime + startAt);
        oscillator.stop(audio.currentTime + startAt + length + 0.03);
      };
      audio.resume().then(() => {
        playTone(880, 0, 0.18);
        playTone(1175, 0.24, 0.22);
        window.setTimeout(() => audio.close().catch(() => {}), 800);
      }).catch(() => {});
    } catch (error) {
      // Audio may be blocked by the browser; the on-screen notification still appears.
    }
  }

  function completeTimer() {
    stopTimer();
    remaining = 0;
    finished = true;
    updateTimer();
    start.textContent = 'Start another session';
    hint.textContent = 'Focus session complete. Take a short break!';
    playCompletionBeep();

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('StudyMate AI', {
          body: `${Math.floor(duration / 60)}-minute focus session complete. Take a short break!`
        });
      } catch (error) {}
    }
    if (typeof notify === 'function') notify('Focus session complete. Take a short break!');
  }

  function applyDuration() {
    const minutes = Number(minutesInput.value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) {
      hint.textContent = 'Enter a whole number between 1 and 180.';
      minutesInput.focus();
      return;
    }
    stopTimer();
    duration = minutes * 60;
    remaining = duration;
    finished = false;
    updateTimer();
    start.textContent = 'Start focus';
    hint.textContent = `Ready for a ${minutes}-minute focus session.`;
  }

  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  });

  panel.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    });
  });

  apply.addEventListener('click', applyDuration);
  minutesInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') applyDuration();
  });

  start.addEventListener('click', () => {
        if (timer !== null) {
      stopTimer();
      start.textContent = 'Resume focus';
      hint.textContent = 'Timer paused. Resume when you are ready.';
      return;
    }

    if (finished || remaining <= 0) {
      remaining = duration;
      finished = false;
      updateTimer();
    }

    start.textContent = 'Pause focus';
    hint.textContent = 'Focus session is running.';
    timer = window.setInterval(() => {
      remaining = Math.max(0, remaining - 1);
      updateTimer();
      if (remaining <= 0) completeTimer();
    }, 1000);
  });

  reset.addEventListener('click', () => {
    stopTimer();
    remaining = duration;
    finished = false;
    updateTimer();
    start.textContent = 'Start focus';
    hint.textContent = `Timer reset to ${Math.floor(duration / 60)} minute${duration === 60 ? '' : 's'}.`;
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }
  });
})();

for(const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});

refresh().catch(error=>{$('overview-priorities').innerHTML=`<div class="empty">Could not load saved data: ${safe(error.message)}</div>`;notify(error.message,true);});

/* STUDYMATE — ACTIVE LEARNING QUICK ACTIONS */
(function addLearningActions() {
  const panel = document.getElementById('sm-tools-panel');
  if (!panel || document.getElementById('sm-learning-actions')) return;

  const style = document.createElement('style');
  style.textContent = `
    #sm-learning-actions {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid #39305e;
    }
    #sm-learning-actions h4 {
      margin: 0 0 9px;
      font-size: 16px;
      color: #bba8ff;
    }
    #sm-learning-actions button {
      display: block;
      width: 100%;
      margin-top: 7px;
      padding: 11px;
      border: 1px solid #39305e;
      border-radius: 10px;
      background: #171329;
      color: #f5f1ff;
      font: inherit;
      font-size: 14px;
      text-align: left;
      cursor: pointer;
    }
    #sm-learning-actions button:hover {
      border-color: #48caff;
      box-shadow: 0 0 13px #7047ff35;
    }
  `;
  document.head.appendChild(style);

  const section = document.createElement('div');
  section.id = 'sm-learning-actions';
  section.innerHTML = `
    <h4>Learn actively</h4>
    <button type="button" data-learning-prompt="quiz">
      ◈ Quiz me on a topic
    </button>
    <button type="button" data-learning-prompt="explain">
      ✧ Explain a difficult concept
    </button>
    <button type="button" data-learning-prompt="exam">
      ◷ Create an exam revision sprint
    </button>
    <button type="button" data-learning-prompt="reflect">
      ↗ Review my last study session
    </button>
  `;
  panel.appendChild(section);

  const prompts = {
    quiz: 'Help me practise active recall. Ask me which subject and topic I want to study, then ask one question at a time. Wait for my answer, explain mistakes constructively, and summarise what I should revise. Do not pretend to know my mastery level before testing me.',
    explain: 'Help me understand a difficult concept. Ask me which subject and concept I need help with, then explain it in clear steps with an example and finish by checking my understanding.',
    exam: 'Help me create an exam revision sprint. Use my saved exams, open tasks, deadlines, and available study time when available. Ask for any missing essential details, then suggest a focused plan and let me review it before saving anything.',
    reflect: 'Help me reflect on my latest study session. Use saved session outcomes if available. If no outcome is recorded, ask how the session went. Identify one useful next step without inventing performance or mastery data.'
  };

  section.addEventListener('click', event => {
    const button = event.target.closest('[data-learning-prompt]');
    if (!button) return;

    const key = button.dataset.learningPrompt;
    const message = prompts[key];
    if (!message || typeof sendMessage !== 'function') {
      notify('The study assistant is not ready yet.', true);
      return;
    }

    panel.hidden = true;
    const toggle = document.getElementById('sm-tools-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');

    navigate('assistant');
    sendMessage(message);
  });
})();
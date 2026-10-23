import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studymate-test-'));
process.env.STUDYMATE_DATA_FILE = path.join(temp, 'data.json');
process.env.STUDYMATE_TIMEZONE = 'Asia/Kolkata';
process.env.GEMINI_API_KEY = '';
const { app, getState } = await import('../server.js');
let server; let base;
before(async () => { server = app.listen(0); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(temp, { recursive: true, force: true }); });
const post = async (route, body, headers = {}) => fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('serves the labeled simulator and workspace styles from the app', async () => {
  const page = await fetch(`${base}/`); const html = await page.text();
  assert.equal(page.status, 200); assert.match(html, /ALEXA\+-STYLE INTERACTION DEMO/i);
  assert.doesNotMatch(html, /href="style\.css"/,'legacy light theme must not be loaded');
  for (const view of ['overview','tasks','plans','recovery','exams','assistant','activity']) { assert.match(html, new RegExp(`href="#${view}"`)); assert.match(html, new RegExp(`data-view="${view}"`)); }
  assert.match(html,/data-task-filter=/); assert.match(html,/data-plan-tab=/);
  assert.match(html,/id="intro-chip"/); assert.match(html,/id="skip-intro"/); assert.match(html,/id="task-detail-dialog"/); assert.match(html,/id="activity-detail-dialog"/); assert.match(html,/id="overview-chat-form"/);
  const htmlIds=[...html.matchAll(/id="([^"]+)"/g)].map(match=>match[1]); assert.equal(new Set(htmlIds).size,htmlIds.length,'HTML IDs must be unique');
  assert.match(html, /POST \/mcp|MCP tools/i); assert.match(html, /session-outcome-form/); assert.match(html, /confirm-dialog/);
  const css = await (await fetch(`${base}/workspace.css`)).text();
  assert.match(css, /#070812/i); assert.match(css, /#101324/i); assert.match(css, /drawer-dialog/); assert.match(css, /max-width:700px/); assert.match(css, /prefers-reduced-motion/); assert.match(css,/mobile-nav-open/);
  for (const token of ['#070812','#101324','#181A31','#7C3AED','#22D3EE','#3B82F6','#F472E8']) assert.ok(css.toLowerCase().includes(token.toLowerCase()),`missing visual token ${token}`);
  assert.match(css,/focus-visible/); assert.match(html,/risk-radar/); assert.match(html,/preferences-form/); assert.match(html,/reminder-form/);
  assert.match(css,/aria-selected=true/); assert.match(css,/button:disabled/); assert.match(css,/select option/); assert.match(css,/intro-peek/); assert.match(css,/animation-duration:2\.2s/);
  assert.match(html,/id="build-recovery"/); assert.match(html,/id="build-scenario-alt"/); assert.match(html,/DEVELOPER \/ INTEGRATION DETAILS/);
  const script = await (await fetch(`${base}/script.js`)).text();
  assert.match(script, /data-plan-action/); assert.match(script, /showView/); assert.match(script, /kind:'scenario'/);
  assert.match(script,/\/recover`/); assert.match(script,/mobile-nav-scrim/);
  const referencedIds = [...script.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
  const declaredIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  assert.deepEqual([...new Set(referencedIds.filter(id => id !== 'adjust-minutes' && !declaredIds.has(id)))], []);
  assert.equal((await fetch(`${base}/script.js`)).status, 200);
});

test('saves explicit study memory, estimates deadlines, scenarios and reminder actions', async () => {
  const pref = await fetch(`${base}/api/preferences`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({preferredMinutes:30,priorities:['Physics exam']}) });
  assert.equal(pref.status,200);
  const today = (await (await fetch(`${base}/api/state`)).json()).today;
  const taskResponse = await post('/api/tasks',{title:'Radar Physics chapter',due:today,priority:'high',estimateMinutes:70});
  assert.equal(taskResponse.status,201);
  const task = (await taskResponse.json()).task;
  const stateBeforeScenario = await (await fetch(`${base}/api/state`)).json();
  assert.equal(stateBeforeScenario.riskRadar.assessed,true);
  assert.ok(stateBeforeScenario.riskRadar.items.some(item=>item.estimatedMinutes>=70));
  const scenario = (await (await post('/api/plans',{minutes:25,kind:'scenario',focusSubject:'Physics'})).json()).plan;
  assert.equal(scenario.kind,'scenario'); assert.equal(scenario.status,'proposed');
  const unknownSubject=await post('/api/plans',{minutes:25,kind:'scenario',focusSubject:'No such saved subject'});
  assert.equal(unknownSubject.status,400); assert.match((await unknownSubject.json()).error,/No open saved task matches/i);
  assert.equal(getState().plans.filter(item=>item.status==='approved').length,0);
  await fetch(`${base}/api/tasks/${task.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({priority:'medium'})});
  const stale = await post(`/api/plans/${scenario.id}/approve`,{});
  assert.equal(stale.status,400); assert.match((await stale.json()).error,/changed after this proposal/i);
  const remindersState = await (await fetch(`${base}/api/state`)).json();
  const deadlineReminders = remindersState.reminders.filter(item=>item.taskId===task.id);
  assert.equal(deadlineReminders.length,1,'state refresh must not create duplicate deadline reminders');
  const reminder = deadlineReminders[0];
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`)+86400000).toISOString().slice(0,10);
  const changingTask = (await (await post('/api/tasks',{title:'Deadline changed reminder',due:today})).json()).task;
  const oldReminderState = await (await fetch(`${base}/api/state`)).json();
  const oldDeadlineReminder = oldReminderState.reminders.find(item=>item.taskId===changingTask.id);
  await fetch(`${base}/api/tasks/${changingTask.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({due:tomorrow})});
  const changedReminderState = await (await fetch(`${base}/api/state`)).json();
  assert.equal(changedReminderState.reminders.find(item=>item.id===oldDeadlineReminder.id).status,'dismissed');
  assert.equal(changedReminderState.reminders.filter(item=>item.taskId===changingTask.id&&item.status==='upcoming').length,1);
  await post(`/api/tasks/${changingTask.id}/complete`,{}); await fetch(`${base}/api/state`);
  await post(`/api/tasks/${changingTask.id}/reopen`,{});
  assert.equal((await (await fetch(`${base}/api/state`)).json()).reminders.find(item=>item.id===`deadline-${changingTask.id}-${tomorrow}`).status,'upcoming','reopening a task reactivates its task-linked reminder');
  const edited = await fetch(`${base}/api/reminders/${encodeURIComponent(reminder.id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({due:tomorrow})});
  assert.equal((await edited.json()).reminder.due,tomorrow);
  const snoozed = await post(`/api/reminders/${encodeURIComponent(reminder.id)}/snooze`,{until:tomorrow});
  assert.equal((await snoozed.json()).reminder.status,'snoozed');
  assert.equal((await post(`/api/reminders/${encodeURIComponent(reminder.id)}/dismiss`,{})).status,200);
  const custom = await (await post('/api/reminders',{title:'Review session notes',due:tomorrow})).json();
  assert.equal((await post(`/api/reminders/${encodeURIComponent(custom.reminder.id)}/complete`,{})).status,200);
  await fetch(`${base}/api/preferences`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({remindersEnabled:false})});
  assert.equal((await post('/api/reminders',{title:'Disabled reminder',due:tomorrow})).status,400);
  const memory = await (await fetch(`${base}/api/state`)).json();
  assert.deepEqual(memory.preferences.priorities,['Physics exam']); assert.equal(memory.preferences.preferredMinutes,30); assert.equal(memory.preferences.remindersEnabled,false);
  const contextual = await (await post('/api/chat',{message:'What should I study today?',sessionId:'memory-follow-up'})).json();
  assert.match(contextual.reply,/saved 30 minutes as a daily preference/i);
  const consented = await (await post('/api/chat',{message:'Yes, use it.',sessionId:'memory-follow-up'})).json();
  assert.equal(consented.plan.minutes,30); assert.equal(consented.plan.status,'proposed');
  const restartedMemory = await import(`../server.js?preferences-check=${Date.now()}`);
  assert.equal(restartedMemory.getState().preferences.preferredMinutes,30);
  const cleared = await fetch(`${base}/api/preferences`,{method:'DELETE'});
  assert.equal((await cleared.json()).preferences.preferredMinutes,null);
  assert.ok(getState().tasks.some(item=>item.id===task.id),'clearing optional memory retains factual task data');
  assert.ok(JSON.parse(fs.readFileSync(process.env.STUDYMATE_DATA_FILE,'utf8')).reminders.some(item=>item.id===custom.reminder.id));
  await post(`/api/tasks/${task.id}/complete`,{});
});

test('assesses exam-only deadlines and invalidates proposals after preference changes', async () => {
  const today = (await (await fetch(`${base}/api/state`)).json()).today;
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0,10);
  await fetch(`${base}/api/preferences`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({preferredMinutes:15}) });
  await post('/api/exams',{subject:'Exam-only Algebra',date:tomorrow});
  const task=(await (await post('/api/tasks',{title:'Exam-only Algebra practice',estimateMinutes:75})).json()).task;
  const risk=(await (await fetch(`${base}/api/state`)).json()).riskRadar;
  assert.ok(risk.items.some(item=>item.deadline===tomorrow&&item.evidence.includes('Exam-only Algebra')),'exam date must supply a deadline when the task has none');
  const proposal=(await (await post('/api/plans',{minutes:20})).json()).plan;
  await fetch(`${base}/api/preferences`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({preferredMinutes:25})});
  const approval=await post(`/api/plans/${proposal.id}/approve`,{});
  assert.equal(approval.status,400); assert.match((await approval.json()).error,/study preferences.*changed/i);
  await post(`/api/tasks/${task.id}/complete`,{});
  await fetch(`${base}/api/preferences`,{method:'DELETE'});
});

test('preserves malformed local data and starts with a recoverable empty store', () => {
  const corruptFile=path.join(temp,'corrupt-store.json');
  fs.writeFileSync(corruptFile,'{"tasks": [', 'utf8');
  const child=spawnSync(process.execPath,['--input-type=module','-e',"await import('./server.js')"],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,STUDYMATE_DATA_FILE:corruptFile}});
  assert.equal(child.status,0,child.stderr);
  assert.match(child.stderr,/original was preserved/i);
  assert.ok(fs.readdirSync(temp).some(name=>name.startsWith('corrupt-store.json.corrupt-')),'the unreadable file must be kept as a recovery copy');
});

test('creates validated tasks and makes retries idempotent', async () => {
  const headers = { 'Idempotency-Key': 'task-retry-1' };
  const first = await post('/api/tasks', { title: 'Database assignment', due: 'tomorrow', priority: 'high' }, headers);
  const retry = await post('/api/tasks', { title: 'Database assignment', due: 'tomorrow', priority: 'high' }, headers);
  assert.equal(first.status, 201); assert.equal(retry.status, 201);
  assert.equal((await first.json()).task.id, (await retry.json()).task.id);
  assert.equal(getState().tasks.filter(t => t.title === 'Database assignment').length, 1);
  assert.equal((await post('/api/tasks', { title: '   ' })).status, 400);
  assert.equal((await post('/api/tasks', { title: 'Ambiguous date', due: '10/25' })).status, 400);
  const reopenTask = (await (await post('/api/tasks', { title: 'Reopen test' })).json()).task;
  await post(`/api/tasks/${reopenTask.id}/complete`, {});
  const reopened = await post(`/api/tasks/${reopenTask.id}/reopen`, {});
  assert.equal((await reopened.json()).task.done, false);
  const edited = await fetch(`${base}/api/tasks/${reopenTask.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ due:'tomorrow', priority:'high' }) });
  assert.equal(edited.status, 200); assert.equal((await edited.json()).task.priority, 'high');
  const invalidMultiField = await fetch(`${base}/api/tasks/${reopenTask.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ title:'Must not partially apply', due:'10/25' }) });
  assert.equal(invalidMultiField.status,400); assert.equal(getState().tasks.find(item=>item.id===reopenTask.id).title,'Reopen test','a rejected update must not leak a partial in-memory mutation');
  await fetch(`${base}/api/preferences`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({preferredMinutes:20})});
  const invalidPreferences=await fetch(`${base}/api/preferences`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({preferredMinutes:60,priorities:['okay','']})});
  assert.equal(invalidPreferences.status,400); assert.equal(getState().preferences.preferredMinutes,20,'a rejected preference edit must not partially apply');
  await fetch(`${base}/api/preferences`,{method:'DELETE'});
  const beforeChat = getState().tasks.length;
  const ambiguousChat = await (await post('/api/chat', { message: 'add task Lab report due 10/25', sessionId: 'ambiguous-date-test' })).json();
  assert.equal(ambiguousChat.needsClarification, true); assert.equal(getState().tasks.length, beforeChat);
});

test('interprets dates consistently and rejects invalid calendar dates', async () => {
  const state = await (await fetch(`${base}/api/state`)).json();
  const added = await (await post('/api/tasks', { title: 'Exact date', due: '2027-02-28' })).json();
  assert.equal(added.task.due, '2027-02-28');
  assert.equal((await post('/api/tasks', { title: 'Bad date', due: '2027-02-30' })).status, 400);
  assert.ok(state.timezone);
});

test('persists tasks, handles missing IDs, and approves a bounded study plan', async () => {
  assert.equal((await post('/api/tasks/999999/complete', {})).status, 404);
  const proposedResponse = await post('/api/plans', { minutes: 30 }); assert.equal(proposedResponse.status, 201);
  const plan = (await proposedResponse.json()).plan; assert.equal(plan.status, 'proposed');
  assert.ok(plan.allocations.reduce((total, item) => total + item.minutes, 0) <= 30);
  const approvalResponse = await post(`/api/plans/${plan.id}/approve`, {}); const approved = await approvalResponse.json();
  assert.equal(approvalResponse.status, 200, JSON.stringify(approved));
  assert.equal(approved.plan.status, 'approved');
  const partial = await post(`/api/plans/${plan.id}/outcome`, { outcome:'partial', remainingMinutes:18 });
  assert.equal((await partial.json()).plan.outcome.remainingMinutes, 18);
  const disk = JSON.parse(fs.readFileSync(process.env.STUDYMATE_DATA_FILE, 'utf8'));
  assert.equal(disk.plans.find(p => p.id === plan.id).status, 'approved');
  const restarted = await import(`../server.js?restart-check=${Date.now()}`);
  assert.equal(restarted.getState().plans.find(p => p.id === plan.id).status, 'approved');
  assert.equal(restarted.getState().plans.find(p => p.id === plan.id).outcome.remainingMinutes, 18);
  assert.equal(restarted.getState().preferences.preferredMinutes,null);
  assert.ok(restarted.getState().tasks.some(task => task.title === 'Database assignment'));
  const recoveryResponse = await post(`/api/plans/${plan.id}/recover`, { minutes: 15 });
  assert.equal(recoveryResponse.status, 201);
  const recovery = (await recoveryResponse.json()).plan;
  assert.equal(recovery.kind, 'recovery'); assert.equal(recovery.sourcePlanId, plan.id);
  const sourceIds = new Set([...plan.allocations.map(previous => previous.taskId), ...plan.unplanned]);
  assert.ok(recovery.allocations.every(item => sourceIds.has(item.taskId)));
  assert.ok(recovery.allocations.reduce((sum, item) => sum + item.minutes, 0) <= 15);
  const retryKey = { 'Idempotency-Key': 'recovery-retry-key' };
  const retryA = await (await post(`/api/plans/${plan.id}/recover`, { minutes: 15 }, retryKey)).json();
  const retryB = await (await post(`/api/plans/${plan.id}/recover`, { minutes: 15 }, retryKey)).json();
  assert.equal(retryA.plan.id, retryB.plan.id);
  assert.equal((await (await post(`/api/plans/${recovery.id}/approve`, {})).json()).plan.status, 'approved');
  const missed = await (await post('/api/chat', { message: 'I missed my study session. I have 10 minutes to catch up.', sessionId: 'missed-session-test' })).json();
  assert.equal(missed.plan.kind, 'recovery'); assert.match(missed.reply, /last approved session/i);
  const adjusted = await (await post('/api/chat', { message: 'Actually, make that 12 minutes.', sessionId: 'missed-session-test' })).json();
  assert.equal(adjusted.plan.kind, 'recovery'); assert.equal(adjusted.plan.minutes, 12);
  assert.equal(getState().plans.find(item => item.id === missed.plan.id).status, 'cancelled');
  const cancelled = (await (await post('/api/plans', { minutes: 10 })).json()).plan;
  assert.equal((await post(`/api/plans/${cancelled.id}/cancel`, {})).status, 200);
  assert.equal(getState().plans.find(p => p.id === cancelled.id).status, 'cancelled');
});

test('confirms task deadline changes, replans from less time, and compares saved allocations', async () => {
  const task = (await (await post('/api/tasks', { title:'Networking revision', priority:'high' })).json()).task;
  const approved = (await (await post('/api/plans', { minutes:35 })).json()).plan;
  await post(`/api/plans/${approved.id}/approve`, {});
  const sessionId = 'context-recovery-flow';
  const askMove = await (await post('/api/chat', { message:'Move the unfinished networking revision to tomorrow.', sessionId })).json();
  assert.equal(askMove.needsConfirmation, true); assert.equal(getState().tasks.find(item=>item.id===task.id).due, null);
  const confirmed = await (await post('/api/chat', { message:'Yes, confirm.', sessionId })).json();
  const today = (await (await fetch(`${base}/api/state`)).json()).today;
  assert.equal(confirmed.task.due, new Date(Date.parse(`${today}T00:00:00Z`)+86400000).toISOString().slice(0,10));
  const revised = await (await post('/api/chat', { message:'I have only 40 minutes left today.', sessionId })).json();
  assert.equal(revised.plan.kind, 'recovery'); assert.equal(revised.plan.minutes, 40);
  const compare = await (await post('/api/chat', { message:'What changed?', sessionId })).json();
  assert.ok(compare.comparison); assert.match(compare.reply, /approved session/i);
  const events = getState().history.map(item=>item.action);
  assert.ok(events.includes('MCP request') || events.includes('Task updated'));
});

test('runs a study operations loop and commits only the chosen what-if proposal', async () => {
  const tomorrow = new Date(Date.parse(`${(await (await fetch(`${base}/api/state`)).json()).today}T00:00:00Z`)+86400000).toISOString().slice(0,10);
  await post('/api/exams',{subject:'Journey Physics',date:tomorrow});
  await post('/api/tasks',{title:'Journey Physics revision',due:tomorrow,priority:'high',estimateMinutes:45});
  await post('/api/tasks',{title:'Journey literature essay',due:tomorrow,priority:'medium',estimateMinutes:40});
  const approved = (await (await post('/api/plans',{minutes:60})).json()).plan;
  assert.equal((await post(`/api/plans/${approved.id}/approve`,{})).status,200);
  const alternativeA = (await (await post('/api/plans',{minutes:30,kind:'scenario',focusSubject:'Journey Physics'})).json()).plan;
  const alternativeB = (await (await post('/api/plans',{minutes:45,kind:'scenario',focusSubject:'Journey literature'})).json()).plan;
  assert.equal(alternativeA.allocations[0].title,'Journey Physics revision');
  assert.equal(alternativeB.allocations[0].title,'Journey literature essay');
  const chatScenario = await (await post('/api/chat',{message:'What if I prioritize Journey Physics, I have 25 minutes instead of an hour?',sessionId:'chat-scenario'})).json();
  assert.equal(chatScenario.plan.kind,'scenario'); assert.equal(chatScenario.plan.focusSubject,'Journey Physics');
  assert.equal(getState().plans.find(item=>item.id===approved.id).status,'approved');
  assert.equal(getState().plans.find(item=>item.id===approved.id).minutes,60);
  const selected = await post(`/api/plans/${alternativeA.id}/approve`,{});
  assert.equal(selected.status,200);
  assert.equal(getState().plans.find(item=>item.id===alternativeA.id).status,'approved');
  assert.equal(getState().plans.find(item=>item.id===approved.id).status,'approved');
  const afterRestart = await import(`../server.js?journey-restart=${Date.now()}`);
  assert.equal(afterRestart.getState().plans.find(item=>item.id===alternativeA.id).status,'approved');
  const history = await (await post('/api/chat',{message:'What changed?',sessionId:'scenario-history'})).json();
  assert.ok(history.comparison); assert.match(history.reply,/what-if scenario/i);
  for (const item of getState().tasks.filter(task=>task.title.startsWith('Journey '))) await post(`/api/tasks/${item.id}/complete`,{});
});

test('uses deterministic task fallback when Gemini credentials are missing', async () => {
  const response = await post('/api/chat', { message: 'What is photosynthesis?', sessionId: 'fallback-test' });
  const result = await response.json(); assert.equal(result.source, 'fallback'); assert.match(result.reply, /manage your saved study tasks/i);
  const planResponse = await post('/api/chat', { message: 'I have 45 minutes. Help me decide what to study.', sessionId: 'plan-test' });
  const planResult = await planResponse.json(); assert.ok(planResult.plan); assert.equal(planResult.plan.minutes, 45);
});

test('reports Gemini failure without exposing provider details', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'invalid-test-credential';
  globalThis.fetch = async (url, options) => String(url).includes('generativelanguage.googleapis.com')
    ? new Response(JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    : originalFetch(url, options);
  try {
    const result = await (await post('/api/chat', { message: 'Can you explain photosynthesis?', sessionId: 'invalid-gemini-test' })).json();
    assert.equal(result.source, 'fallback');
    assert.match(result.reply, /AI is unavailable right now/i);
    assert.doesNotMatch(result.reply, /API key not valid|invalid-test-credential/i);
  } finally { globalThis.fetch = originalFetch; process.env.GEMINI_API_KEY = originalKey; }
});

test('prioritizes a task linked to an imminent saved exam and formats malformed JSON errors', async () => {
  await post('/api/exams', { subject: 'Physics', date: 'today' });
  await post('/api/tasks', { title: 'Physics revision', priority: 'medium' });
  const plan = (await (await post('/api/plans', { minutes: 5 })).json()).plan;
  assert.match(plan.allocations[0].title, /Physics/);
  assert.match(plan.allocations[0].reason, /Physics exam today/i);
  const malformed = await fetch(`${base}/api/tasks`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:'{"title":' });
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /valid JSON/i);
});

test('serves real MCP initialize, tool discovery, and invocation over Streamable HTTP', async () => {
  const client = new Client({ name: 'studymate-test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
  await client.connect(transport);
  try {
    assert.equal(transport.protocolVersion, '2025-11-25');
    const tools = await client.listTools(); assert.ok(tools.tools.some(t => t.name === 'propose_study_plan'));
    const result = await client.callTool({ name: 'list_tasks', arguments: {} });
    assert.match(result.content[0].text, /Database assignment/);
  const invalid=await client.callTool({name:'add_task',arguments:{title:'   '}});
  assert.equal(invalid.isError,true); assert.match(invalid.structuredContent.error,/Task title/);
  const missing=await client.callTool({name:'complete_task',arguments:{id:99999999}});
  assert.equal(missing.isError,true); assert.match(missing.structuredContent.error,/not found/i);
  } finally { await client.close(); }
  const simulator = await (await post('/api/chat', { message: 'Show my tasks', sessionId: 'mcp-simulator-test' })).json();
  assert.equal(simulator.source, 'mcp'); assert.ok(simulator.tasks.some(task => task.title === 'Database assignment'));
  assert.ok(getState().history.some(item => item.action === 'MCP request' && /tools\/call · list_tasks/.test(item.detail)));
});

import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';

const TZ = process.env.STUDYMATE_TIMEZONE || 'Asia/Kolkata';
const FILE = path.resolve(process.env.STUDYMATE_DATA_FILE || 'data.json');
const rank = { high: 0, medium: 1, low: 2 };

const emptyDb = () => ({
  tasks: [],
  exams: [],
  nextId: 1,
  history: [],
  plans: [],
  idempotency: {}
});

function loadDb() {
  try {
    const value = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {
      ...emptyDb(),
      ...value,
      idempotency: value.idempotency || {}
    };
  } catch (error) {
    if (error.code === 'ENOENT') return emptyDb();
    throw new Error(`Cannot read ${FILE}: ${error.message}`);
  }
}

let db = loadDb();

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const temp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(temp, FILE);
}

const dateInZone = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);

const today = () => dateInZone();

function shiftDate(days) {
  const [y, m, d] = today().split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + days));
  return x.toISOString().slice(0, 10);
}

function validISO(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) &&
    d.toISOString().slice(0, 10) === value;
}

function resolveDate(value) {
  if (value == null || value === '') return null;

  const d = String(value).trim().toLowerCase();

  if (d === 'today') return today();
  if (d === 'tomorrow') return shiftDate(1);

  if (!validISO(d)) {
    throw new Error(
      'Use an exact date in YYYY-MM-DD format, or say today/tomorrow.'
    );
  }

  return d;
}

const daysLeft = date =>
  Math.round(
    (
      Date.parse(`${date}T00:00:00Z`) -
      Date.parse(`${today()}T00:00:00Z`)
    ) / 86400000
  );

const cleanTitle = value => {
  if (typeof value !== 'string') {
    throw new Error('Task title must be text.');
  }

  const title = value.trim().replace(/\s+/g, ' ');

  if (!title || title.length > 120) {
    throw new Error('Task title must be 1–120 characters.');
  }

  return title;
};

const log = (action, detail) => {
  db.history.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    detail,
    at: new Date().toISOString()
  });

  db.history = db.history.slice(0, 40);
};

function addTask({
  title,
  due = null,
  priority = 'medium',
  idempotencyKey
}) {
  title = cleanTitle(title);

  if (!['high', 'medium', 'low'].includes(priority)) {
    throw new Error('Priority must be high, medium, or low.');
  }

  if (
    idempotencyKey != null &&
    (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.length < 1 ||
      idempotencyKey.length > 200
    )
  ) {
    throw new Error('Idempotency key must be 1–200 characters.');
  }

  if (idempotencyKey && db.idempotency[idempotencyKey]) {
    return db.tasks.find(
      t => t.id === db.idempotency[idempotencyKey]
    );
  }

  const task = {
    id: db.nextId++,
    title,
    due: resolveDate(due),
    priority,
    done: false,
    createdAt: new Date().toISOString()
  };

  db.tasks.push(task);

  if (idempotencyKey) {
    db.idempotency[idempotencyKey] = task.id;

    const keys = Object.keys(db.idempotency);
    if (keys.length > 300) {
      delete db.idempotency[keys[0]];
    }
  }

  log(
    'Task added',
    `${task.title}${task.due ? ` · due ${task.due}` : ''}`
  );

  save();
  return task;
}

function completeTask(id) {
  const task = db.tasks.find(t => t.id === Number(id));

  if (!task) {
    throw new Error('Task not found. Refresh the task list and try again.');
  }

  if (!task.done) {
    task.done = true;
    task.completedAt = new Date().toISOString();

    log('Task completed', task.title);
    save();
  }

  return task;
}

function sortedTasks() {
  return [...db.tasks].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      (a.due || '9999').localeCompare(b.due || '9999') ||
      rank[a.priority] - rank[b.priority] ||
      a.id - b.id
  );
}

function proposePlan(
  minutes,
  {
    kind = 'standard',
    sourcePlanId = null,
    taskIds = null,
    requestKey = null
  } = {}
) {
  const available = Number(minutes);

  if (
    !Number.isInteger(available) ||
    available < 5 ||
    available > 720
  ) {
    throw new Error(
      'Available study time must be a whole number from 5 to 720 minutes.'
    );
  }

  if (
    requestKey != null &&
    (
      typeof requestKey !== 'string' ||
      requestKey.length < 1 ||
      requestKey.length > 200
    )
  ) {
    throw new Error('Idempotency key must be 1–200 characters.');
  }

  if (requestKey) {
    const prior = db.plans.find(
      item => item.requestKey === requestKey
    );
    if (prior) return prior;
  }

  const taskFilter = taskIds ? new Set(taskIds) : null;

  const tasks = sortedTasks().filter(
    t => !t.done && (!taskFilter || taskFilter.has(t.id))
  );

  const examMatch = task =>
    db.exams
      .filter(
        exam =>
          daysLeft(exam.date) >= 0 &&
          (
            task.title.toLowerCase().includes(
              exam.subject.toLowerCase()
            ) ||
            exam.subject.toLowerCase().includes(
              task.title.toLowerCase()
            )
          )
      )
      .sort((a, b) => a.date.localeCompare(b.date))[0];

  const urgency = task =>
    Math.min(
      task.due ? daysLeft(task.due) : Infinity,
      examMatch(task) ? daysLeft(examMatch(task).date) : Infinity
    );

  tasks.sort(
    (a, b) =>
      urgency(a) - urgency(b) ||
      rank[a.priority] - rank[b.priority] ||
      a.id - b.id
  );

  let budget = available;

  const allocations = tasks
    .map(task => {
      if (budget < 5) return null;

      const days = task.due ? daysLeft(task.due) : null;
      const urgent = days !== null && days <= 1;

      const preferred = urgent
        ? 30
        : task.priority === 'high'
          ? 25
          : task.priority === 'medium'
            ? 20
            : 15;

      const allocation = Math.min(preferred, budget);
      budget -= allocation;

      const exam = examMatch(task);
      const examDays = exam ? daysLeft(exam.date) : null;

      const examDrivesPriority =
        exam &&
        examDays <= 7 &&
        (days === null || examDays < days);

      const reason =
        days !== null && days < 0
          ? `Overdue by ${Math.abs(days)} day(s)`
          : days === 0
            ? 'Due today'
            : days === 1
              ? 'Due tomorrow'
              : examDrivesPriority
                ? `${exam.subject} exam ${
                    examDays === 0
                      ? 'today'
                      : `in ${examDays} day(s)`
                  }`
                : task.priority === 'high'
                  ? 'High priority'
                  : task.due
                    ? `Due ${task.due}`
                    : `${
                        task.priority[0].toUpperCase()
                      }${task.priority.slice(1)} priority`;

      return {
        taskId: task.id,
        title: task.title,
        due: task.due,
        priority: task.priority,
        minutes: allocation,
        reason,
        exam: examDrivesPriority
          ? { subject: exam.subject, date: exam.date }
          : null
      };
    })
    .filter(Boolean);

  const plan = {
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    sourcePlanId,
    requestKey,
    minutes: available,
    allocations,
    unplanned: tasks
      .filter(t => !allocations.some(a => a.taskId === t.id))
      .map(t => t.id),
    rationale:
      kind === 'recovery'
        ? sourcePlanId
          ? 'Recovery proposal rebuilt from your last approved session. Completed work is excluded; open work is reprioritized by deadlines, exam dates, and priority.'
          : 'Recovery proposal uses your saved open tasks because no prior approved session was found.'
        : 'Prioritized by saved deadlines, relevant exam dates, and priority. Tasks without enough session time remain open.',
    status: 'proposed',
    createdAt: new Date().toISOString()
  };

  db.plans.unshift(plan);
  db.plans = db.plans.slice(0, 20);

  log(
    'Study plan proposed',
    `${allocations.length} task(s) · ${available} min`
  );

  save();
  return plan;
}

function approvePlan(id) {
  const plan = db.plans.find(p => p.id === id);

  if (!plan) {
    throw new Error('Study plan not found. Request a fresh plan.');
  }

  if (plan.status === 'approved') return plan;

  if (plan.status !== 'proposed') {
    throw new Error('This plan was cancelled and cannot be approved.');
  }

  plan.status = 'approved';
  plan.approvedAt = new Date().toISOString();

  log(
    'Study plan approved',
    `${plan.allocations.length} task(s) · ${plan.minutes} min`
  );

  save();
  return plan;
}

function cancelPlan(id) {
  const plan = db.plans.find(p => p.id === id);

  if (!plan) throw new Error('Study plan not found.');

  if (plan.status === 'proposed') {
    plan.status = 'cancelled';
    log('Study plan cancelled', `${plan.minutes} min plan`);
    save();
  }

  return plan;
}

const asText = value => ({
  content: [{
    type: 'text',
    text: typeof value === 'string'
      ? value
      : JSON.stringify(value)
  }],
  structuredContent: typeof value === 'string'
    ? { message: value }
    : value
});

export function buildMcpServer() {
  const server = new McpServer({
    name: 'studymate-ai',
    version: '2.0.0'
  });

  server.registerTool(
    'list_tasks',
    {
      description: 'List persisted study assignments and deadlines.',
      inputSchema: {}
    },
    async () => asText({
      tasks: sortedTasks(),
      timezone: TZ
    })
  );

  server.registerTool(
    'add_task',
    {
      description: 'Add a study assignment with an optional deadline and priority.',
      inputSchema: {
        title: z.string().min(1).max(120),
        due: z.string().optional(),
        priority: z.enum(['high', 'medium', 'low']).optional(),
        idempotency_key: z.string().min(1).max(200).optional()
      }
    },
    async args => {
      try {
        return asText(addTask({
          ...args,
          idempotencyKey: args.idempotency_key
        }));
      } catch (e) {
        return asText({ error: e.message });
      }
    }
  );

  server.registerTool(
    'complete_task',
    {
      description: 'Mark an existing study task complete by its numeric ID.',
      inputSchema: {
        id: z.number().int().positive()
      }
    },
    async ({ id }) => {
      try {
        return asText(completeTask(id));
      } catch (e) {
        return asText({ error: e.message });
      }
    }
  );

  server.registerTool(
    'propose_study_plan',
    {
      description: 'Propose a prioritized study plan. It is not applied until approved.',
      inputSchema: {
        minutes: z.number().int().min(5).max(720),
        idempotency_key: z.string().min(1).max(200).optional()
      }
    },
    async ({ minutes, idempotency_key }) => {
      try {
        return asText(
          proposePlan(minutes, { requestKey: idempotency_key })
        );
      } catch (e) {
        return asText({ error: e.message });
      }
    }
  );

  server.registerTool(
    'list_exams',
    {
      description: 'List saved exams and dates.',
      inputSchema: {}
    },
    async () => asText({ exams: db.exams })
  );

  return server;
}

const app = express();

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.resolve('public')));

app.get('/api/state', (_req, res) => {
  res.json({
    tasks: sortedTasks(),
    exams: db.exams,
    history: db.history,
    plans: db.plans,
    today: today(),
    timezone: TZ
  });
});

app.post('/api/tasks', (req, res) => {
  try {
    const task = addTask({
      ...req.body,
      idempotencyKey:
        req.get('Idempotency-Key') || req.body.idempotencyKey
    });

    res.status(201).json({ task });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/tasks/:id/complete', (req, res) => {
  try {
    res.json({ task: completeTask(req.params.id) });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.post('/api/plans', (req, res) => {
  try {
    const plan = proposePlan(req.body.minutes, {
      requestKey: req.get('Idempotency-Key')
    });

    res.status(201).json({ plan });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/plans/:id/recover', (req, res) => {
  const source = db.plans.find(
    p => p.id === req.params.id && p.status === 'approved'
  );

  if (!source) {
    return res.status(404).json({
      error: 'Approved study session not found. Refresh your schedule and try again.'
    });
  }

  const sourceTasks = [
    ...source.allocations.map(a => a.taskId),
    ...(source.unplanned || [])
  ];

  const stillOpen = [...new Set(sourceTasks)].filter(
    id => db.tasks.some(t => t.id === id && !t.done)
  );

  try {
    const plan = proposePlan(req.body.minutes, {
      kind: 'recovery',
      sourcePlanId: source.id,
      taskIds: stillOpen,
      requestKey: req.get('Idempotency-Key')
    });

    res.status(201).json({ plan });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/plans/:id/approve', (req, res) => {
  try {
    res.json({ plan: approvePlan(req.params.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/plans/:id/cancel', (req, res) => {
  try {
    res.json({ plan: cancelPlan(req.params.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/exams', (req, res) => {
  try {
    const subject = cleanTitle(req.body.subject);
    const date = resolveDate(req.body.date);

    if (!date) throw new Error('Provide an exam date.');

    const existing = db.exams.find(
      e =>
        e.subject.toLowerCase() === subject.toLowerCase() &&
        e.date === date
    );

    if (existing) {
      return res.json({ exam: existing, duplicate: true });
    }

    const exam = {
      id: `exam-${Date.now()}`,
      subject,
      date
    };

    db.exams.push(exam);
    log('Exam added', `${subject} · ${date}`);
    save();

    res.status(201).json({ exam });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/mcp', async (req, res) => {
  const server = buildMcpServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) {
      res.status(400).json({ error: e.message });
    }
  }
});

app.get('/mcp', (_req, res) =>
  res.status(405)
    .set('Allow', 'POST')
    .json({ error: 'Use Streamable HTTP POST requests.' })
);

app.delete('/mcp', (_req, res) =>
  res.status(405).json({
    error: 'This server uses stateless Streamable HTTP sessions.'
  })
);

async function callMcpTool(req, name, args) {
  const client = new Client({
    name: 'studymate-web-simulator',
    version: '2.0.0'
  });

  try {
    const protocol = req.socket.encrypted ? 'https' : 'http';

    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(
          `${protocol}://127.0.0.1:${req.socket.localPort}/mcp`
        )
      )
    );

    return await client.callTool({
      name,
      arguments: args
    });
  } finally {
    await client.close().catch(() => {});
  }
}

app.post('/api/mcp/call', async (req, res) => {
  const allowed = new Set([
    'list_tasks',
    'add_task',
    'complete_task',
    'propose_study_plan',
    'list_exams'
  ]);

  if (!allowed.has(req.body?.name)) {
    return res.status(400).json({ error: 'Unknown study tool.' });
  }

  try {
    const result = await callMcpTool(
      req,
      req.body.name,
      req.body.arguments || {}
    );

    res.json({ result: result.structuredContent || result });
  } catch (e) {
    res.status(502).json({
      error: `Study tool request failed: ${e.message}`
    });
  }
});

const sessions = new Map();

function parseStudyRequest(raw) {
  const match = raw.match(
    /\b(\d{1,3})\s*(?:minutes?|mins?|m)\b/i
  );

  if (!match) return null;

  if (
    !/\b(plan|study|prioriti[sz]e|what should i|help me decide)\b/i.test(raw)
  ) {
    return null;
  }

  return Number(match[1]);
}

// Gemini handles general questions. No canned AI responses.
async function askAI(question, context = {}) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server.'
    );
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const contextText = [
    context.tasks
      ? `Saved tasks: ${JSON.stringify(context.tasks)}`
      : '',
    context.exams
      ? `Saved exams: ${JSON.stringify(context.exams)}`
      : ''
  ].filter(Boolean).join('\n');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text:
              'You are StudyMate, a concise and accurate study coach. ' +
              'Answer the student directly and explain concepts clearly. ' +
              'Do not claim you have changed or saved tasks unless the app ' +
              'explicitly performed that action. Use supplied task and exam ' +
              'data only when making claims about saved student work.'
          }]
        },
        contents: [{
          role: 'user',
          parts: [{
            text: `${question}${
              contextText
                ? `\n\nStudyMate context:\n${contextText}`
                : ''
            }`
          }]
        }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 900
        }
      }),
      signal: AbortSignal.timeout(20000)
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error?.message || `Gemini returned HTTP ${response.status}.`
    );
  }

  const answer = data.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('')
    .trim();

  if (!answer) {
    throw new Error(
      data.promptFeedback?.blockReason || 'Gemini returned no answer.'
    );
  }

  return answer;
}

app.post('/api/chat', async (req, res) => {
  const raw = typeof req.body?.message === 'string'
    ? req.body.message.trim()
    : '';

  if (!raw || raw.length > 1000) {
    return res.status(400).json({
      error: 'Message must be 1–1000 characters.'
    });
  }

  const requestKey = req.get('Idempotency-Key');
  const sid = String(req.body.sessionId || 'browser').slice(0, 100);
  const state = sessions.get(sid) || {};

  if (
    !state.planId &&
    typeof req.body.activePlanId === 'string'
  ) {
    state.planId = req.body.activePlanId;
  }

  const activeProposal = db.plans.find(
    p => p.id === state.planId && p.status === 'proposed'
  ) || null;

  try {
    const followUpMinutes =
      activeProposal &&
      raw.match(/\b(\d{1,3})\s*(?:minutes?|mins?|m)\b/i);

    const minutes =
      parseStudyRequest(raw) ||
      (followUpMinutes ? Number(followUpMinutes[1]) : null);

    if (minutes) {
      const retryPlan = requestKey &&
        db.plans.find(item => item.requestKey === requestKey);

      if (retryPlan) {
        state.planId = retryPlan.id;
        sessions.set(sid, state);

        return res.json({
          reply: 'I found the existing proposal for this request, so I did not create a duplicate.',
          plan: retryPlan
        });
      }

      const adjustment = Boolean(activeProposal);

      const recovery =
        activeProposal?.kind === 'recovery' ||
        /\b(missed|behind|catch up|recovery|fell behind|falling behind)\b/i.test(raw);

      const prior = recovery
        ? activeProposal?.sourcePlanId
          ? db.plans.find(
              p =>
                p.id === activeProposal.sourcePlanId &&
                p.status === 'approved'
            )
          : db.plans.find(p => p.status === 'approved')
        : null;

      const priorTaskIds = prior
        ? [
            ...prior.allocations.map(a => a.taskId),
            ...(prior.unplanned || [])
          ]
        : null;

      const pendingIds = priorTaskIds
        ? [...new Set(priorTaskIds)].filter(
            id => db.tasks.some(t => t.id === id && !t.done)
          )
        : null;

      const plan = proposePlan(
        minutes,
        recovery
          ? {
              kind: 'recovery',
              sourcePlanId: prior?.id || null,
              taskIds: pendingIds,
              requestKey
            }
          : { requestKey }
      );

      if (activeProposal && activeProposal.id !== plan.id) {
        cancelPlan(activeProposal.id);
      }

      state.planId = plan.id;
      sessions.set(sid, state);

      const reply = adjustment
        ? `I adjusted the proposal to ${minutes} minutes. The earlier proposal was set aside; your approved schedule is unchanged. Review this version before saving.`
        : recovery
          ? `I’ll help you recover the time. ${
              prior
                ? 'I used your last approved session and kept only tasks that are still open.'
                : 'I could not find an earlier approved session, so I used your saved open tasks.'
            } Here is a ${minutes}-minute revised proposal. Review it below before saving.`
          : `I checked your ${
              db.tasks.filter(t => !t.done).length
            } pending task(s). Here is a ${minutes}-minute proposal. Review it below and approve it to save.`;

      return res.json({ reply, plan });
    }

    if (
      /\b(approve|confirm|yes|go ahead)\b/i.test(raw) &&
      state.planId
    ) {
      const plan = approvePlan(state.planId);
      sessions.delete(sid);

      return res.json({
        reply: 'Plan approved and saved. Your schedule is updated.',
        plan
      });
    }

    if (
      /\b(cancel|no thanks|discard)\b/i.test(raw) &&
      state.planId
    ) {
      const plan = cancelPlan(state.planId);
      sessions.delete(sid);

      return res.json({
        reply: 'Plan cancelled. Your tasks and schedule were left unchanged.',
        plan
      });
    }

    if (
      /^(?:add|create) (?:a )?(?:task|assignment)\b/i.test(raw) &&
      /\b(?:due|by)\s+/i.test(raw) &&
      !/\b(?:due|by)\s+(?:today|tomorrow|\d{4}-\d{2}-\d{2})(?=\s+(?:high|medium|low)(?: priority)?\s*$|\s*$)/i.test(raw)
    ) {
      return res.json({
        reply: 'I could not interpret that deadline safely. Use “due today”, “due tomorrow”, or an exact YYYY-MM-DD date.',
        needsClarification: true
      });
    }

    let match;

    if (
      (match = raw.match(
        /^(?:add|create) (?:a )?(?:task|assignment)\s+(.+?)(?:\s+due\s+(today|tomorrow|\d{4}-\d{2}-\d{2}))?(?:\s+(high|medium|low)(?: priority)?)?$/i
      ))
    ) {
      const task = addTask({
        title: match[1],
        due: match[2],
        priority: (match[3] || 'medium').toLowerCase(),
        idempotencyKey: requestKey
      });

      return res.json({
        reply: `Saved “${task.title}”${
          task.due ? ` due ${task.due}` : ''
        }.`,
        task
      });
    }

    if (
      (match = raw.match(
        /^(?:done|complete) (?:task )?#?(\d+)$/i
      ))
    ) {
      const task = completeTask(match[1]);

      return res.json({
        reply: `Marked “${task.title}” complete.`,
        task
      });
    }

    if (
      /\b(list|show|what are my)\b/i.test(raw) &&
      /\b(tasks|assignments)\b/i.test(raw)
    ) {
      const result = await callMcpTool(req, 'list_tasks', {});
      const tasks = result.structuredContent?.tasks || sortedTasks();

      return res.json({
        reply: `${tasks.filter(t => !t.done).length} pending task(s), retrieved through the StudyMate MCP tool.`,
        tasks,
        source: 'mcp'
      });
    }

    if (
      /\b(plan|study|prioriti[sz]e|what should i|help me decide)\b/i.test(raw)
    ) {
      return res.json({
        reply: 'How many minutes do you have today? Tell me your available time so I can build a plan from your saved tasks.',
        needsTime: true
      });
    }

    // General questions always go to Gemini. No canned answer fallback.
    const context = {
      tasks: sortedTasks().map(
        ({ id, title, due, priority, done }) => ({
          id,
          title,
          due,
          priority,
          done
        })
      ),
      exams: db.exams
    };

    const answer = await askAI(raw, context);

    return res.json({
      reply: answer,
      source: 'gemini'
    });
  } catch (error) {
    console.error('StudyMate chat request failed:', error.message);

    const missingKey = !process.env.GEMINI_API_KEY;

    return res.status(missingKey ? 503 : 502).json({
      error: missingKey
        ? 'StudyMate AI is not configured. Add GEMINI_API_KEY to your server .env file.'
        : 'StudyMate could not generate a response right now. Check the server terminal for the Gemini error and try again.'
    });
  }
});

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.type === 'entity.parse.failed') {
    log('Request error', 'Invalid JSON body');
    save();

    return res.status(400).json({
      error: 'Request body must be valid JSON.'
    });
  }

  if (error.type === 'entity.too.large') {
    log('Request error', 'Request body exceeds 32 KB');
    save();

    return res.status(413).json({
      error: 'Request body is too large (maximum 32 KB).'
    });
  }

  log('Request error', 'The server could not complete a request');
  save();

  return res.status(500).json({
    error: 'The server could not complete this request.'
  });
});

const getState = () => ({ ...db });

export {
  app,
  addTask,
  completeTask,
  proposePlan,
  approvePlan,
  cancelPlan,
  resolveDate,
  sortedTasks,
  getState
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const port = Number(process.env.PORT || 3000);

  app.listen(port, () => {
    console.log(
      `StudyMate running at http://localhost:${port} · MCP Streamable HTTP at /mcp · timezone ${TZ}`
    );
  });
}

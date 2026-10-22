// // import express from 'express';
// // import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// // import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
// // import { Client } from '@modelcontextprotocol/sdk/client/index.js';
// // import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
// // import { z } from 'zod';

// // const app = express();
// // app.use(express.json());
// // app.use(express.static('public'));

// // let tasks = [];
// // let nextId = 1;
// // const text = (t) => ({ content: [{ type: 'text', text: t }] });

// // function buildServer() {
// //   const s = new McpServer({ name: 'study-planner', version: '1.0.0' });

// //   s.registerTool('add_task',
// //     { description: 'Add a study task', inputSchema: { title: z.string() } },
// //     async ({ title }) => {
// //       tasks.push({ id: nextId++, title, done: false });
// //       return text(`Added task: ${title}`);
// //     });

// //   s.registerTool('list_tasks',
// //     { description: 'List all tasks', inputSchema: {} },
// //     async () => text(tasks.length
// //       ? tasks.map(t => `${t.id}. [${t.done ? 'x' : ' '}] ${t.title}`).join('\n')
// //       : 'No tasks yet.'));

// //   s.registerTool('complete_task',
// //     { description: 'Mark task done', inputSchema: { id: z.number() } },
// //     async ({ id }) => {
// //       const t = tasks.find(t => t.id === id);
// //       if (!t) return text('Task not found');
// //       t.done = true;
// //       return text(`Completed: ${t.title}`);
// //     });

// //   s.registerTool('add',
// //     { description: 'Add two numbers', inputSchema: { a: z.number(), b: z.number() } },
// //     async ({ a, b }) => text(`${a} + ${b} = ${a + b}`));

// //   s.registerTool('multiply',
// //     { description: 'Multiply two numbers', inputSchema: { a: z.number(), b: z.number() } },
// //     async ({ a, b }) => text(`${a} x ${b} = ${a * b}`));

// //   return s;
// // }


// // app.post('/mcp', async (req, res) => {
// //   const server = buildServer();
// //   const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
// //   res.on('close', () => { transport.close(); server.close(); });
// //   await server.connect(transport);
// //   await transport.handleRequest(req, res, req.body);
// // });
// // app.get('/mcp', (req, res) => res.status(405).end());
// // app.delete('/mcp', (req, res) => res.status(405).end());

// // async function callTool(name, args) {
// //   const client = new Client({ name: 'alexa-sim', version: '1.0.0' });
// //   await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3000/mcp')));
// //   const r = await client.callTool({ name, arguments: args });
// //   await client.close();
// //   return r.content[0].text;
// // }

// // app.post('/api/chat', async (req, res) => {
// //   const msg = (req.body.message || '').trim().toLowerCase();
// //   let m;
// //   try {
// //     if ((m = msg.match(/^add task (.+)/))) return res.json({ reply: await callTool('add_task', { title: m[1] }) });
// //     if (msg.includes('list') && msg.includes('task')) return res.json({ reply: await callTool('list_tasks', {}) });
// //     if ((m = msg.match(/^(?:complete|done) (?:task )?(\d+)/))) return res.json({ reply: await callTool('complete_task', { id: +m[1] }) });
// //     if ((m = msg.match(/(\d+)\s*(?:\+|plus)\s*(\d+)/))) return res.json({ reply: await callTool('add', { a: +m[1], b: +m[2] }) });
// //     if ((m = msg.match(/(\d+)\s*(?:\*|x|times)\s*(\d+)/))) return res.json({ reply: await callTool('multiply', { a: +m[1], b: +m[2] }) });
// //     res.json({ reply: "Try: 'add task revise OS', 'list my tasks', 'done 1', '5 plus 7', '6 times 8'" });
// //   } catch (e) {
// //     res.json({ reply: 'Error: ' + e.message });
// //   }
// // });

// // app.listen(3000, () => console.log('Running on http://localhost:3000  (MCP at /mcp)'));


// // including more variation now
// // require('dotenv').config();

// // here i use module so it will not work on requre so usingh import 
// import 'dotenv/config';



// import express from 'express';
// import fs from 'fs';
// import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
// import { Client } from '@modelcontextprotocol/sdk/client/index.js';
// import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
// import { z } from 'zod';

// const app = express();
// app.use(express.json());
// app.use(express.static('public'));

// // ---------- data (saved in data.json) ----------
// const FILE = 'data.json';
// let db = { tasks: [], exams: [], nextId: 1, log: [] };
// if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
// const save = () => fs.writeFileSync(FILE, JSON.stringify(db, null, 2));

// const text = (t) => ({ content: [{ type: 'text', text: t }] });
// const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
// const daysLeft = (d) => Math.round((new Date(d) - new Date(today())) / 86400000);
// const rank = { high: 0, medium: 1, low: 2 };

// function resolveDate(d) {
//   if (!d) return null;
//   d = d.toLowerCase();
//   if (d === 'today') return today();
//   if (d === 'tomorrow') {
//     const x = new Date(); x.setDate(x.getDate() + 1);
//     return x.toLocaleDateString('en-CA');
//   }
//   return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
// }

// // ---------- MCP tools ----------
// function buildServer() {
//   const s = new McpServer({ name: 'study-coach', version: '1.0.0' });

//   s.registerTool('add_task',
//     { description: 'Add a study task with optional due date (YYYY-MM-DD, today, tomorrow) and priority',
//       inputSchema: { title: z.string(), due: z.string().optional(), priority: z.enum(['high', 'medium', 'low']).optional() } },
//     async ({ title, due, priority }) => {
//       const t = { id: db.nextId++, title, due: resolveDate(due), priority: priority || 'medium', done: false };
//       db.tasks.push(t); save();
//       return text(`Added #${t.id}: ${t.title} (priority: ${t.priority}${t.due ? ', due ' + t.due : ''})`);
//     });

//   s.registerTool('list_tasks',
//     { description: 'List all study tasks', inputSchema: {} },
//     async () => text(db.tasks.length
//       ? db.tasks.map(t => `${t.id}. [${t.done ? 'x' : ' '}] ${t.title} (${t.priority}${t.due ? ', due ' + t.due : ''})`).join('\n')
//       : 'No tasks yet.'));

//   s.registerTool('complete_task',
//     { description: 'Mark a task as done', inputSchema: { id: z.number() } },
//     async ({ id }) => {
//       const t = db.tasks.find(t => t.id === id);
//       if (!t) return text('Task not found');
//       t.done = true; db.log.push(today()); save();
//       return text(`Great job! Completed: ${t.title}`);
//     });

//   s.registerTool('today_plan',
//     { description: 'Suggest the top 3 tasks to study today, using due date and priority, with Pomodoro slots', inputSchema: {} },
//     async () => {
//       const pending = db.tasks.filter(t => !t.done).sort((a, b) =>
//         (a.due || '9999') .localeCompare(b.due || '9999') || rank[a.priority] - rank[b.priority]);
//       if (!pending.length) return text('Nothing pending. Enjoy your break!');
//       const lines = pending.slice(0, 3).map((t, i) => {
//         const late = t.due && daysLeft(t.due) < 0 ? ' OVERDUE' : '';
//         return `Slot ${i + 1} (25 min focus + 5 min break): ${t.title} [${t.priority}${t.due ? ', due ' + t.due : ''}]${late}`;
//       });
//       const exam = db.exams.filter(e => daysLeft(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date))[0];
//       const tip = exam ? `\nReminder: ${exam.subject} exam in ${daysLeft(exam.date)} day(s).` : '';
//       return text("Today's plan:\n" + lines.join('\n') + tip);
//     });

//   s.registerTool('set_exam',
//     { description: 'Save an exam date (YYYY-MM-DD) for a subject', inputSchema: { subject: z.string(), date: z.string() } },
//     async ({ subject, date }) => {
//       const d = resolveDate(date);
//       if (!d) return text('Please give date as YYYY-MM-DD');
//       db.exams.push({ subject, date: d }); save();
//       return text(`Exam saved: ${subject} on ${d} (${daysLeft(d)} days left)`);
//     });

//   s.registerTool('exam_countdown',
//     { description: 'Show days left for all upcoming exams', inputSchema: {} },
//     async () => {
//       const up = db.exams.filter(e => daysLeft(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date));
//       return text(up.length ? up.map(e => `${e.subject}: ${daysLeft(e.date)} day(s) left (${e.date})`).join('\n') : 'No upcoming exams.');
//     });

//   s.registerTool('study_stats',
//     { description: 'Show completed tasks and study streak', inputSchema: {} },
//     async () => {
//       const days = new Set(db.log);
//       let streak = 0;
//       const d = new Date();
//       if (!days.has(d.toLocaleDateString('en-CA'))) d.setDate(d.getDate() - 1);
//       while (days.has(d.toLocaleDateString('en-CA'))) { streak++; d.setDate(d.getDate() - 1); }
//       const done = db.tasks.filter(t => t.done).length;
//       return text(`Completed: ${done}/${db.tasks.length} tasks\nStreak: ${streak} day(s)`);
//     });

//   return s;
// }

// // ---------- MCP endpoint (Streamable HTTP) ----------
// app.post('/mcp', async (req, res) => {
//   const server = buildServer();
//   const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
//   res.on('close', () => { transport.close(); server.close(); });
//   await server.connect(transport);
//   await transport.handleRequest(req, res, req.body);
// });
// app.get('/mcp', (req, res) => res.status(405).end());
// app.delete('/mcp', (req, res) => res.status(405).end());

// // ---------- Simulated Alexa+ chat ----------
// async function callTool(name, args) {
//   const client = new Client({ name: 'alexa-sim', version: '1.0.0' });
//   await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3000/mcp')));
//   const r = await client.callTool({ name, arguments: args });
//   await client.close();
//   return r.content[0].text;
// }

// async function askAI(question) {
//   const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
//   const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
//   const r = await fetch(url, {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//       'x-goog-api-key': process.env.GEMINI_API_KEY
//     },
//     body: JSON.stringify({
//       systemInstruction: {
//         parts: [{ text: 'You are Alexa+, a friendly study assistant for students. Answer assignment and study questions clearly and briefly in simple language.' }]
//       },
//       contents: [{ role: 'user', parts: [{ text: question }] }]
//     })
//   });
//   const data = await r.json();
//   if (!r.ok) throw new Error(data.error?.message || 'AI request failed');
//   return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not answer that.';
// }
// app.post('/api/chat', async (req, res) => {
//   const raw = (req.body.message || '').trim();
//   const msg = raw.toLowerCase();
//   let m;
//   const reply = async (n, a) => res.json({ reply: await callTool(n, a) });
//   try {
//     if ((m = raw.match(/^add task (.+)/i))) {
//       let title = m[1];
//       const due = (title.match(/\bdue (today|tomorrow|\d{4}-\d{2}-\d{2})/i) || [])[1];
//       const pr = (title.match(/\b(high|medium|low)\b/i) || [])[1];
//       title = title.replace(/\bdue (today|tomorrow|\d{4}-\d{2}-\d{2})/i, '').replace(/\b(high|medium|low)( priority)?\b/i, '').trim();
//       return await reply('add_task', { title, due, priority: pr && pr.toLowerCase() });
//     }
//     if ((m = msg.match(/^(?:complete|done) (?:task )?(\d+)/))) return await reply('complete_task', { id: +m[1] });
//     if ((m = raw.match(/^exam (.+) on (\S+)/i))) return await reply('set_exam', { subject: m[1], date: m[2] });
//     if (msg.includes('countdown') || msg === 'exams') return await reply('exam_countdown', {});
//     if (msg.includes('stats') || msg.includes('streak')) return await reply('study_stats', {});
//     if (msg.includes('plan') || msg.includes('what should i')) return await reply('today_plan', {});
//     if (msg.includes('list') && msg.includes('task')) return await reply('list_tasks', {});
   
    
//   } catch (e) {
//     res.json({ reply: 'Error: ' + e.message });
//   }
// });

// app.listen(3000, () => console.log('Running on http://localhost:3000  (MCP at /mcp)'));


import 'dotenv/config';

import express from 'express';
import fs from 'fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ---------- data (saved in data.json) ----------
const FILE = 'data.json';
let db = { tasks: [], exams: [], nextId: 1, log: [] };
if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const save = () => fs.writeFileSync(FILE, JSON.stringify(db, null, 2));

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
const daysLeft = (d) => Math.round((new Date(d) - new Date(today())) / 86400000);
const rank = { high: 0, medium: 1, low: 2 };

function resolveDate(d) {
  if (!d) return null;
  d = d.toLowerCase();
  if (d === 'today') return today();
  if (d === 'tomorrow') {
    const x = new Date(); x.setDate(x.getDate() + 1);
    return x.toLocaleDateString('en-CA');
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

// ---------- MCP tools ----------
function buildServer() {
  const s = new McpServer({ name: 'study-coach', version: '1.0.0' });

  s.registerTool('add_task',
    { description: 'Add a study task with optional due date (YYYY-MM-DD, today, tomorrow) and priority',
      inputSchema: { title: z.string(), due: z.string().optional(), priority: z.enum(['high', 'medium', 'low']).optional() } },
    async ({ title, due, priority }) => {
      const t = { id: db.nextId++, title, due: resolveDate(due), priority: priority || 'medium', done: false };
      db.tasks.push(t); save();
      return text(`Added #${t.id}: ${t.title} (priority: ${t.priority}${t.due ? ', due ' + t.due : ''})`);
    });

  s.registerTool('list_tasks',
    { description: 'List all study tasks', inputSchema: {} },
    async () => text(db.tasks.length
      ? db.tasks.map(t => `${t.id}. [${t.done ? 'x' : ' '}] ${t.title} (${t.priority}${t.due ? ', due ' + t.due : ''})`).join('\n')
      : 'No tasks yet.'));

  s.registerTool('complete_task',
    { description: 'Mark a task as done', inputSchema: { id: z.number() } },
    async ({ id }) => {
      const t = db.tasks.find(t => t.id === id);
      if (!t) return text('Task not found');
      t.done = true; db.log.push(today()); save();
      return text(`Great job! Completed: ${t.title}`);
    });

  s.registerTool('today_plan',
    { description: 'Suggest the top 3 tasks to study today, using due date and priority, with Pomodoro slots', inputSchema: {} },
    async () => {
      const pending = db.tasks.filter(t => !t.done).sort((a, b) =>
        (a.due || '9999').localeCompare(b.due || '9999') || rank[a.priority] - rank[b.priority]);
      if (!pending.length) return text('Nothing pending. Enjoy your break!');
      const lines = pending.slice(0, 3).map((t, i) => {
        const late = t.due && daysLeft(t.due) < 0 ? ' OVERDUE' : '';
        return `Slot ${i + 1} (25 min focus + 5 min break): ${t.title} [${t.priority}${t.due ? ', due ' + t.due : ''}]${late}`;
      });
      const exam = db.exams.filter(e => daysLeft(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date))[0];
      const tip = exam ? `\nReminder: ${exam.subject} exam in ${daysLeft(exam.date)} day(s).` : '';
      return text("Today's plan:\n" + lines.join('\n') + tip);
    });

  s.registerTool('set_exam',
    { description: 'Save an exam date (YYYY-MM-DD) for a subject', inputSchema: { subject: z.string(), date: z.string() } },
    async ({ subject, date }) => {
      const d = resolveDate(date);
      if (!d) return text('Please give date as YYYY-MM-DD');
      db.exams.push({ subject, date: d }); save();
      return text(`Exam saved: ${subject} on ${d} (${daysLeft(d)} days left)`);
    });

  s.registerTool('exam_countdown',
    { description: 'Show days left for all upcoming exams', inputSchema: {} },
    async () => {
      const up = db.exams.filter(e => daysLeft(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date));
      return text(up.length ? up.map(e => `${e.subject}: ${daysLeft(e.date)} day(s) left (${e.date})`).join('\n') : 'No upcoming exams.');
    });

  s.registerTool('study_stats',
    { description: 'Show completed tasks and study streak', inputSchema: {} },
    async () => {
      const days = new Set(db.log);
      let streak = 0;
      const d = new Date();
      if (!days.has(d.toLocaleDateString('en-CA'))) d.setDate(d.getDate() - 1);
      while (days.has(d.toLocaleDateString('en-CA'))) { streak++; d.setDate(d.getDate() - 1); }
      const done = db.tasks.filter(t => t.done).length;
      return text(`Completed: ${done}/${db.tasks.length} tasks\nStreak: ${streak} day(s)`);
    });

  return s;
}

// ---------- MCP endpoint (Streamable HTTP) ----------
app.post('/mcp', async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get('/mcp', (req, res) => res.status(405).end());
app.delete('/mcp', (req, res) => res.status(405).end());

// ---------- Simulated Alexa+ chat ----------
async function callTool(name, args) {
  const client = new Client({ name: 'alexa-sim', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3000/mcp')));
  const r = await client.callTool({ name, arguments: args });
  await client.close();
  return r.content[0].text;
}

// ---------- AI fallback (Gemini) for any question that is not a study command ----------
async function askAI(question) {
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: 'You are Alexa+, a friendly study assistant for students. Answer assignment and study questions clearly and briefly in simple language.' }]
      },
      contents: [{ role: 'user', parts: [{ text: question }] }]
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || 'AI request failed');
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not answer that.';
}

app.post('/api/chat', async (req, res) => {
  const raw = (req.body.message || '').trim();
  const msg = raw.toLowerCase();
  let m;
  const reply = async (n, a) => res.json({ reply: await callTool(n, a) });
  try {
    if ((m = raw.match(/^add task (.+)/i))) {
      let title = m[1];
      const due = (title.match(/\bdue (today|tomorrow|\d{4}-\d{2}-\d{2})/i) || [])[1];
      const pr = (title.match(/\b(high|medium|low)\b/i) || [])[1];
      title = title.replace(/\bdue (today|tomorrow|\d{4}-\d{2}-\d{2})/i, '').replace(/\b(high|medium|low)( priority)?\b/i, '').trim();
      return await reply('add_task', { title, due, priority: pr && pr.toLowerCase() });
    }
    if ((m = msg.match(/^(?:complete|done) (?:task )?(\d+)/))) return await reply('complete_task', { id: +m[1] });
    if ((m = raw.match(/^exam (.+) on (\S+)/i))) return await reply('set_exam', { subject: m[1], date: m[2] });
    if (msg.includes('countdown') || msg === 'exams') return await reply('exam_countdown', {});
    if (msg.includes('stats') || msg.includes('streak')) return await reply('study_stats', {});
    if (/\bplan\b/.test(msg) || msg.includes('what should i')) return await reply('today_plan', {});
    if (msg.includes('list') && msg.includes('task')) return await reply('list_tasks', {});

    // Nothing above matched, so it is a normal question: ask the AI
    const answer = await askAI(raw);
    return res.json({ reply: answer });
  } catch (e) {
    res.json({ reply: 'Error: ' + e.message });
  }
});

app.listen(3000, () => console.log('Running on http://localhost:3000  (MCP at /mcp)'));
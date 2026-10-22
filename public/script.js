const chat = document.getElementById('chat');
const inp = document.getElementById('inp');
const sendBtn = document.getElementById('sendBtn');

sendBtn.addEventListener('click', send);
inp.addEventListener('keydown', e => e.key === 'Enter' && send());

function add(cls, t) {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = t;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
}

async function send() {
  const message = inp.value.trim();
  if (!message) return;
  add('you', message);
  inp.value = '';
  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  });
  const data = await r.json();
  add('alexa', 'Alexa+: ' + data.reply);
}

add('alexa', "Alexa+: Hi! Try 'add task revise OS' or 'list my tasks alexa beta'.");
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const state = {
  me: null,
  currentLevel: 1,
  cache: {}
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function showAuth() {
  $('#auth').classList.remove('hidden');
  $('#game').classList.add('hidden');
  $('#btn-login').classList.remove('hidden');
  $('#btn-logout').classList.add('hidden');
}

function showGame() {
  $('#auth').classList.add('hidden');
  $('#game').classList.remove('hidden');
  $('#btn-login').classList.add('hidden');
  $('#btn-logout').classList.remove('hidden');
}

async function refreshMe() {
  try {
    const me = await api('/api/me');
    state.me = me;
    $('#greet').textContent = `Welcome, ${me.user.username}`;
    $('#progress-pill').textContent = `${me.highestSolved} / ${me.totalLevels}`;
    renderLevels(me);
  } catch {
    state.me = null;
  }
}

function renderLevels(me) {
  const container = $('#levels');
  container.innerHTML = '';
  for (let i = 1; i <= me.totalLevels; i++) {
    const div = document.createElement('div');
    div.className = 'level';
    const prog = me.progress.find(p => p.level === i);
    const highestSolved = me.highestSolved;
    const unlocked = i <= highestSolved + 1;
    const solved = prog?.is_solved === 1;
    div.classList.toggle('unlocked', unlocked);
    div.classList.toggle('solved', solved);
    div.textContent = `Level ${i}`;
    if (unlocked) {
      div.addEventListener('click', () => loadLevel(i));
    }
    container.appendChild(div);
  }
}

async function loadLevel(n) {
  try {
    const data = await api(`/api/level/${n}`);
    state.currentLevel = n;
    state.cache[n] = data;
    $('#level-title').textContent = `Level ${n}`;
    $('#prompt').textContent = data.prompt;
    $('#result').textContent = data.is_solved ? 'Correct' : '';
    $('#result').className = 'result ' + (data.is_solved ? 'ok' : '');
    $('#answer').value = '';
    $('#answer').focus();
  } catch {}
}

async function submitAnswer(e) {
  e.preventDefault();
  const val = $('#answer').value;
  if (!val) return;
  try {
    const res = await api('/api/answer', {
      method: 'POST',
      body: JSON.stringify({ level: state.currentLevel, answer: val })
    });
    if (res.correct) {
      $('#result').textContent = 'Correct';
      $('#result').className = 'result ok';
      await refreshMe();
      const next = Math.min(state.me.highestSolved + 1, state.me.totalLevels);
      if (next > state.currentLevel && next <= state.me.totalLevels) {
        loadLevel(next);
      }
    } else {
      $('#result').textContent = 'Wrong';
      $('#result').className = 'result bad';
    }
  } catch {
    $('#result').textContent = 'Error';
    $('#result').className = 'result bad';
  }
}

async function loadBoard() {
  try {
    const { leaderboard } = await api('/api/leaderboard');
    const tbody = $('#board tbody');
    tbody.innerHTML = '';
    leaderboard.forEach((row, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${i + 1}</td><td>${row.username}</td><td>${row.solved_levels}</td>`;
      tbody.appendChild(tr);
    });
  } catch {}
}

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    $('#auth-msg').textContent = '';
    showGame();
    await refreshMe();
    await loadLevel(state.me.highestSolved + 1 || 1);
    await loadBoard();
  } catch {
    $('#auth-msg').textContent = 'Invalid credentials';
  }
});

$('#register-btn').addEventListener('click', async () => {
  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;
  try {
    await api('/api/register', { method: 'POST', body: JSON.stringify({ username, password }) });
    $('#auth-msg').textContent = '';
    showGame();
    await refreshMe();
    await loadLevel(1);
    await loadBoard();
  } catch {
    $('#auth-msg').textContent = 'Username taken or error';
  }
});

$('#btn-login').addEventListener('click', () => {
  document.getElementById('auth').scrollIntoView({ behavior: 'smooth' });
});

$('#btn-logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  showAuth();
});

(async function init() {
  try {
    await refreshMe();
    if (state.me) {
      showGame();
      await loadLevel(state.me.highestSolved + 1 || 1);
      await loadBoard();
    } else {
      showAuth();
    }
  } catch {
    showAuth();
  }
})();


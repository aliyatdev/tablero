const MAX_BOARDS = 6;
let state = { boards: [] };
let pending = 0;
let editOpenMap = {}; // maps board id to boolean (drawer open)
let soundEnabled = localStorage.getItem("tablero_sound") !== "false";
let audioCtx = null;

const $ = id => document.getElementById(id);

// --- Audio synthesis for tactile feedback ---
function playSound(type) {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === "plus") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.08); // G5
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === "minus") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(330, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.07);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    }
  } catch (e) {
    // Audio restricted before user gesture
  }
}

function updateSoundUI() {
  $("soundIcon").textContent = soundEnabled ? "🔊" : "🔇";
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem("tablero_sound", soundEnabled ? "true" : "false");
  updateSoundUI();
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => { });
  } else {
    document.exitFullscreen().catch(() => { });
  }
}

// --- API Helpers ---
async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

function setLive(ok) {
  const el = $("liveStatus");
  const txt = $("liveText");
  txt.textContent = ok ? "en vivo" : "sin conexión";
  el.classList.toggle("off", !ok);
}

async function mutate(path, body) {
  pending++;
  try {
    state = await api(path, body);
    setLive(true);
  } catch (e) {
    setLive(false);
  } finally {
    pending--;
  }
}

// --- Render Logic ---
function render(bumpPid) {
  const grid = $("gridContainer");
  const boards = state.boards || [];
  const count = boards.length;

  grid.setAttribute("data-count", count);
  $("boardCountLabel").textContent = `${count} de ${MAX_BOARDS} marcadores activos`;

  // Disable button if reached max boards
  const btnNew = $("btnNewBoard");
  if (count >= MAX_BOARDS) {
    btnNew.disabled = true;
    btnNew.title = `Límite alcanzado (${MAX_BOARDS} marcadores simultáneos)`;
  } else {
    btnNew.disabled = false;
    btnNew.title = "Agregar un nuevo marcador";
  }

  grid.innerHTML = "";

  if (count === 0) {
    grid.innerHTML = `
  <div class="empty-state">
    <div style="font-size: 40px; margin-bottom: 12px;">🏆</div>
    <h2 style="font-size: 20px; font-weight: 800; margin-bottom: 8px;">No hay marcadores activos</h2>
    <p style="color: var(--text-secondary); max-width: 400px; margin-bottom: 20px;">
      Crea tu primer marcador para empezar a registrar victorias o derrotas contra el sistema.
    </p>
    <button class="btn btn-primary" onclick="openNewBoardModal()">+ Crear Marcador</button>
  </div>
`;
    return;
  }

  // Render each board card
  for (const b of boards) {
    const card = createBoardCard(b, bumpPid);
    grid.appendChild(card);
  }

  // If there's room for more boards (under 6), show the add-slot placeholder card
  if (count < MAX_BOARDS) {
    const addCard = document.createElement("button");
    addCard.className = "add-slot-card";
    addCard.type = "button";
    addCard.onclick = openNewBoardModal;
    addCard.innerHTML = `
  <div class="add-slot-icon">+</div>
  <div class="add-slot-text">Agregar Marcador</div>
  <div class="add-slot-sub">${MAX_BOARDS - count} espacio${MAX_BOARDS - count > 1 ? "s" : ""} disponible${MAX_BOARDS - count > 1 ? "s" : ""}</div>
`;
    grid.appendChild(addCard);
  }
}

function createBoardCard(b, bumpPid) {
  const card = document.createElement("div");
  card.className = "board-card";
  card.id = `board-${b.id}`;

  const isDrawerOpen = !!editOpenMap[b.id];

  // Header
  const header = document.createElement("div");
  header.className = "board-header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "board-title-wrap";
  titleWrap.title = "Clic para cambiar título";
  titleWrap.onclick = () => renameBoard(b);

  const title = document.createElement("span");
  title.className = "board-title";
  title.textContent = b.title;

  const editHint = document.createElement("span");
  editHint.className = "edit-icon-hint";
  editHint.textContent = "✏️";

  titleWrap.append(title, editHint);

  const actions = document.createElement("div");
  actions.className = "board-actions";

  const btnReset = document.createElement("button");
  btnReset.className = "card-action-btn";
  btnReset.title = "Poner en 0 este marcador";
  btnReset.innerHTML = "↺ 0-0";
  btnReset.onclick = () => resetSingleBoard(b);

  const btnEdit = document.createElement("button");
  btnEdit.className = "card-action-btn" + (isDrawerOpen ? " active" : "");
  btnEdit.title = "Opciones del marcador";
  btnEdit.innerHTML = "⚙";
  btnEdit.onclick = () => toggleBoardDrawer(b.id);

  actions.append(btnReset, btnEdit);
  header.append(titleWrap, actions);

  // Body
  const body = document.createElement("div");
  body.className = "board-body";

  const players = b.players || [];

  if (players.length === 2) {
    // 2-player VS matchup
    const p1 = players[0];
    const p2 = players[1];

    const p1Score = p1.score;
    const p2Score = p2.score;

    const p1Lead = p1Score > p2Score;
    const p2Lead = p2Score > p1Score;
    const isTie = p1Score === p2Score && p1Score > 0;

    let p1BadgeHtml = '<span class="badge neutral">&nbsp;</span>';
    let p2BadgeHtml = '<span class="badge neutral">&nbsp;</span>';

    if (p1Lead) {
      p1BadgeHtml = '<span class="badge win">🏆 Ganando</span>';
      p2BadgeHtml = '<span class="badge loss">Abajo</span>';
    } else if (p2Lead) {
      p1BadgeHtml = '<span class="badge loss">Abajo</span>';
      p2BadgeHtml = '<span class="badge loss">⚠️ Lidera</span>';
    } else if (isTie) {
      p1BadgeHtml = '<span class="badge tie">🤝 Empate</span>';
      p2BadgeHtml = '<span class="badge tie">🤝 Empate</span>';
    }

    const matchup = document.createElement("div");
    matchup.className = "matchup-grid";

    // Player 1
    const p1El = document.createElement("div");
    p1El.className = "competitor side-player" + (p1Lead ? " is-lead" : "");
    p1El.innerHTML = `
  <div class="competitor-meta">
    <button class="competitor-name" onclick="renamePlayer('${b.id}', '${p1.id}', '${escapeHtml(p1.name)}')" title="Clic para renombrar">${escapeHtml(p1.name)}</button>
    ${p1BadgeHtml}
  </div>
  <div class="score-val ${p1.id === bumpPid ? 'bump' : ''}">${p1.score}</div>
  <div class="stepper">
    <button class="step-btn" onclick="changeScore('${b.id}', '${p1.id}', -1)" aria-label="Restar punto">−</button>
    <button class="step-btn plus-player" onclick="changeScore('${b.id}', '${p1.id}', 1)" aria-label="Sumar punto">+</button>
  </div>
`;

    // VS Center
    const vsEl = document.createElement("div");
    vsEl.className = "vs-badge-wrap";
    vsEl.innerHTML = `
  <div class="vs-line"></div>
  <div class="vs-pill">VS</div>
  <div class="vs-line-bottom"></div>
`;

    // Player 2 (Sistema)
    const p2El = document.createElement("div");
    p2El.className = "competitor side-sistema" + (p2Lead ? " is-lead" : "");
    p2El.innerHTML = `
  <div class="competitor-meta">
    <button class="competitor-name" onclick="renamePlayer('${b.id}', '${p2.id}', '${escapeHtml(p2.name)}')" title="Clic para renombrar">${escapeHtml(p2.name)}</button>
    ${p2BadgeHtml}
  </div>
  <div class="score-val ${p2.id === bumpPid ? 'bump' : ''}">${p2.score}</div>
  <div class="stepper">
    <button class="step-btn" onclick="changeScore('${b.id}', '${p2.id}', -1)" aria-label="Restar punto">−</button>
    <button class="step-btn plus-sistema" onclick="changeScore('${b.id}', '${p2.id}', 1)" aria-label="Sumar punto">+</button>
  </div>
`;

    matchup.append(p1El, vsEl, p2El);
    body.appendChild(matchup);
  } else {
    // Fallback: 1 or 3+ players list
    const maxScore = Math.max(...players.map(p => p.score), 0);
    const hasLead = players.length > 1 && maxScore > 0;

    const list = document.createElement("div");
    list.className = "multi-player-list";

    for (const p of players) {
      const isLead = hasLead && p.score === maxScore;
      const row = document.createElement("div");
      row.className = "multi-row" + (isLead ? " is-lead" : "");
      row.innerHTML = `
    <div class="multi-who">
      <button class="competitor-name" onclick="renamePlayer('${b.id}', '${p.id}', '${escapeHtml(p.name)}')">${escapeHtml(p.name)}</button>
      ${isLead ? '<span class="badge win" style="align-self: flex-start; margin-top: 2px;">Ganando</span>' : ''}
    </div>
    <div class="multi-counter">
      <button class="step-btn" style="width: 38px; height: 38px; font-size: 18px;" onclick="changeScore('${b.id}', '${p.id}', -1)">−</button>
      <div class="multi-score ${p.id === bumpPid ? 'bump' : ''}">${p.score}</div>
      <button class="step-btn plus-player" style="width: 38px; height: 38px; font-size: 18px;" onclick="changeScore('${b.id}', '${p.id}', 1)">+</button>
    </div>
  `;
      list.appendChild(row);
    }
    body.appendChild(list);
  }

  // Drawer (Options / Edit)
  const drawer = document.createElement("div");
  drawer.className = "board-drawer" + (isDrawerOpen ? " open" : "");
  drawer.innerHTML = `
<div class="drawer-row">
  <span style="font-size: 11px; color: var(--text-secondary);">Opciones del marcador</span>
  <div style="display: flex; gap: 6px;">
    <button class="drawer-btn" onclick="addNewPlayerPrompt('${b.id}')">+ Agregar jugador</button>
    <button class="drawer-btn danger" onclick="deleteBoard('${b.id}', '${escapeHtml(b.title)}')">Eliminar marcador</button>
  </div>
</div>
  `;

  card.append(header, body, drawer);
  return card;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toggleBoardDrawer(bid) {
  editOpenMap[bid] = !editOpenMap[bid];
  render();
}

// --- Score Mutation Actions ---
async function changeScore(bid, pid, delta) {
  playSound(delta > 0 ? "plus" : "minus");

  // Immediate optimistic update
  const b = state.boards.find(x => x.id === bid);
  if (b) {
    const p = b.players.find(x => x.id === pid);
    if (p) {
      p.score += delta;
      render(pid);
    }
  }

  await mutate(`/api/boards/${bid}/players/${pid}/delta`, { delta });
  render();
}

async function resetSingleBoard(b) {
  if (!confirm(`¿Poner en 0 los puntos de “${b.title}”?`)) return;
  // Optimistic update
  for (const p of b.players) p.score = 0;
  render();
  await mutate(`/api/boards/${b.id}/reset`, {});
  render();
}

async function resetAllBoards() {
  if (!state.boards.length) return;
  if (!confirm("¿Poner en 0 TODOS los marcadores activos?")) return;
  // Optimistic update
  for (const b of state.boards) {
    for (const p of b.players) p.score = 0;
  }
  render();
  await mutate("/api/reset-all", {});
  render();
}

async function renameBoard(b) {
  const title = prompt("Título del marcador:", b.title);
  if (title === null || !title.trim()) return;
  b.title = title.trim();
  render();
  await mutate(`/api/boards/${b.id}/title`, { title: title.trim() });
  render();
}

async function renamePlayer(bid, pid, currentName) {
  const name = prompt("Nuevo nombre:", currentName);
  if (name === null || !name.trim()) return;
  const b = state.boards.find(x => x.id === bid);
  if (b) {
    const p = b.players.find(x => x.id === pid);
    if (p) p.name = name.trim();
  }
  render();
  await mutate(`/api/boards/${bid}/players/${pid}/rename`, { name: name.trim() });
  render();
}

async function addNewPlayerPrompt(bid) {
  const name = prompt("Nombre del nuevo participante:");
  if (name === null || !name.trim()) return;
  await mutate(`/api/boards/${bid}/players`, { name: name.trim() });
  render();
}

async function deleteBoard(bid, title) {
  if (!confirm(`¿Eliminar definitivamente el marcador “${title}”?`)) return;
  state.boards = state.boards.filter(b => b.id !== bid);
  delete editOpenMap[bid];
  render();
  await mutate(`/api/boards/${bid}/delete`, {});
  render();
}

// --- Modal for New Board ---
function openNewBoardModal() {
  if (state.boards.length >= MAX_BOARDS) {
    alert(`Se ha alcanzado el límite máximo de ${MAX_BOARDS} marcadores en pantalla.`);
    return;
  }
  $("inputPlayerName").value = "";
  $("inputOpponentName").value = "Sistema";
  $("newBoardModal").classList.add("open");
  setTimeout(() => $("inputPlayerName").focus(), 100);
}

function closeNewBoardModal() {
  $("newBoardModal").classList.remove("open");
}

async function handleCreateBoard(e) {
  e.preventDefault();
  const player = $("inputPlayerName").value.trim();
  const opponent = $("inputOpponentName").value.trim() || "Sistema";

  if (!player) return;

  const names = [player, opponent];
  const title = `${player} vs ${opponent}`;

  closeNewBoardModal();
  await mutate("/api/boards", { names, title });
  render();
}

// Close modal on click outside panel
$("newBoardModal").addEventListener("click", e => {
  if (e.target === $("newBoardModal")) closeNewBoardModal();
});
window.addEventListener("keydown", e => {
  if (e.key === "Escape" && $("newBoardModal").classList.contains("open")) {
    closeNewBoardModal();
  }
});

// --- Polling (Keep all devices in sync) ---
async function poll() {
  if (pending === 0) {
    try {
      const s = await api("/api/state");
      if (pending === 0 && JSON.stringify(s) !== JSON.stringify(state)) {
        state = s;
        render();
      }
      setLive(true);
    } catch {
      setLive(false);
    }
  }
  setTimeout(poll, 2000);
}

// Initial boot
updateSoundUI();
poll();

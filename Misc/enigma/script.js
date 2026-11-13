"use strict";

/* ------------------------------------------------------------------ *
 * Enigma Machine — page wiring.
 * The machine itself lives in enigma.js. This file holds the settings,
 * turns the rotor drums, lights lamps on real key presses, keeps the
 * paper tape and draws the current's path through the machine.
 * ------------------------------------------------------------------ */

const E = Enigma;
const A = E.ALPHA;
const $ = (id) => document.getElementById(id);
const ROWS = ["QWERTZUIO", "ASDFGHJK", "PYXCVBNML"];   // German keyboard order

const PRESETS = {
  basic: {
    model: "I", rotors: ["I", "II", "III"], rings: "AAA", reflector: "B", plugs: "", pos: "AAA",
    note: "Press A five times. The lamps should light B D Z G O: the same key gives a different letter every time.",
  },
  barbarossa: {
    model: "I", rotors: ["II", "IV", "V"], rings: "BUL", reflector: "B",
    plugs: "AV BS CG DL FU HZ IN KM OW RX", pos: "BLA",
    text: "EDPUD NRGYS ZRCXN UYTPO MRMBO FKTBZ REZKM LXLVE FGUEY SIOZV",
    note: "The start of a German army message sent on 7 July 1941. The ciphertext is in “Type a long message for me”; type it in to read the German (X marks a space).",
  },
  m4: {
    model: "M4", rotors: ["I", "II", "III"], rings: "AAA", reflector: "B thin", fourth: "Beta", fourthRing: 0, fourthPos: 0,
    plugs: "", pos: "AAA",
    note: "With Beta at A and the thin reflector B, the M4 lights exactly the same lamps as an Enigma I with reflector B. U-boats could still read messages from shore stations using three-rotor machines.",
  },
};

const state = {
  model: "I",
  rotors: ["I", "II", "III"],
  rings: [0, 0, 0],
  reflector: "B",
  fourth: "Beta",
  fourthRing: 0,
  pos: [0, 0, 0],
  fourthPos: 0,
  plugPairs: [],
  picking: null,      // plugboard letter waiting for its partner
  start: null,        // rotor positions when the message on the tape began
  tapeIn: "",
  tapeOut: "",
  history: [],        // positions before each key press, for undo
  lastPath: null,
  heldKey: -1,
  lit: -1,
};

const shown = { pos: [null, null, null], fourth: null };   // what each drum currently shows

function cfg() {
  const m4 = state.model === "M4";
  return {
    rotors: state.rotors,
    rings: state.rings,
    reflector: state.reflector,
    fourth: m4 ? state.fourth : null,
    fourthRing: state.fourthRing,
    plugs: E.plugsFromPairs(state.plugPairs),
  };
}

const letters = (arr) => arr.map((n) => A[n]).join("");
const ringLabel = (n) => `${A[n]} ${String(n + 1).padStart(2, "0")}`;

/* ================================================================== *
 * Settings panel
 * ================================================================== */

function buildSettings() {
  const model = E.MODELS[state.model];
  document.querySelectorAll("#model-seg button").forEach((b) => b.classList.toggle("on", b.dataset.model === state.model));
  $("model-note").textContent = model.note;

  const ringOpts = (sel) => [...A].map((c, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${ringLabel(i)}</option>`).join("");
  const rotorOpts = (list, sel) => list.map((r) => `<option value="${r}" ${r === sel ? "selected" : ""}>${r}</option>`).join("");

  let html = `<thead><tr><th></th><th>Rotor</th><th>Ring</th></tr></thead><tbody>`;
  if (model.fourth) {
    html += `<tr><th>Thin</th><td><select class="select-input" data-fourth="rotor">${rotorOpts(model.fourth, state.fourth)}</select></td>
      <td><select class="select-input" data-fourth="ring">${ringOpts(state.fourthRing)}</select></td></tr>`;
  }
  ["Left", "Middle", "Right"].forEach((name, i) => {
    html += `<tr><th>${name}</th><td><select class="select-input" data-slot="${i}" data-kind="rotor">${rotorOpts(model.rotors, state.rotors[i])}</select></td>
      <td><select class="select-input" data-slot="${i}" data-kind="ring">${ringOpts(state.rings[i])}</select></td></tr>`;
  });
  $("rotor-table").innerHTML = html + "</tbody>";

  $("reflector").innerHTML = model.reflectors.map((r) => `<option value="${r}" ${r === state.reflector ? "selected" : ""}>${r === "A" ? "A (early, rarely used)" : r}</option>`).join("");
}

function setModel(m) {
  const model = E.MODELS[m];
  state.model = m;
  state.rotors = model.defaults.rotors.slice();
  state.reflector = model.defaults.reflector;
  if (model.fourth) { state.fourth = model.defaults.fourth; }
  state.rings = [0, 0, 0];
  state.fourthRing = 0;
  state.pos = [0, 0, 0];
  state.fourthPos = 0;
  clearTape();
  settingsChanged(true);
}

/* Anything that changes the wiring: the old path no longer applies. */
function settingsChanged(rebuildBay) {
  state.lastPath = null;
  buildSettings();
  if (rebuildBay) buildBay();
  updateDrums([]);
  renderPlugboard();
  renderTape();
  drawPath();
}

function loadPreset(key) {
  const p = PRESETS[key];
  if (!p) return;
  const model = E.MODELS[p.model];
  state.model = p.model;
  state.rotors = p.rotors.slice();
  state.rings = [...p.rings].map(E.idx);
  state.reflector = p.reflector;
  if (model.fourth) { state.fourth = p.fourth; state.fourthRing = p.fourthRing || 0; state.fourthPos = p.fourthPos || 0; }
  state.pos = [...p.pos].map(E.idx);
  state.plugPairs = E.parsePlugs(p.plugs).pairs;
  $("plugs").value = state.plugPairs.join(" ");
  $("plug-status").textContent = plugStatus();
  $("plug-status").classList.remove("bad");
  $("auto-text").value = p.text || "";
  if (p.text) $("auto-text").closest("details").open = true;
  $("preset-note").textContent = p.note;
  clearTape();
  settingsChanged(true);
}

/* ================================================================== *
 * Rotor bay
 * ================================================================== */

function slotsLeftToRight() {
  const s = [];
  if (state.model === "M4") s.push("f");
  s.push(0, 1, 2);
  return s;
}
const posOf = (slot) => (slot === "f" ? state.fourthPos : state.pos[slot]);
const nameOf = (slot) => (slot === "f" ? state.fourth : state.rotors[slot]);

function buildBay() {
  $("refl-tag").textContent = `UKW ${state.reflector}`;
  $("rotors").innerHTML = slotsLeftToRight().map((slot) => {
    const thin = slot === "f";
    return `<div class="rotor ${thin ? "thin" : ""}" data-slot="${slot}">
      <button type="button" class="rot-btn" data-turn="-1" title="Turn back">&#9650;</button>
      <div class="window"><div class="drum"></div></div>
      <button type="button" class="rot-btn" data-turn="1" title="Turn forward">&#9660;</button>
      <div class="rot-name">${nameOf(slot)}</div>
      <div class="rot-notch"></div>
    </div>`;
  }).join("");
  shown.pos = [null, null, null];
  shown.fourth = null;
}

function drumHTML(p) {
  let h = "";
  for (let d = -2; d <= 2; d++) h += `<span class="${d === 0 ? "" : "side"}">${A[E.mod(p + d, 26)]}</span>`;
  return h;
}

/* Redraw each drum. A move of one place rolls the drum; anything bigger
 * jumps. Slots in `knocked` flash to show they were turned by the key. */
function updateDrums(knocked) {
  const cellPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cell")) || 34;
  document.querySelectorAll("#rotors .rotor").forEach((el) => {
    const slot = el.dataset.slot === "f" ? "f" : +el.dataset.slot;
    const p = posOf(slot);
    const prev = slot === "f" ? shown.fourth : shown.pos[slot];
    const drum = el.querySelector(".drum");
    if (prev !== p) {
      const diff = prev === null ? 0 : E.mod(p - prev, 26);
      const dir = diff === 1 ? 1 : diff === 25 ? -1 : 0;
      drum.innerHTML = drumHTML(p);
      if (dir) {
        drum.style.transition = "none";
        drum.style.transform = `translateY(${dir * cellPx}px)`;
        void drum.offsetHeight;
        drum.style.transition = "transform 0.16s ease-out";
        drum.style.transform = "translateY(0)";
      } else {
        drum.style.transition = "none";
        drum.style.transform = "translateY(0)";
      }
      if (slot === "f") shown.fourth = p; else shown.pos[slot] = p;
    }
    if (knocked.includes(slot)) {
      el.classList.remove("stepped");
      void el.offsetWidth;
      el.classList.add("stepped");
    }
    // Notch: when the window shows this letter, the next press carries the rotor to the left.
    const notch = slot === "f" ? "" : E.ROTORS[nameOf(slot)].notch;
    const nEl = el.querySelector(".rot-notch");
    if (slot === "f") nEl.textContent = "never turns";
    else if (slot === 0) nEl.textContent = `notch ${notch.split("").join(", ")} (unused)`;
    else nEl.textContent = `carries at ${notch.split("").join(", ")}`;
    nEl.classList.toggle("at", slot !== "f" && slot !== 0 && notch.includes(A[p]));
  });
}

function turnRotor(slot, by) {
  if (slot === "f") state.fourthPos = E.mod(state.fourthPos + by, 26);
  else state.pos[slot] = E.mod(state.pos[slot] + by, 26);
  state.lastPath = null;
  updateDrums([]);
  renderTape();
  drawPath();
}

/* ================================================================== *
 * Lamps, keys, plugboard
 * ================================================================== */

function buildBoards() {
  $("lampboard").innerHTML = ROWS.map((r) => `<div class="row">${[...r].map((c) => `<div class="lamp" data-l="${c}">${c}</div>`).join("")}</div>`).join("");
  $("keyboard").innerHTML = ROWS.map((r) => `<div class="row">${[...r].map((c) => `<button type="button" class="key" data-k="${c}" tabindex="-1">${c}</button>`).join("")}</div>`).join("");
  $("plugboard").innerHTML = ROWS.map((r) => `<div class="row">${[...r].map((c) => `<button type="button" class="socket" data-p="${c}" tabindex="-1"><span>${c}</span><span class="holes"></span><span class="mate"></span></button>`).join("")}</div>`).join("");
}

function renderLamps() {
  document.querySelectorAll("#lampboard .lamp").forEach((el) => el.classList.toggle("on", state.lit >= 0 && el.dataset.l === A[state.lit]));
  document.querySelectorAll("#keyboard .key").forEach((el) => el.classList.toggle("down", state.heldKey >= 0 && el.dataset.k === A[state.heldKey]));
}

function plugColor(i) {
  return `hsl(${Math.round((i * 360) / 13 + 20)}, 78%, 58%)`;
}

function renderPlugboard() {
  const mate = {};
  const colorOf = {};
  state.plugPairs.forEach((p, i) => {
    mate[p[0]] = p[1]; mate[p[1]] = p[0];
    colorOf[p[0]] = colorOf[p[1]] = plugColor(i);
  });
  const path = state.lastPath;
  const active = path ? new Set([A[path.key], A[path.plugIn], A[path.rBack], A[path.lamp]]) : new Set();
  document.querySelectorAll("#plugboard .socket").forEach((el) => {
    const c = el.dataset.p;
    el.classList.toggle("plugged", !!mate[c]);
    el.classList.toggle("picking", state.picking === c);
    el.classList.toggle("active", active.has(c));
    el.style.setProperty("--pc", colorOf[c] || "transparent");
    el.querySelector(".mate").textContent = mate[c] ? `↔${mate[c]}` : "";
    el.title = mate[c] ? `${c} is joined to ${mate[c]}. Click to unplug.` : `Click to plug ${c} into another letter`;
  });
}

function plugStatus() {
  const n = state.plugPairs.length;
  if (!n) return "No cables: every letter goes straight through. Click two sockets on the plugboard to join them.";
  return `${n} cable${n === 1 ? "" : "s"}${n === 10 ? " (the usual number from 1939)" : ""}. Click a plugged socket to remove its cable.`;
}

function setPairs(pairs) {
  state.plugPairs = pairs;
  $("plugs").value = pairs.join(" ");
  $("plug-status").textContent = plugStatus();
  $("plug-status").classList.remove("bad");
  state.lastPath = null;
  renderPlugboard();
  drawPath();
}

function clickSocket(c) {
  const existing = state.plugPairs.find((p) => p.includes(c));
  if (state.picking === null) {
    if (existing) setPairs(state.plugPairs.filter((p) => p !== existing));
    else { state.picking = c; renderPlugboard(); }
    return;
  }
  const first = state.picking;
  state.picking = null;
  if (first === c) { renderPlugboard(); return; }
  const pairs = state.plugPairs.filter((p) => !p.includes(c) && !p.includes(first));
  pairs.push(first + c);
  setPairs(pairs);
}

/* ================================================================== *
 * Key presses and the tape
 * ================================================================== */

function pressKey(k) {
  if (state.heldKey >= 0) releaseKey();
  state.picking = null;
  const before = { pos: state.pos.slice(), fourthPos: state.fourthPos };
  if (!state.tapeIn) state.start = before;
  state.history.push(before);
  const r = E.press(cfg(), state.pos, state.fourthPos, k);
  const knocked = [0, 1, 2].filter((i) => r.pos[i] !== state.pos[i]);
  state.pos = r.pos;
  state.tapeIn += A[k];
  state.tapeOut += A[r.lamp];
  state.lastPath = r.path;
  state.heldKey = k;
  state.lit = r.lamp;
  updateDrums(knocked);
  renderLamps();
  renderPlugboard();
  renderTape();
  drawPath();
}

function releaseKey() {
  if (state.heldKey < 0 && state.lit < 0) return;
  state.heldKey = -1;
  state.lit = -1;
  renderLamps();
}

function undo() {
  const prev = state.history.pop();
  if (!prev) return;
  releaseKey();
  state.pos = prev.pos;
  state.fourthPos = prev.fourthPos;
  state.tapeIn = state.tapeIn.slice(0, -1);
  state.tapeOut = state.tapeOut.slice(0, -1);
  if (!state.tapeIn) state.start = null;
  state.lastPath = null;
  updateDrums([]);
  renderPlugboard();
  renderTape();
  drawPath();
}

function clearTape() {
  state.tapeIn = "";
  state.tapeOut = "";
  state.history = [];
  state.start = null;
  state.lastPath = null;
}

function backToStart() {
  if (!state.start) return;
  releaseKey();
  state.pos = state.start.pos.slice();
  state.fourthPos = state.start.fourthPos;
  clearTape();
  updateDrums([]);
  renderPlugboard();
  renderTape();
  drawPath();
}

const groups = (s) => (s.match(/.{1,5}/g) || []).join(" ");

function tapeHTML(s, markLast) {
  if (!s) return `<span class="empty">nothing yet</span>`;
  const g = groups(s);
  if (!markLast) return g;
  return `${g.slice(0, -1)}<span class="last">${g.slice(-1)}</span>`;
}

function renderTape() {
  $("tape-in").innerHTML = tapeHTML(state.tapeIn, false);
  $("tape-out").innerHTML = tapeHTML(state.tapeOut, state.lit >= 0 || !!state.lastPath);
  $("btn-undo").disabled = !state.history.length;
  $("btn-start").disabled = !state.start;
  $("btn-clear").disabled = !state.tapeIn;
  const startTxt = state.start ? letters(state.start.pos) : null;
  const fourth = state.model === "M4" ? A[state.start ? state.start.fourthPos : state.fourthPos] : "";
  $("tape-note").textContent = state.start
    ? `${state.tapeIn.length} letter${state.tapeIn.length === 1 ? "" : "s"}, started with the rotors at ${fourth}${startTxt}. To decode, go back to the start and type the lamp letters.`
    : `Rotors at ${state.model === "M4" ? A[state.fourthPos] : ""}${letters(state.pos)}. Start typing to begin a message.`;
  renderChallengeStatus();
}

/* ================================================================== *
 * The path through the machine
 * ================================================================== */

function drawPath() {
  const svg = $("path-svg");
  const m4 = state.model === "M4";
  const c = cfg();
  const path = state.lastPath;
  const rowH = 15, top = 46, bottom = 12;
  const H = top + 26 * rowH + bottom;
  const y = (r) => top + r * rowH + rowH / 2;

  // Columns, left to right as on the machine: reflector, rotors, plugboard, keys.
  const cols = [];
  let x = 10;
  const add = (id, title, sub, w) => { cols.push({ id, title, sub, x0: x, x1: x + w }); x += w + 34; };
  add("refl", "Reflector", state.reflector, 46);
  if (m4) add("f", `Thin ${state.fourth}`, `at ${A[state.fourthPos]}`, 58);
  add(0, `Left ${state.rotors[0]}`, `at ${A[state.pos[0]]}`, 64);
  add(1, `Middle ${state.rotors[1]}`, `at ${A[state.pos[1]]}`, 64);
  add(2, `Right ${state.rotors[2]}`, `at ${A[state.pos[2]]}`, 64);
  add("plug", "Plugboard", `${state.plugPairs.length} cables`, 64);
  add("keys", "Keys", "& lamps", 40);
  const W = x - 34 + 10;
  const col = (id) => cols.find((k) => k.id === id);

  let s = "";
  // window band
  s += `<rect x="${col(m4 ? "f" : 0).x0 - 4}" y="${top}" width="${col(2).x1 - col(m4 ? "f" : 0).x0 + 8}" height="${rowH}" fill="rgba(21,48,77,0.10)" rx="3"/>`;

  for (const k of cols) {
    s += `<rect x="${k.x0}" y="${top - 4}" width="${k.x1 - k.x0}" height="${26 * rowH + 8}" rx="8" fill="rgba(255,255,255,0.75)" stroke="rgba(21,48,77,0.18)"/>`;
    s += `<text x="${(k.x0 + k.x1) / 2}" y="16" text-anchor="middle" font-size="12" font-weight="700" fill="#15304d">${k.title}</text>`;
    s += `<text x="${(k.x0 + k.x1) / 2}" y="30" text-anchor="middle" font-size="10.5" fill="#55708d">${k.sub}</text>`;
  }

  // faint wiring
  const faint = 'stroke="rgba(21,48,77,0.13)" stroke-width="1" fill="none"';
  const rotorCols = [[0, c.rotors[0], c.rings[0], state.pos[0]], [1, c.rotors[1], c.rings[1], state.pos[1]], [2, c.rotors[2], c.rings[2], state.pos[2]]];
  if (m4) rotorCols.push(["f", state.fourth, state.fourthRing, state.fourthPos]);
  for (const [id, name, ring, pos] of rotorCols) {
    const k = col(id);
    for (let i = 0; i < 26; i++) {
      const o = E.through(name, ring, pos, i, false);
      s += `<line x1="${k.x1}" y1="${y(i)}" x2="${k.x0}" y2="${y(o)}" ${faint}/>`;
    }
  }
  const refl = E.REFLECTORS[state.reflector];
  const rk = col("refl");
  for (let i = 0; i < 26; i++) {
    const o = E.idx(refl[i]);
    if (o < i) continue;
    const depth = 6 + (Math.abs(o - i) / 25) * (rk.x1 - rk.x0 - 12);
    s += `<path d="M${rk.x1} ${y(i)} C${rk.x1 - depth} ${y(i)} ${rk.x1 - depth} ${y(o)} ${rk.x1} ${y(o)}" ${faint}/>`;
  }
  const pk = col("plug");
  for (let i = 0; i < 26; i++) {
    s += `<line x1="${pk.x1}" y1="${y(i)}" x2="${pk.x0}" y2="${y(c.plugs[i])}" ${faint}/>`;
  }

  // contact letters
  for (const k of cols) {
    if (k.id === "refl") continue;
    for (let i = 0; i < 26; i++) {
      let ch = A[i];
      if (k.id === "f") ch = A[(i + state.fourthPos) % 26];
      else if (typeof k.id === "number") ch = A[(i + state.pos[k.id]) % 26];
      const keysCol = k.id === "keys";
      if (keysCol && path && (i === path.key || i === path.lamp)) continue;   // drawn bold below
      s += `<text x="${(k.x0 + k.x1) / 2 + (keysCol ? 6 : 0)}" y="${y(i) + 4}" text-anchor="middle" font-size="10.5" fill="#55708d">${ch}</text>`;
    }
  }

  // the live path
  if (path) {
    const r2 = col(2), r1 = col(1), r0 = col(0), f = m4 ? col("f") : null, kk = col("keys");
    const mid = rk.x0 + 10;
    const leftIn = m4 ? path.f : path.l;
    const fwd = [
      [(kk.x0 + kk.x1) / 2 - 12, y(path.key)], [kk.x0, y(path.key)], [pk.x1, y(path.key)], [pk.x0, y(path.plugIn)],
      [r2.x1, y(path.plugIn)], [r2.x0, y(path.r)],
      [r1.x1, y(path.r)], [r1.x0, y(path.m)],
      [r0.x1, y(path.m)], [r0.x0, y(path.l)],
    ];
    if (f) fwd.push([f.x1, y(path.l)], [f.x0, y(path.f)]);
    fwd.push([rk.x1, y(leftIn)], [mid, y(leftIn)]);
    const leftOut = m4 ? path.fBack : path.refl;
    const back = [[mid, y(leftIn)], [mid, y(path.refl)], [rk.x1, y(path.refl)]];
    if (f) back.push([f.x0, y(path.refl)], [f.x1, y(path.fBack)]);
    back.push(
      [r0.x0, y(leftOut)], [r0.x1, y(path.lBack)],
      [r1.x0, y(path.lBack)], [r1.x1, y(path.mBack)],
      [r2.x0, y(path.mBack)], [r2.x1, y(path.rBack)],
      [pk.x0, y(path.rBack)], [pk.x1, y(path.lamp)], [kk.x0, y(path.lamp)], [(kk.x0 + kk.x1) / 2 - 12, y(path.lamp)],
    );
    const pts = (a) => a.map(([px, py]) => `${px},${py}`).join(" ");
    s += `<polyline points="${pts(fwd)}" fill="none" stroke="#e07a1f" stroke-width="2.6" stroke-linejoin="round"/>`;
    s += `<polyline points="${pts(back)}" fill="none" stroke="#0d9488" stroke-width="2.6" stroke-linejoin="round"/>`;
    // key and lamp markers
    s += `<circle cx="${(kk.x0 + kk.x1) / 2 - 12}" cy="${y(path.key)}" r="4" fill="#e07a1f"/>`;
    s += `<circle cx="${(kk.x0 + kk.x1) / 2 - 12}" cy="${y(path.lamp)}" r="5" fill="#ffd84d" stroke="#8a6a00"/>`;
    // emphasise the letters on the path in the keys column
    for (const [r, colr] of [[path.key, "#e07a1f"], [path.lamp, "#0d9488"]]) {
      s += `<text x="${(kk.x0 + kk.x1) / 2 + 6}" y="${y(r) + 4}" text-anchor="middle" font-size="11.5" font-weight="700" fill="${colr}">${A[r]}</text>`;
    }

    const step = (label, from, to) => `${label} ${A[from]}&rarr;${A[to]}`;
    const parts = [
      step("plug", path.key, path.plugIn),
      step(state.rotors[2], path.plugIn, path.r),
      step(state.rotors[1], path.r, path.m),
      step(state.rotors[0], path.m, path.l),
    ];
    if (m4) parts.push(step(state.fourth, path.l, path.f));
    parts.push(step("reflector", leftIn, path.refl));
    $("path-sub").innerHTML = `Key <strong>${A[path.key]}</strong> lit lamp <strong>${A[path.lamp]}</strong> &nbsp;&middot;&nbsp; ${parts.join(", ")}, then back the other way.`;
  } else {
    $("path-sub").textContent = "Press a key to see the current flow";
  }

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = s;
}

/* ================================================================== *
 * Decode-a-message challenges
 * ================================================================== */

const challenge = { key: "training", cipher: "" };

function renderChallenge() {
  const ch = CHALLENGES[challenge.key];
  challenge.cipher = challengeCipher(ch);
  const two = (n) => String(n).padStart(2, "0");
  const rotors = (ch.fourth ? [ch.fourth] : []).concat(ch.rotors).join(" ");
  const rings = (ch.fourth ? [ch.fourthRing] : []).concat(ch.rings).map(two).join(" ");
  const row = (de, en, val) => `<tr><th>${de}<span class="en">${en}</span></th><td>${val}</td></tr>`;
  $("ch-sheet").innerHTML = `<div class="ks-title">Geheim! Key sheet</div><table>
    ${row("Maschine", "machine", E.MODELS[ch.model].name)}
    ${row("Walzenlage", "rotors, left to right", rotors)}
    ${row("Ringstellung", "ring settings", rings)}
    ${row("Umkehrwalze", "reflector", ch.reflector.toUpperCase())}
    ${row("Stecker", "plugboard", ch.plugs || "none")}
    ${row("Grundstellung", "start position", ch.start)}
  </table>`;
  $("ch-intro").textContent = ch.intro;
  $("ch-cipher").textContent = groups(challenge.cipher);
  $("ch-plain").textContent = groups(ch.plain) + "  (X = space)";
  renderChallengeStatus();
}

/* Watch the tape: are the lamps spelling the message yet? */
function renderChallengeStatus() {
  const el = $("ch-status");
  const ch = CHALLENGES[challenge.key];
  if (!el || !ch) return;
  const out = state.tapeOut, inp = state.tapeIn;
  el.className = "ch-status";
  if (!inp) {
    el.textContent = "Set the machine from the key sheet, turn the rotors to the start position, then type the ciphertext (or use the auto-typer).";
    return;
  }
  if (ch.plain.startsWith(out) && out.length >= 4) {
    if (out.length === ch.plain.length) {
      el.className = "ch-status done";
      el.textContent = "Message decoded. Every setting on the sheet is right. Read the lamp tape, with X as a space.";
    } else {
      el.className = "ch-status good";
      el.textContent = `So far so good: ${out.length} of ${ch.plain.length} letters read. Keep typing.`;
    }
    return;
  }
  if (challenge.cipher.startsWith(inp)) {
    if (out.length < 4) { el.textContent = "Keep typing the ciphertext."; return; }
    el.className = "ch-status bad";
    el.textContent = "The lamps are not spelling a message. Check every line of the key sheet against the machine, press “Back to start” and type it again.";
    return;
  }
  el.textContent = "The keys typed so far are not the start of this ciphertext. Press “Clear” (or “Back to start”) before typing it.";
}

/* ================================================================== *
 * Auto-typing
 * ================================================================== */

const auto = { timer: 0, queue: [], running: false };

function autoStop() {
  clearTimeout(auto.timer);
  auto.running = false;
  auto.queue = [];
  releaseKey();
  $("auto-go").disabled = false;
  $("auto-stop").disabled = true;
}

function autoGo() {
  const q = [...$("auto-text").value.toUpperCase()].map(E.idx).filter((k) => k >= 0);
  if (!q.length) return;
  auto.queue = q;
  auto.running = true;
  $("auto-go").disabled = true;
  $("auto-stop").disabled = false;
  const tick = () => {
    if (!auto.running) return;
    const k = auto.queue.shift();
    if (k === undefined) { autoStop(); return; }
    const ms = 1000 / +$("auto-speed").value;
    pressKey(k);
    auto.timer = setTimeout(() => {
      releaseKey();
      auto.timer = setTimeout(tick, ms * 0.4);
    }, ms * 0.6);
  };
  tick();
}

/* ================================================================== *
 * Events
 * ================================================================== */

const isTextField = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");

function updateFocusHint() {
  const h = $("focus-hint");
  if (isTextField(document.activeElement)) {
    h.textContent = "You are typing in a settings box. Click the machine to type on its keys.";
    h.classList.add("warn");
  } else {
    h.textContent = "Type on your keyboard to press the keys. Backspace undoes the last letter.";
    h.classList.remove("warn");
  }
}

function wire() {
  buildBoards();

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTextField(e.target)) return;
    if (auto.running) return;
    if (e.key === "Backspace") { e.preventDefault(); undo(); return; }
    if (e.key === "Escape") { state.picking = null; renderPlugboard(); return; }
    const k = e.key && e.key.length === 1 ? E.idx(e.key.toUpperCase()) : -1;
    if (k < 0) return;
    e.preventDefault();
    if (e.repeat) return;
    if (document.activeElement && document.activeElement.tagName === "SELECT") document.activeElement.blur();
    pressKey(k);
  });
  document.addEventListener("keyup", (e) => {
    if (auto.running) return;
    const k = e.key && e.key.length === 1 ? E.idx(e.key.toUpperCase()) : -1;
    if (k >= 0 && k === state.heldKey) releaseKey();
  });
  window.addEventListener("blur", () => { if (!auto.running) releaseKey(); });
  document.addEventListener("focusin", updateFocusHint);
  document.addEventListener("focusout", () => setTimeout(updateFocusHint, 0));

  // on-screen keys
  const kb = $("keyboard");
  kb.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".key");
    if (!b || auto.running) return;
    e.preventDefault();
    $("machine").focus();
    pressKey(E.idx(b.dataset.k));
  });
  const up = () => { if (!auto.running) releaseKey(); };
  kb.addEventListener("pointerup", up);
  kb.addEventListener("pointerleave", up);

  $("machine").addEventListener("pointerdown", (e) => {
    if (!e.target.closest("button")) $("machine").focus();
  });

  // rotors
  $("rotors").addEventListener("click", (e) => {
    const b = e.target.closest(".rot-btn");
    if (!b) return;
    const el = b.closest(".rotor");
    turnRotor(el.dataset.slot === "f" ? "f" : +el.dataset.slot, +b.dataset.turn);
  });
  $("rotors").addEventListener("wheel", (e) => {
    const el = e.target.closest(".rotor");
    if (!el) return;
    e.preventDefault();
    turnRotor(el.dataset.slot === "f" ? "f" : +el.dataset.slot, e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  // plugboard
  $("plugboard").addEventListener("click", (e) => {
    const b = e.target.closest(".socket");
    if (b) clickSocket(b.dataset.p);
  });
  $("plugs").addEventListener("input", (e) => {
    const r = E.parsePlugs(e.target.value);
    state.plugPairs = r.pairs;
    state.picking = null;
    state.lastPath = null;
    $("plug-status").textContent = r.errors.length ? r.errors.join("; ") : plugStatus();
    $("plug-status").classList.toggle("bad", r.errors.length > 0);
    renderPlugboard();
    drawPath();
  });
  $("plugs").addEventListener("change", (e) => { e.target.value = state.plugPairs.join(" "); });
  $("plugs-clear").addEventListener("click", () => setPairs([]));

  // settings
  $("model-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-model]");
    if (b && b.dataset.model !== state.model) { autoStop(); setModel(b.dataset.model); }
  });
  $("rotor-table").addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.fourth === "rotor") { state.fourth = t.value; settingsChanged(true); }
    else if (t.dataset.fourth === "ring") { state.fourthRing = +t.value; settingsChanged(false); }
    else if (t.dataset.kind === "rotor") {
      const i = +t.dataset.slot;
      const other = state.rotors.indexOf(t.value);
      if (other >= 0 && other !== i) state.rotors[other] = state.rotors[i];
      state.rotors[i] = t.value;
      settingsChanged(true);
    } else if (t.dataset.kind === "ring") {
      state.rings[+t.dataset.slot] = +t.value;
      settingsChanged(false);
    }
    t.blur();
  });
  $("reflector").addEventListener("change", (e) => {
    state.reflector = e.target.value;
    $("refl-tag").textContent = `UKW ${state.reflector}`;
    settingsChanged(false);
    e.target.blur();
  });
  $("preset").addEventListener("change", (e) => {
    autoStop();
    loadPreset(e.target.value);
    e.target.blur();
  });

  // tape
  $("btn-undo").addEventListener("click", undo);
  $("btn-start").addEventListener("click", backToStart);
  $("btn-clear").addEventListener("click", () => { clearTape(); renderPlugboard(); renderTape(); drawPath(); });
  document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => {
    const text = groups(b.dataset.copy === "in" ? state.tapeIn : state.tapeOut);
    if (!text) return;
    const done = () => { b.textContent = "Copied"; b.classList.add("done"); setTimeout(() => { b.textContent = "Copy"; b.classList.remove("done"); }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
  }));

  // challenges
  $("challenge").addEventListener("change", (e) => { challenge.key = e.target.value; renderChallenge(); e.target.blur(); });
  $("ch-load").addEventListener("click", () => {
    $("auto-text").value = groups(challenge.cipher);
    const d = $("auto-text").closest("details");
    d.open = true;
    d.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  $("ch-copy").addEventListener("click", () => {
    const b = $("ch-copy");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(groups(challenge.cipher)).then(() => {
        b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy"; }, 1200);
      }, () => {});
    }
  });

  // auto-type
  const speedLbl = () => { $("auto-speed-val").textContent = `${$("auto-speed").value} / s`; };
  $("auto-speed").addEventListener("input", speedLbl);
  speedLbl();
  $("auto-go").addEventListener("click", autoGo);
  $("auto-stop").addEventListener("click", autoStop);

  buildSettings();
  buildBay();
  updateDrums([]);
  renderLamps();
  $("plug-status").textContent = plugStatus();
  renderPlugboard();
  renderChallenge();
  renderTape();
  drawPath();
  updateFocusHint();
}

wire();

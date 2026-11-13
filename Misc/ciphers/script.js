"use strict";

/* ------------------------------------------------------------------ *
 * Classroom Ciphers — page wiring.
 * The cipher maths lives in ciphers.js; this file reads the controls,
 * runs the chosen cipher on the one message box, and draws the
 * pen-and-paper working underneath.
 * ------------------------------------------------------------------ */

const C = Ciphers;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const EXAMPLES = {
  caesar: "Meet me by the old oak tree at noon.",
  keyword: "Knowledge is power",
  vigenere: "Attack at dawn!",
  playfair: "Hide the gold in the tree stump",
  polybius: "Help is coming",
  scytale: "I am hurt very badly help",
  morse: "Help is on the way",
  pigpen: "X marks the spot",
};

const FORMATS = {
  caesar: [["keep", "As typed"], ["letters", "Capitals, no spaces"], ["blocks5", "Capitals in blocks of five"]],
  keyword: [["keep", "As typed"], ["letters", "Capitals, no spaces"], ["blocks5", "Capitals in blocks of five"]],
  vigenere: [["keep", "As typed"], ["letters", "Capitals, no spaces"], ["blocks5", "Capitals in blocks of five"]],
  playfair: [["pairs", "Pairs"], ["blocks5", "Blocks of five"], ["letters", "One run of capitals"]],
  polybius: [["pairs", "Number pairs"], ["run", "One run of digits"], ["taps", "Taps (dots)"]],
  scytale: [["turns", "One group per turn"], ["blocks5", "Blocks of five"], ["letters", "One run of capitals"]],
};
const FORMAT_NOTES = {
  keep: "Spaces and punctuation stay put, which gives away word lengths.",
  letters: "Dropping spaces hides where words start and end.",
  blocks5: "Blocks of five hide word lengths and are easy to read aloud or copy.",
  pairs: "Shows the pairs exactly as they came out of the square.",
  run: "Without spaces the reader still splits the digits into pairs, but cannot see where words end.",
  taps: "How the tap code is knocked out: row taps, a pause, column taps. Pick the C and K square to match the real tap code.",
  turns: "Each group is one turn of the strip round the rod, which makes decoding by hand easy but gives the key away.",
};

const state = {
  cipher: "caesar",
  mode: "encode",
  input: EXAMPLES.caesar,
  shift: 3,
  kwKey: "KRYPTOS",
  kwFromEnd: false,
  vigKey: "LEMON",
  pfKey: "PLAYFAIR EXAMPLE",
  pfFiller: "X",
  pfTidy: false,
  pbVariant: "ij",
  pbKey: "",
  scyFaces: 4,
  scyPad: false,
  wpm: 12,
  lamp: true,
  pigSize: 44,
  pigLabels: false,
  format: { caesar: "keep", keyword: "keep", vigenere: "keep", playfair: "pairs", polybius: "pairs", scytale: "turns" },
  sel: { vigenere: 0, playfair: 0, polybius: 0 },
};

let last = null;   // most recent compute() result

/* ================================================================== *
 * Running the cipher
 * ================================================================== */

function compute() {
  const dec = state.mode === "decode";
  const input = state.input;
  const notes = [];

  switch (state.cipher) {
    case "caesar": {
      const t = C.caesar(input, state.shift, dec);
      return { text: dec ? t : C.formatOutput(t, state.format.caesar), notes };
    }
    case "keyword": {
      const r = C.keywordCipher(input, state.kwKey, dec, { fromKeyEnd: state.kwFromEnd });
      return { text: dec ? r.text : C.formatOutput(r.text, state.format.keyword), notes, kw: r };
    }
    case "vigenere": {
      const r = C.vigenere(input, state.vigKey, dec);
      if (r.noKey) notes.push("Type a keyword (letters only) to use this cipher.");
      return { text: dec ? r.text : C.formatOutput(r.text, state.format.vigenere), notes, steps: r.steps, noKey: r.noKey };
    }
    case "playfair": {
      const r = C.playfair(input, state.pfKey, dec, {
        filler: state.pfFiller, tidy: state.pfTidy, format: state.format.playfair,
      });
      const digits = [...new Set(input.replace(/[^0-9]/g, ""))];
      if (!dec && digits.length) {
        notes.push(`Playfair only uses letters, so the numbers were left out. Write them as words (THREE) to keep them.`);
      }
      if (r.oddLength) notes.push(`The ciphertext has an odd number of letters, so it cannot be complete Playfair. The last letter was paired with ${r.filler} so the rest could be read.`);
      if (r.doubles) notes.push("A pair has the same letter twice. Playfair never makes one, so check the ciphertext was copied correctly.");
      return { text: r.text, notes, pf: r };
    }
    case "polybius": {
      const r = C.polybius(input, state.pbKey, dec, { variant: state.pbVariant, format: state.format.polybius });
      if (r.skipped.length) notes.push(`Not in this square, so left out: ${r.skipped.map((c) => `<code>${esc(c)}</code>`).join(" ")}${/[0-9]/.test(r.skipped.join("")) ? ". The 6 &times; 6 square has digits." : ""}`);
      if (r.odd) notes.push("A word has an odd number of digits, so its last digit has no partner and was ignored.");
      if (r.bad.length) notes.push(`Off the edge of the ${r.size} &times; ${r.size} square (shown as #): ${r.bad.map((b) => `<code>${esc(b)}</code>`).join(" ")}`);
      return { text: r.text, notes, pb: r };
    }
    case "scytale": {
      const r = C.scytale(input, state.scyFaces, dec, { pad: state.scyPad });
      let text = r.text;
      if (!dec) {
        const fmt = state.format.scytale;
        if (fmt === "turns") text = r.turns.join(" ");
        else if (fmt === "blocks5") text = C.groupLetters(r.cipher, 5);
      }
      return { text, notes, scy: r };
    }
    case "morse": {
      if (dec) {
        const r = C.morseDecode(input);
        if (r.unknown.length) notes.push(`Not Morse for any letter (shown as #): ${r.unknown.map((g) => `<code>${esc(g)}</code>`).join(" ")}`);
        return { text: r.text, notes, code: input };
      }
      const r = C.morseEncode(input);
      if (r.skipped.length) notes.push(`No Morse code for these, so they were left out: ${r.skipped.map((c) => `<code>${esc(c)}</code>`).join(" ")}`);
      return { text: r.text, notes, code: r.text };
    }
    case "pigpen":
    default:
      return { text: input.toUpperCase(), notes };
  }
}

/* ================================================================== *
 * Pigpen drawing
 * ================================================================== */

/* SVG path for one pigpen glyph in a 100 x 100 box. */
function glyphShape(g) {
  const p = 14, s = 100, m = 50;
  let d = "";
  let dot = null;
  if (g.kind === "grid") {
    if (g.sides.t) d += `M${p} ${p}H${s - p}`;
    if (g.sides.b) d += `M${p} ${s - p}H${s - p}`;
    if (g.sides.l) d += `M${p} ${p}V${s - p}`;
    if (g.sides.r) d += `M${s - p} ${p}V${s - p}`;
    dot = [m, m];
  } else if (g.point === "down") {
    d = `M${p} ${p}L${m} ${s - p}L${s - p} ${p}`; dot = [m, 38];
  } else if (g.point === "up") {
    d = `M${p} ${s - p}L${m} ${p}L${s - p} ${s - p}`; dot = [m, 62];
  } else if (g.point === "right") {
    d = `M${p} ${p}L${s - p} ${m}L${p} ${s - p}`; dot = [38, m];
  } else {
    d = `M${s - p} ${p}L${p} ${m}L${s - p} ${s - p}`; dot = [62, m];
  }
  return { d, dot: g.dot ? dot : null };
}

function glyphInner(g, color) {
  const { d, dot } = glyphShape(g);
  let out = `<path d="${d}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (dot) out += `<circle cx="${dot[0]}" cy="${dot[1]}" r="8" fill="${color}"/>`;
  return out;
}

function glyphSVG(letter, size) {
  const g = C.pigpenGlyph(letter);
  const dim = size ? `width="${size}" height="${size}"` : "";
  return `<svg viewBox="0 0 100 100" ${dim} aria-label="${esc(letter)}">${glyphInner(g, "currentColor")}</svg>`;
}

/* Message as a row of glyphs that wraps between words. */
function glyphStripHTML(text, size, labels, withCaret) {
  const lines = String(text).toUpperCase().split("\n");
  let html = "";
  lines.forEach((line, li) => {
    if (li > 0) html += `<span style="flex-basis:100%;height:0"></span>`;
    for (const w of line.split(/ +/)) {
      if (!w) continue;
      html += `<span class="word">`;
      for (const c of w) {
        if (/[A-Z]/.test(c)) {
          html += `<span class="g">${glyphSVG(c, size)}${labels ? `<span class="lbl">${c}</span>` : ""}</span>`;
        } else {
          html += `<span class="other" style="font-size:${Math.round(size * 0.6)}px">${esc(c)}</span>`;
        }
      }
      html += `</span>`;
    }
  });
  if (withCaret) html += `<span class="caret"></span>`;
  return html;
}

/* The whole message as one standalone SVG, for saving or copying. */
function glyphStripSVG(text, size, labels) {
  const g = size;
  const gap = Math.round(g * 0.18);
  const wordGap = Math.round(g * 0.7);
  const lineH = Math.round(g * (labels ? 1.75 : 1.4));
  const maxW = Math.max(g * 10, 960);
  const pad = Math.round(g * 0.5);
  const otherW = Math.round(g * 0.55);

  const items = [];   // {kind:'g'|'t', c, x, y}
  let x = 0, y = 0, widest = 0;
  const lines = String(text).toUpperCase().split("\n");
  lines.forEach((line, li) => {
    if (li > 0) { x = 0; y += lineH; }
    for (const w of line.split(/ +/)) {
      if (!w) continue;
      const wW = [...w].reduce((s, c) => s + (/[A-Z]/.test(c) ? g : otherW) + gap, -gap);
      if (x > 0 && x + wordGap + wW > maxW) { x = 0; y += lineH; }
      else if (x > 0) x += wordGap;
      for (const c of w) {
        const isG = /[A-Z]/.test(c);
        items.push({ kind: isG ? "g" : "t", c, x, y });
        x += (isG ? g : otherW) + gap;
      }
      x -= gap;
      widest = Math.max(widest, x);
    }
  });
  const W = Math.max(widest, g) + 2 * pad;
  const H = y + lineH - (lineH - g) + (labels ? Math.round(g * 0.35) : 0) + 2 * pad;
  let body = "";
  for (const it of items) {
    const X = it.x + pad, Y = it.y + pad;
    if (it.kind === "g") {
      body += `<svg x="${X}" y="${Y}" width="${g}" height="${g}" viewBox="0 0 100 100">${glyphInner(C.pigpenGlyph(it.c), "#15304d")}</svg>`;
      if (labels) body += `<text x="${X + g / 2}" y="${Y + g * 1.3}" text-anchor="middle" font-family="Consolas, monospace" font-weight="700" font-size="${Math.round(g * 0.3)}" fill="#55708d">${it.c}</text>`;
    } else {
      body += `<text x="${X + otherW / 2}" y="${Y + g * 0.68}" text-anchor="middle" font-family="Consolas, monospace" font-weight="700" font-size="${Math.round(g * 0.6)}" fill="#55708d">${esc(it.c)}</text>`;
    }
  }
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#ffffff"/>${body}</svg>`,
    W, H,
  };
}

function pigpenPNG() {
  return new Promise((resolve, reject) => {
    const { svg, W, H } = glyphStripSVG(state.input, Math.max(state.pigSize, 48), state.pigLabels);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const cv = document.createElement("canvas");
      cv.width = W * scale; cv.height = H * scale;
      const ctx = cv.getContext("2d");
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png");
    };
    img.onerror = () => reject(new Error("could not draw"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

/* The four pigpen grids with their letters. */
function pigpenKeySVG() {
  const cell = 46, ink = "#15304d", lab = "#0f766e";
  const txt = (x, y, c) => `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-family="Consolas, monospace" font-weight="700" font-size="17" fill="${lab}">${c}</text>`;
  const dotAt = (x, y) => `<circle cx="${x}" cy="${y}" r="3.6" fill="${ink}"/>`;
  const line = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`;

  function grid(letters, dotted) {
    const S = cell * 3;
    let s = line(cell, 6, cell, S - 6) + line(2 * cell, 6, 2 * cell, S - 6)
          + line(6, cell, S - 6, cell) + line(6, 2 * cell, S - 6, 2 * cell);
    [...letters].forEach((c, i) => {
      const cx = (i % 3) * cell + cell / 2, cy = Math.floor(i / 3) * cell + cell / 2;
      if (dotted) { s += dotAt(cx, cy + 11); s += txt(cx, cy - 6, c); }
      else s += txt(cx, cy, c);
    });
    return `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">${s}</svg>`;
  }
  function cross(letters, dotted) {
    const S = cell * 3, m = S / 2, e = 10;
    let s = line(e, e, S - e, S - e) + line(S - e, e, e, S - e);
    // top, left, right, bottom
    const pos = [[m, 30], [30, m], [S - 30, m], [m, S - 30]];
    [...letters].forEach((c, i) => {
      const [x, y] = pos[i];
      if (dotted) {
        const [dx, dy] = [[0, 13], [13, 0], [-13, 0], [0, -13]][i];
        s += txt(x - dx * 0.35, y - dy * 0.35, c);
        s += dotAt(x + dx * 0.75, y + dy * 0.75);
      } else s += txt(x, y, c);
    });
    return `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">${s}</svg>`;
  }
  return grid("ABCDEFGHI", false) + grid("JKLMNOPQR", true) + cross("STUV", false) + cross("WXYZ", true);
}

function buildKeypad() {
  const order = [..."ABCDEFGHI", ..."JKLMNOPQR", ..."STUV", null, ..."WXYZ"];
  $("pig-keypad").innerHTML = order.map((c) =>
    c ? `<button type="button" data-letter="${c}" title="Pigpen symbol">${glyphSVG(c)}</button>` : `<span class="gap"></span>`
  ).join("");
}

/* ================================================================== *
 * Morse playback
 * ================================================================== */

const player = { ctx: null, raf: 0, events: [], t0: 0, end: 0 };

function stopMorse() {
  if (player.ctx) { try { player.ctx.close(); } catch (e) { /* already closed */ } }
  player.ctx = null;
  cancelAnimationFrame(player.raf);
  $("lamp").classList.remove("on");
  $("btn-play").innerHTML = "&#9654; Play";
}

function playMorse(code) {
  stopMorse();
  const seq = C.morseTimings(code);
  if (!seq.some((s) => s.on)) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  const unit = 1.2 / state.wpm;
  const osc = ctx.createOscillator();
  osc.frequency.value = 650;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.12;
  let t = t0;
  const events = [];
  for (const s of seq) {
    const dur = s.units * unit;
    if (s.on) {
      const ramp = Math.min(0.006, dur / 4);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35, t + ramp);
      gain.gain.setValueAtTime(0.35, t + dur - ramp);
      gain.gain.linearRampToValueAtTime(0, t + dur);
      events.push([t, t + dur]);
    }
    t += dur;
  }
  osc.start(t0);
  osc.stop(t + 0.05);
  Object.assign(player, { ctx, events, t0, end: t });
  $("btn-play").innerHTML = "&#9632; Stop";

  const tick = () => {
    if (player.ctx !== ctx) return;
    const now = ctx.currentTime;
    const on = events.some(([a, b]) => now >= a && now < b);
    $("lamp").classList.toggle("on", on && state.lamp);
    if (now > t + 0.1) { stopMorse(); return; }
    player.raf = requestAnimationFrame(tick);
  };
  player.raf = requestAnimationFrame(tick);
}

/* ================================================================== *
 * Pen-and-paper working
 * ================================================================== */

function workingCaesar() {
  const k = state.shift;
  const dec = state.mode === "decode";
  const usedIn = new Set(C.lettersOnly(state.input));
  let top = "", bot = "";
  for (let i = 0; i < 26; i++) {
    const p = C.ALPHA[i], c = C.ALPHA[(i + k) % 26];
    const usedTop = !dec && usedIn.has(p), usedBot = dec && usedIn.has(c);
    top += `<td class="${usedTop ? "used" : ""}">${p}</td>`;
    bot += `<td class="${usedBot ? "used" : ""}">${c}</td>`;
  }
  let html = `<div class="wk-block">
    <p class="wk-title">The alphabet, shifted ${k} place${k === 1 ? "" : "s"}</p>
    <div class="scroll-x"><table class="strip">
      <tr class="top"><th>Plain</th>${top}</tr>
      <tr class="bot"><th>Cipher</th>${bot}</tr>
    </table></div>
    <p class="wk-note">${dec
      ? "To decode, find each ciphertext letter on the <strong>bottom</strong> row and write down the letter above it. Underlined letters appear in the message."
      : "To encode, find each letter on the <strong>top</strong> row and write down the letter below it. Underlined letters appear in the message."}
    ${k === 0 ? " A shift of 0 changes nothing." : ""}</p>
  </div>`;

  if (dec) {
    const sample = state.input.replace(/\s+/g, " ").trim().slice(0, 60);
    let rows = "";
    if (sample) {
      for (let s = 0; s < 26; s++) {
        rows += `<tr data-shift="${s}" class="${s === k ? "on" : ""}"><td class="k">${s}</td><td>${esc(C.caesar(sample, s, true))}</td></tr>`;
      }
    }
    html += `<div class="wk-block">
      <p class="wk-title">Don't know the shift? Try all of them</p>
      ${sample ? `<div class="shifts-wrap"><table class="shifts" id="shift-table">${rows}</table></div>` : `<p class="wk-note">Type some ciphertext to see it under every shift.</p>`}
      <p class="wk-note">There are only 25 shifts worth trying, so a computer (or a patient student) can read any Caesar message without the key. This is a <strong>brute-force</strong> attack. Click a row to use that shift.</p>
    </div>`;
  }
  return html;
}

function workingKeyword() {
  const dec = state.mode === "decode";
  const r = last.kw;
  const alpha = r.alphabet;
  const kwLetters = new Set(C.lettersOnly(state.kwKey));
  const usedIn = new Set(C.lettersOnly(state.input));
  const fixed = new Set(r.fixed);

  // Encoding strip: plain alphabet on top, cipher alphabet below.
  let top = "", bot = "";
  for (let i = 0; i < 26; i++) {
    const p = C.ALPHA[i], c = alpha[i];
    const cls = (extra) => extra.filter(Boolean).join(" ");
    top += `<td class="${cls([!dec && usedIn.has(p) && "used", fixed.has(p) && "same"])}">${p}</td>`;
    bot += `<td class="${cls([kwLetters.has(c) && "kw", dec && usedIn.has(c) && "used", fixed.has(p) && "same"])}">${c}</td>`;
  }

  // Decoding strip: the same pairs sorted by cipher letter, so a reader
  // can look each ciphertext letter up in order.
  const inv = [...C.ALPHA].map((c) => C.ALPHA[alpha.indexOf(c)]);
  let dTop = "", dBot = "";
  for (let i = 0; i < 26; i++) {
    const c = C.ALPHA[i];
    dTop += `<td class="${dec && usedIn.has(c) ? "used" : ""}">${c}</td>`;
    dBot += `<td>${inv[i]}</td>`;
  }

  const kwShown = [...new Set(C.lettersOnly(state.kwKey))].join("");
  const sameNote = r.fixed.length
    ? `<strong>${r.fixed.length} letter${r.fixed.length === 1 ? "" : "s"} encode${r.fixed.length === 1 ? "s" : ""} as ${r.fixed.length === 1 ? "itself" : "themselves"}</strong> (${r.fixed.join(" ")}), outlined in red. ${state.kwFromEnd ? "" : "Starting the rest of the alphabet after the keyword usually fixes this."}`
    : "No letter encodes as itself.";

  return `<div class="wk-block">
      <p class="wk-title">The cipher alphabet</p>
      <div class="scroll-x"><table class="strip">
        <tr class="top"><th>Plain</th>${top}</tr>
        <tr class="bot"><th>Cipher</th>${bot}</tr>
      </table></div>
      <p class="wk-note">Write ${kwShown ? `the keyword with repeats crossed out (<strong>${kwShown}</strong>)` : "the keyword"} under A, B, C&hellip; (shaded orange), then the letters not used yet, ${state.kwFromEnd ? "carrying on after the keyword's last letter and wrapping round from Z to A" : "starting again from A"}. ${sameNote}</p>
    </div>
    <div class="wk-block">
      <p class="wk-title">Sorted for decoding</p>
      <div class="scroll-x"><table class="strip">
        <tr class="top"><th>Cipher</th>${dTop}</tr>
        <tr class="bot"><th>Plain</th>${dBot}</tr>
      </table></div>
      <p class="wk-note">The same pairs in cipher-letter order, so each ciphertext letter can be found quickly. Underlined letters appear in the message.</p>
    </div>
    <div class="wk-block">
      <p class="wk-note">Unlike Caesar, there are far too many keyword alphabets to try them all. But every E in the message becomes the same cipher letter, so counting which cipher letters are most common (<strong>frequency analysis</strong>) still breaks it.</p>
    </div>`;
}

function workingVigenere() {
  const dec = state.mode === "decode";
  const steps = last.steps || [];
  if (last.noKey) return `<p class="wk-note">Type a keyword to see the working.</p>`;
  if (!steps.length) return `<p class="wk-note">Type a message to see the keyword written under it.</p>`;
  const CAP = 150;
  const shown = steps.slice(0, CAP);
  const sel = Math.min(state.sel.vigenere, shown.length - 1);
  state.sel.vigenere = sel;
  const cells = (f) => shown.map((st, i) => `<td data-i="${i}" class="${i === sel ? "on" : ""}">${f(st)}</td>`).join("");
  const names = dec ? ["Ciphertext", "Key", "Plaintext"] : ["Plaintext", "Key", "Ciphertext"];

  const st = shown[sel];
  const plain = dec ? st.to : st.from;
  const ciph = dec ? st.from : st.to;
  const kIdx = st.key.charCodeAt(0) - 65;

  let tab = `<tr><th></th>${[...C.ALPHA].map((c) => `<th class="${c === plain ? "col-on" : ""}">${c}</th>`).join("")}</tr>`;
  for (let r = 0; r < 26; r++) {
    const rowOn = r === kIdx;
    tab += `<tr><th class="${rowOn ? "row-on" : ""}">${C.ALPHA[r]}</th>`;
    for (let c = 0; c < 26; c++) {
      const ch = C.ALPHA[(r + c) % 26];
      const colOn = C.ALPHA[c] === plain;
      // The path is the same either way: along the key row as far as the
      // plaintext column, and up that column to its heading.
      let cls = "";
      if (rowOn && colOn) cls = "hit";
      else if (rowOn && c < plain.charCodeAt(0) - 65) cls = "row-on";
      else if (colOn && r < kIdx) cls = "col-on";
      tab += `<td class="${cls}">${ch}</td>`;
    }
    tab += `</tr>`;
  }

  const how = dec
    ? `Key letter <strong>${st.key}</strong>: go along row ${st.key} until you reach <strong>${ciph}</strong>, then go up to the top of that column: <strong>${plain}</strong>.`
    : `Key letter <strong>${st.key}</strong>, plaintext <strong>${plain}</strong>: go along row ${st.key} to column ${plain} and read <strong>${ciph}</strong>.`;

  return `<div class="wk-block">
      <p class="wk-title">Write the keyword under the message, over and over</p>
      <div class="scroll-x"><table class="align" id="vig-align">
        <tr><th>${names[0]}</th>${cells((s) => s.from)}</tr>
        <tr class="key"><th>${names[1]}</th>${cells((s) => s.key)}</tr>
        <tr class="res"><th>${names[2]}</th>${cells((s) => s.to)}</tr>
      </table></div>
      ${steps.length > CAP ? `<p class="wk-note">Showing the first ${CAP} of ${steps.length} letters.</p>` : ""}
      <p class="wk-note">Only letters are shown; spaces and punctuation do not use up key letters. Click a column to look it up below.</p>
    </div>
    <div class="wk-block">
      <p class="wk-title">Look it up in the Vigen&egrave;re square</p>
      <p class="wk-note" style="margin:0 0 0.5rem">${how} Key ${st.key} is the same as a Caesar shift of ${kIdx}.</p>
      <div class="scroll-x"><table class="tabula">${tab}</table></div>
    </div>`;
}

function workingPlayfair() {
  const dec = state.mode === "decode";
  const pf = last.pf;
  const sq = pf.square;
  const kwLen = new Set(C.lettersOnly(state.pfKey).replace(/J/g, "I")).size;
  const steps = pf.steps;
  const sel = steps.length ? Math.min(state.sel.playfair, steps.length - 1) : -1;
  state.sel.playfair = Math.max(sel, 0);
  const st = sel >= 0 ? steps[sel] : null;

  let rows = "";
  for (let r = 0; r < 5; r++) {
    rows += "<tr>";
    for (let c = 0; c < 5; c++) {
      const ch = sq[r * 5 + c];
      const cls = [r * 5 + c < kwLen ? "kw" : ""];
      if (st && (ch === st.a || ch === st.b)) cls.push("src");
      else if (st && (ch === st.x || ch === st.y)) cls.push("dst");
      rows += `<td class="${cls.join(" ")}">${ch === "I" ? "I/J" : ch}</td>`;
    }
    rows += "</tr>";
  }

  const kw = sq.slice(0, kwLen).join("");
  let ruleText = "";
  if (st) {
    const dirWord = {
      row: dec ? "Same row: take the letter to the <strong>left</strong> of each, wrapping round from the start of the row to the end."
               : "Same row: take the letter to the <strong>right</strong> of each, wrapping round from the end of the row to the start.",
      column: dec ? "Same column: take the letter <strong>above</strong> each, wrapping round from the top to the bottom."
                  : "Same column: take the letter <strong>below</strong> each, wrapping round from the bottom to the top.",
      rectangle: "Different row and column: the two letters are corners of a rectangle. Swap each for the corner on <strong>its own row</strong>, in the other letter's column.",
    }[st.rule];
    const fillNote = st.added === "double"
      ? `<br>${st.a} was doubled in the message, so a filler ${st.b} was put between them.`
      : st.added === "end" ? `<br>The message had an odd number of letters, so a filler ${st.b} was added to the end.` : "";
    ruleText = `<div class="pf-rule"><span class="big"><span class="src-t">${st.a}${st.b}</span> &rarr; <span class="dst-t">${st.x}${st.y}</span></span><br>${dirWord}${fillNote}</div>`;
  }

  const chips = steps.map((s, i) => {
    const inA = s.a, inB = s.added ? `<span class="fill">${s.b}</span>` : s.b;
    return `<span class="pair ${i === sel ? "on" : ""}" data-i="${i}"><span class="p-in">${inA}${inB}</span><span class="p-out">${s.x}${s.y}</span></span>`;
  }).join("");

  const steps1 = dec
    ? `Split the ciphertext into pairs and use each rule backwards (left instead of right, up instead of down). Fillers come out as stray ${pf.filler}s, which the reader removes by common sense.`
    : `Write the message in capitals with no spaces or punctuation, J as I. Split it into pairs. If a pair would be a doubled letter, put ${pf.filler} between them; if one letter is left at the end, add ${pf.filler}. Wavy-underlined letters are fillers.`;

  return `<div class="wk-block">
      <div class="pf-wrap">
        <div>
          <p class="wk-title">The square</p>
          <table class="square">${rows}</table>
        </div>
        <div class="pf-side">
          <p class="wk-title">Building it</p>
          <p class="wk-note" style="margin-top:0">Write the keyword with repeated letters crossed out${kw ? ` (<strong>${kw}</strong>)` : ""}, then the rest of the alphabet in order, skipping letters already used. I and J share a square. Keyword letters are in green.</p>
          ${ruleText ? `<p class="wk-title" style="margin-top:0.8rem">Pair ${sel + 1}</p>${ruleText}` : ""}
        </div>
      </div>
    </div>
    <div class="wk-block">
      <p class="wk-title">The pairs <span class="muted">${dec ? "ciphertext on top, plaintext below" : "plaintext on top, ciphertext below"}</span></p>
      ${steps.length ? `<div class="pairs" id="pf-pairs">${chips}</div>` : `<p class="wk-note">Type a message to see it split into pairs.</p>`}
      <p class="wk-note">${steps1} Click a pair to see it in the square.</p>
    </div>`;
}

function workingPolybius() {
  const dec = state.mode === "decode";
  const r = last.pb;
  const n = r.size;
  const steps = r.steps;
  const CAP = 200;
  const shown = steps.slice(0, CAP);
  const sel = shown.length ? Math.min(state.sel.polybius, shown.length - 1) : -1;
  state.sel.polybius = Math.max(sel, 0);
  const st = sel >= 0 ? shown[sel] : null;

  const keyLen = r.keyLen;
  const shared = state.pbVariant === "ij" ? { I: "I/J" } : state.pbVariant === "ck" ? { C: "C/K" } : {};

  let rows = `<tr><th></th>${Array.from({ length: n }, (_, c) => `<th class="${st && st.col === c + 1 ? "col-on" : ""}">${c + 1}</th>`).join("")}</tr>`;
  for (let ri = 0; ri < n; ri++) {
    rows += `<tr><th class="${st && st.row === ri + 1 ? "row-on" : ""}">${ri + 1}</th>`;
    for (let c = 0; c < n; c++) {
      const ch = r.cells[ri * n + c];
      const cls = [];
      if (ri * n + c < keyLen) cls.push("kw");
      if (st && st.row === ri + 1 && st.col === c + 1) cls.push("hit");
      else if (st && (st.row === ri + 1 || st.col === c + 1)) cls.push("line");
      rows += `<td class="${cls.join(" ")}">${shared[ch] || ch}</td>`;
    }
    rows += "</tr>";
  }

  const chips = shown.map((s, i) => {
    const code = `${s.row}${s.col}`;
    return `<span class="pair ${i === sel ? "on" : ""}" data-i="${i}">${dec
      ? `<span class="p-in">${code}</span><span class="p-out">${s.ch}</span>`
      : `<span class="p-in">${s.ch}</span><span class="p-out">${code}</span>`}</span>`;
  }).join("");

  const look = st
    ? `<div class="pf-rule"><span class="big"><span class="src-t">${dec ? `${st.row}${st.col}` : st.ch}</span> &rarr; <span class="dst-t">${dec ? st.ch : `${st.row}${st.col}`}</span></span><br>${dec
        ? `Go down to row ${st.row}, then across to column ${st.col}: <strong>${st.ch}</strong>.`
        : `<strong>${st.ch}</strong> is in row ${st.row}, column ${st.col}, so it becomes ${st.row}${st.col}.`}</div>`
    : "";

  const tapNote = state.pbVariant === "ck"
    ? " Prisoners of war tapped messages through cell walls this way: tap the row, pause, tap the column. K is sent as C."
    : "";

  return `<div class="wk-block">
      <div class="pf-wrap">
        <div>
          <p class="wk-title">The square</p>
          <table class="square poly">${rows}</table>
        </div>
        <div class="pf-side">
          <p class="wk-title">Row first, then column</p>
          <p class="wk-note" style="margin-top:0">Every letter becomes a pair of coordinates: its <strong>row</strong>, then its <strong>column</strong>. That is the same order as reading a table, but the opposite of (x, y) on a graph, where across comes first.${tapNote}</p>
          ${look ? `<p class="wk-title" style="margin-top:0.8rem">${dec ? "Pair" : "Letter"} ${sel + 1}</p>${look}` : ""}
        </div>
      </div>
    </div>
    <div class="wk-block">
      <p class="wk-title">${dec ? "Each pair of numbers" : "Each letter"} <span class="muted">click one to find it in the square</span></p>
      ${shown.length ? `<div class="pairs" id="pb-pairs">${chips}</div>` : `<p class="wk-note">Type a message to see it turned into numbers.</p>`}
      ${steps.length > CAP ? `<p class="wk-note">Showing the first ${CAP} of ${steps.length}.</p>` : ""}
      <p class="wk-note">With only the digits 1 to ${n} needed, a message can be sent with torches, knocks or taps. Polybius described signalling it with torches in ancient Greece. It is still a substitution cipher, though: every E becomes the same pair, so frequency analysis breaks it.</p>
    </div>`;
}

function workingScytale() {
  const dec = state.mode === "decode";
  const r = last.scy;
  const k = r.faces;
  const n = r.cipher.length;
  if (!n) return `<p class="wk-note">Type a message to see it written on the rod.</p>`;

  // Rod: one row per face, one column per turn of the strip.
  let p = 0;
  const padFrom = r.plain.length - r.padded;
  const head = `<tr><th>Turn</th>${r.turns.map((_, c) => `<th class="t${c % 2}">${c + 1}</th>`).join("")}</tr>`;
  const body = r.grid.map((row, ri) => `<tr><th>Face ${ri + 1}</th>${row.map((ch, c) => {
    if (ch === null) return `<td class="gapc t${c % 2}"></td>`;
    const pad = p++ >= padFrom;
    return `<td class="t${c % 2}${pad ? " pad" : ""}">${ch}</td>`;
  }).join("")}</tr>`).join("");

  const strip = r.turns.map((t, c) =>
    `<span class="turn t${c % 2}">${[...t].map((ch) => `<span>${ch}</span>`).join("")}</span>`
  ).join("");

  const how = dec
    ? `<strong>No rod?</strong> Write the ciphertext in groups of ${k}, one group for each turn of the strip. The 1st letter of every group lies on face 1, the 2nd letter on face 2, and so on. So read every ${k}${k === 2 ? "nd" : k === 3 ? "rd" : "th"} letter starting from the 1st, then every ${k}${k === 2 ? "nd" : k === 3 ? "rd" : "th"} starting from the 2nd, and so on.`
    : `Wind the strip round the rod so each turn holds ${k} letters. Write the message along the rod: face 1 from left to right, then face 2, and so on. Each row of the table is one face; each column is one turn of the strip. Unwinding the strip reads the table a <strong>column</strong> at a time, top to bottom.`;

  let html = `<div class="wk-block">
      <p class="wk-title">The message along the rod</p>
      <div class="scroll-x"><table class="rod">${head}${body}</table></div>
      ${r.padded ? `<p class="wk-note">Wavy-underlined X's fill the last turn.</p>` : ""}
    </div>
    <div class="wk-block">
      <p class="wk-title">The strip, unwound</p>
      <div class="strip-flat">${strip}</div>
      <p class="wk-note">${how} No letter is changed, only moved, so this is a <strong>transposition</strong> cipher: the letters are all still there, just shuffled.</p>
    </div>`;

  if (dec) {
    const max = Math.min(12, Math.max(2, n - 1));
    let rows = "";
    for (let f = 2; f <= max; f++) {
      rows += `<tr data-faces="${f}" class="${f === k ? "on" : ""}"><td class="k">${f}</td><td>${esc(C.scytale(state.input, f, true).text.slice(0, 60))}</td></tr>`;
    }
    html += `<div class="wk-block">
      <p class="wk-title">Don't know the rod? Try every thickness</p>
      <div class="shifts-wrap"><table class="shifts" id="scy-table">${rows}</table></div>
      <p class="wk-note">The number down the side is the letters per turn. Only a few rod sizes are possible, so this cipher is as easy to brute-force as a Caesar shift. Click a row to use it.</p>
    </div>`;
  }
  return html;
}

function workingMorse() {
  const dec = state.mode === "decode";
  const used = new Set((dec ? last.text : state.input.toUpperCase()).replace(/\s/g, ""));
  const cell = (c) => `<span class="morse-cell ${used.has(c) ? "used" : ""}"><span class="ch">${esc(c)}</span><span class="cd">${C.MORSE[c]}</span></span>`;
  const letters = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(cell).join("");
  const digits = [..."0123456789"].map(cell).join("");
  const punct = [...".,?'!/()&:;=+-\"@"].map(cell).join("");
  return `<div class="wk-block">
      <p class="wk-title">Letters</p><div class="morse-grid">${letters}</div>
    </div>
    <div class="wk-block">
      <p class="wk-title">Numbers</p><div class="morse-grid">${digits}</div>
    </div>
    <div class="wk-block">
      <p class="wk-title">Punctuation</p><div class="morse-grid">${punct}</div>
      <p class="wk-note">Highlighted characters appear in the message. Letters are separated by a space and words by a slash. The most common letters, E and T, have the shortest codes. When decoding, use . and - (or &middot; and &ndash;); separate letters with a space and words with / or two spaces.</p>
    </div>`;
}

function workingPigpen() {
  return `<div class="wk-block">
      <div class="pig-key">${pigpenKeySVG()}</div>
      <p class="wk-note">Each letter is drawn as the lines around its space in the grid, plus the dot if it has one. A is the corner shape &#8991;, E is a closed square, S is a V. Some books order the letters differently; this is the most common layout.</p>
    </div>`;
}

/* ================================================================== *
 * Render
 * ================================================================== */

function setLabels() {
  const dec = state.mode === "decode";
  let plain = "Plaintext", ciph = "Ciphertext";
  if (state.cipher === "morse") { plain = "Message"; ciph = "Morse code"; }
  if (state.cipher === "pigpen") { plain = "Message"; ciph = "Pigpen"; }
  $("in-label").textContent = dec ? ciph : plain;
  $("out-label").textContent = dec ? plain : ciph;
  $("input").placeholder = dec
    ? (state.cipher === "morse" ? "Paste dots and dashes, e.g.  .... .. / - .... . .-. ." : "Paste the ciphertext")
    : "Type or paste a message";
}

function summary() {
  switch (state.cipher) {
    case "caesar": return `A → ${C.ALPHA[state.shift]}, shift ${state.shift}`;
    case "keyword": return C.lettersOnly(state.kwKey) ? `keyword ${C.lettersOnly(state.kwKey)}` : "no keyword: plain alphabet";
    case "vigenere": return C.lettersOnly(state.vigKey) ? `keyword ${C.lettersOnly(state.vigKey)}` : "";
    case "playfair": return `keyword ${C.lettersOnly(state.pfKey) || "(none)"}`;
    case "polybius": return { ij: "5 × 5, I/J shared", ck: "5 × 5, C/K shared", 6: "6 × 6 with digits" }[state.pbVariant]
      + (C.lettersOnly(state.pbKey) ? `, keyword ${state.pbKey.toUpperCase().replace(/[^A-Z0-9]/g, "")}` : "");
    case "scytale": return `${state.scyFaces} letters per turn`;
    case "morse": return "International Morse code";
    case "pigpen": return "the pigpen grids";
  }
  return "";
}

function render() {
  const { cipher, mode } = state;
  const dec = mode === "decode";

  document.querySelectorAll("#cipher-seg button").forEach((b) => b.classList.toggle("on", b.dataset.cipher === cipher));
  document.querySelectorAll("#mode-seg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  document.querySelectorAll(".opts").forEach((el) => { el.hidden = el.dataset.for !== cipher; });
  document.querySelectorAll("[data-mode-only]").forEach((el) => { el.hidden = el.dataset.modeOnly !== mode; });
  document.querySelectorAll("[data-shift]").forEach((b) => { if (b.classList.contains("chip")) b.classList.toggle("on", +b.dataset.shift === state.shift); });

  // layout select
  const fmts = FORMATS[cipher];
  $("format-group").hidden = !fmts || dec;
  if (fmts) {
    const sel = $("format-select");
    const want = fmts.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    if (sel.dataset.cipher !== cipher) { sel.innerHTML = want; sel.dataset.cipher = cipher; }
    sel.value = state.format[cipher];
    $("format-note").textContent = FORMAT_NOTES[state.format[cipher]] || "";
  }

  setLabels();
  last = compute();

  // message side
  const pigIn = cipher === "pigpen" && dec;
  $("input").hidden = pigIn;
  $("pig-in").hidden = !pigIn;
  if (pigIn) {
    $("pig-in-strip").innerHTML = state.input.trim()
      ? glyphStripHTML(state.input, Math.round(state.pigSize * 0.8), false, true)
      : `<span class="empty-msg">Tap symbols below to build the message</span><span class="caret"></span>`;
  }

  // answer side
  const pigOut = cipher === "pigpen" && !dec;
  $("output").parentElement.hidden = pigOut;
  $("pig-out").hidden = !pigOut;
  if (pigOut) {
    $("pig-out").innerHTML = state.input.trim()
      ? glyphStripHTML(state.input, state.pigSize, state.pigLabels, false)
      : `<span class="empty-msg">The pigpen symbols appear here</span>`;
  } else {
    const out = $("output");
    out.classList.toggle("morse", cipher === "morse" && !dec);
    if (last.text.trim()) { out.textContent = last.text; out.classList.remove("empty"); }
    else { out.textContent = "The answer appears here"; out.classList.add("empty"); }
  }
  $("lamp").hidden = !(cipher === "morse" && state.lamp);
  $("btn-play").hidden = cipher !== "morse";
  $("btn-save-img").hidden = !pigOut;
  $("btn-copy").textContent = pigOut ? "Copy image" : "Copy";

  const note = $("out-note");
  note.hidden = !last.notes.length;
  note.innerHTML = last.notes.join("<br>");

  // working
  $("working-sub").textContent = summary();
  const w = { caesar: workingCaesar, keyword: workingKeyword, vigenere: workingVigenere, playfair: workingPlayfair, polybius: workingPolybius, scytale: workingScytale, morse: workingMorse, pigpen: workingPigpen }[cipher];
  $("working").innerHTML = w();
  if (cipher === "caesar" && dec) {
    const on = document.querySelector("#shift-table tr.on");
    if (on) on.parentElement.parentElement.parentElement.scrollTop = Math.max(0, on.offsetTop - 60);
  }
}

/* ================================================================== *
 * Controls
 * ================================================================== */

function setInput(text) {
  state.input = text;
  $("input").value = text;
}

function flash(btn, msg) {
  const old = btn.dataset.label || btn.textContent;
  btn.dataset.label = old;
  btn.textContent = msg;
  btn.classList.add("done");
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.textContent = btn.dataset.label; delete btn.dataset.label; btn.classList.remove("done"); }, 1300);
}

function copyText(text, btn) {
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    flash(btn, ok ? "Copied" : "Select and copy");
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => flash(btn, "Copied"), fallback);
  } else fallback();
}

function setShift(k) {
  state.shift = C.mod(Math.round(+k || 0), 26);
  $("caesar-shift").value = state.shift;
  $("caesar-range").value = state.shift;
  render();
}

function setFaces(f) {
  state.scyFaces = Math.min(12, Math.max(2, Math.round(+f || 2)));
  $("scy-faces").value = state.scyFaces;
  $("scy-range").value = state.scyFaces;
  render();
}

function wire() {
  buildKeypad();

  $("input").value = state.input;
  $("input").addEventListener("input", (e) => { state.input = e.target.value; render(); });

  $("cipher-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-cipher]");
    if (!b || b.dataset.cipher === state.cipher) return;
    stopMorse();
    state.cipher = b.dataset.cipher;
    render();
  });
  $("mode-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b || b.dataset.mode === state.mode) return;
    stopMorse();
    state.mode = b.dataset.mode;
    render();
  });

  // Caesar
  $("caesar-range").addEventListener("input", (e) => setShift(e.target.value));
  $("caesar-shift").addEventListener("input", (e) => { if (e.target.value !== "") setShift(e.target.value); });
  document.querySelectorAll(".chip[data-shift]").forEach((b) => b.addEventListener("click", () => setShift(b.dataset.shift)));
  $("caesar-random").addEventListener("click", () => {
    let k;
    do { k = 1 + Math.floor(Math.random() * 25); } while (k === state.shift);
    setShift(k);
  });
  $("working").addEventListener("click", (e) => {
    const tr = e.target.closest("#shift-table tr[data-shift]");
    if (tr) { setShift(tr.dataset.shift); return; }
    const fr = e.target.closest("#scy-table tr[data-faces]");
    if (fr) { setFaces(fr.dataset.faces); return; }
    const td = e.target.closest("#vig-align td[data-i]");
    if (td) { state.sel.vigenere = +td.dataset.i; render(); return; }
    const pr = e.target.closest("#pf-pairs .pair");
    if (pr) { state.sel.playfair = +pr.dataset.i; render(); return; }
    const pb = e.target.closest("#pb-pairs .pair");
    if (pb) { state.sel.polybius = +pb.dataset.i; render(); }
  });

  // Keyword
  $("kw-key").addEventListener("input", (e) => { state.kwKey = e.target.value; render(); });
  $("kw-start").addEventListener("change", (e) => { state.kwFromEnd = e.target.value === "end"; render(); });

  // Polybius
  $("pb-variant").addEventListener("change", (e) => { state.pbVariant = e.target.value; render(); });
  $("pb-key").addEventListener("input", (e) => { state.pbKey = e.target.value; render(); });

  // Scytale
  $("scy-range").addEventListener("input", (e) => setFaces(e.target.value));
  $("scy-faces").addEventListener("input", (e) => { if (e.target.value !== "") setFaces(e.target.value); });
  $("scy-pad").addEventListener("change", (e) => { state.scyPad = e.target.checked; render(); });

  // Vigenère / Playfair
  $("vig-key").addEventListener("input", (e) => { state.vigKey = e.target.value; render(); });
  $("pf-key").addEventListener("input", (e) => { state.pfKey = e.target.value; render(); });
  $("pf-filler").addEventListener("input", (e) => { state.pfFiller = e.target.value || "X"; render(); });
  $("pf-tidy").addEventListener("change", (e) => { state.pfTidy = e.target.checked; render(); });
  $("format-select").addEventListener("change", (e) => { state.format[state.cipher] = e.target.value; render(); });

  // Morse
  const wpmLabel = () => { $("morse-wpm-val").textContent = `${state.wpm} words / min`; };
  $("morse-wpm").addEventListener("input", (e) => { state.wpm = +e.target.value; wpmLabel(); });
  wpmLabel();
  $("morse-lamp").addEventListener("change", (e) => { state.lamp = e.target.checked; render(); });
  $("btn-play").addEventListener("click", () => {
    if (player.ctx) { stopMorse(); return; }
    playMorse(last && last.code ? last.code : "");
  });

  // Pigpen
  $("pig-size").addEventListener("input", (e) => { state.pigSize = +e.target.value; render(); });
  $("pig-labels").addEventListener("change", (e) => { state.pigLabels = e.target.checked; render(); });
  $("pig-keypad").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-letter]");
    if (!b) return;
    setInput(state.input + b.dataset.letter);
    render();
  });
  $("pig-space").addEventListener("click", () => {
    if (state.input && !/ $/.test(state.input)) setInput(state.input + " ");
    render();
  });
  $("pig-back").addEventListener("click", () => { setInput(state.input.replace(/\s*.$/, "")); render(); });
  $("btn-save-img").addEventListener("click", () => {
    pigpenPNG().then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "pigpen.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }).catch(() => flash($("btn-save-img"), "Could not save"));
  });

  // Message box buttons
  $("btn-clear").addEventListener("click", () => { stopMorse(); setInput(""); render(); if (!$("input").hidden) $("input").focus(); });
  $("btn-example").addEventListener("click", () => {
    stopMorse();
    const msg = EXAMPLES[state.cipher];
    if (state.mode === "encode" || state.cipher === "pigpen") { setInput(state.cipher === "pigpen" && state.mode === "decode" ? msg.toUpperCase() : msg); render(); return; }
    // Decode: show the example already encoded with the current settings.
    state.mode = "encode";
    state.input = msg;
    const enc = compute().text;
    state.mode = "decode";
    setInput(enc);
    render();
  });

  $("btn-swap").addEventListener("click", () => {
    stopMorse();
    const text = last ? last.text : "";
    state.mode = state.mode === "encode" ? "decode" : "encode";
    setInput(text);
    render();
  });

  $("btn-copy").addEventListener("click", () => {
    const btn = $("btn-copy");
    if (state.cipher === "pigpen" && state.mode === "encode") {
      if (!(navigator.clipboard && window.ClipboardItem)) { flash(btn, "Use Save image"); return; }
      // Hand the clipboard a promise so the browser still counts the click.
      navigator.clipboard.write([new ClipboardItem({ "image/png": pigpenPNG() })])
        .then(() => flash(btn, "Copied"), () => flash(btn, "Use Save image"));
      return;
    }
    if (!last || !last.text.trim()) return;
    copyText(last.text, btn);
  });

  render();
}

wire();

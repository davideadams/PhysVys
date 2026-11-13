"use strict";

/* ------------------------------------------------------------------ *
 * Classroom ciphers — pure functions, no DOM.
 * Loaded by index.html (the tool) and test.html (the self-test).
 *
 * Every cipher here is one a student can do with pen and paper, so the
 * functions also return the working (pairs, key alignment, glyph shapes)
 * the page draws beside the answer.
 * ------------------------------------------------------------------ */

const Ciphers = (() => {
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const mod = (n, m) => ((n % m) + m) % m;
  const isLetter = (c) => /^[A-Za-z]$/.test(c);
  const lettersOnly = (s) => String(s).toUpperCase().replace(/[^A-Z]/g, "");

  /* Shift one letter k places, keeping its case. Anything else passes through. */
  function shiftChar(c, k) {
    const code = c.charCodeAt(0);
    if (code >= 65 && code <= 90) return String.fromCharCode(65 + mod(code - 65 + k, 26));
    if (code >= 97 && code <= 122) return String.fromCharCode(97 + mod(code - 97 + k, 26));
    return c;
  }

  /* How ciphertext is laid out once letters are done:
   *   keep    — spaces, punctuation and case as typed
   *   letters — capitals only, one long run
   *   blocks5 — capitals in groups of five, the traditional way to hide word lengths */
  function formatOutput(text, style) {
    if (style === "letters") return lettersOnly(text);
    if (style === "blocks5") return groupLetters(lettersOnly(text), 5);
    return text;
  }
  function groupLetters(letters, n) {
    const out = [];
    for (let i = 0; i < letters.length; i += n) out.push(letters.slice(i, i + n));
    return out.join(" ");
  }

  /* ---------------- Caesar / rotation ---------------- */

  function caesar(text, shift, decode) {
    const k = decode ? -shift : shift;
    let out = "";
    for (const c of String(text)) out += shiftChar(c, k);
    return out;
  }

  /* ---------------- Keyword (keyed Caesar) ---------------- */

  /* Cipher alphabet: the keyword with repeats removed, then the unused
   * letters in order. fromKeyEnd starts that run at the letter after the
   * keyword's last letter (wrapping round) instead of at A, which stops
   * the end of the alphabet mapping to itself. */
  function keywordAlphabet(key, fromKeyEnd) {
    const seen = new Set();
    const out = [];
    for (const c of lettersOnly(key)) if (!seen.has(c)) { seen.add(c); out.push(c); }
    const start = fromKeyEnd && out.length ? (ALPHA.indexOf(out[out.length - 1]) + 1) % 26 : 0;
    for (let i = 0; i < 26; i++) {
      const c = ALPHA[(start + i) % 26];
      if (!seen.has(c)) { seen.add(c); out.push(c); }
    }
    return out.join("");
  }

  function keywordCipher(text, key, decode, opts = {}) {
    const alpha = keywordAlphabet(key, opts.fromKeyEnd);
    const from = decode ? alpha : ALPHA;
    const to = decode ? ALPHA : alpha;
    let out = "";
    for (const c of String(text)) {
      const up = c.toUpperCase();
      const i = from.indexOf(up);
      if (i < 0 || !/[A-Z]/.test(up)) { out += c; continue; }
      out += c === up ? to[i] : to[i].toLowerCase();
    }
    const fixed = [...ALPHA].filter((c, i) => alpha[i] === c);
    return { text: out, alphabet: alpha, fixed };
  }

  /* ---------------- Vigenère ---------------- */

  /* The key only moves on when a letter is used, so spaces and punctuation
   * do not eat key letters — the way it is done on paper. */
  function vigenere(text, key, decode) {
    const k = lettersOnly(key);
    const steps = [];
    if (!k) return { text: String(text), steps, noKey: true };
    let out = "";
    let j = 0;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (!isLetter(c)) { out += c; continue; }
      const kc = k[j % k.length];
      const amt = kc.charCodeAt(0) - 65;
      const r = shiftChar(c, decode ? -amt : amt);
      steps.push({ from: c.toUpperCase(), key: kc, to: r.toUpperCase() });
      out += r;
      j++;
    }
    return { text: out, steps, noKey: false };
  }

  /* ---------------- Playfair ---------------- */

  /* 5x5 square: keyword letters first (repeats dropped), then the rest of
   * the alphabet. I and J share a cell, so J is written as I throughout. */
  function playfairSquare(key) {
    const seen = new Set();
    const sq = [];
    for (const c0 of lettersOnly(key) + ALPHA) {
      const c = c0 === "J" ? "I" : c0;
      if (!seen.has(c)) { seen.add(c); sq.push(c); }
    }
    return sq;
  }

  function cleanFiller(f) {
    let c = lettersOnly(f)[0] || "X";
    if (c === "J") c = "I";
    return c;
  }
  /* The filler for a doubled filler (XX) or a trailing filler letter. */
  const altFiller = (f) => (f === "X" ? "Q" : "X");

  /* Split plaintext into pairs. A doubled letter inside a pair gets the filler
   * pushed between them; a lone last letter gets the filler after it. */
  function playfairPrepare(text, filler) {
    const f = cleanFiller(filler);
    const letters = lettersOnly(text).replace(/J/g, "I");
    const pairs = [];
    let i = 0;
    while (i < letters.length) {
      const a = letters[i];
      const b = letters[i + 1];
      if (b === undefined) {
        pairs.push({ a, b: a === f ? altFiller(f) : f, added: "end" });
        i += 1;
      } else if (a === b) {
        pairs.push({ a, b: a === f ? altFiller(f) : f, added: "double" });
        i += 1;
      } else {
        pairs.push({ a, b, added: null });
        i += 2;
      }
    }
    return pairs;
  }

  /* One pair through the square. dir = +1 encodes, -1 decodes. */
  function playfairPair(sq, a, b, dir) {
    const ia = sq.indexOf(a), ib = sq.indexOf(b);
    const ra = Math.floor(ia / 5), ca = ia % 5;
    const rb = Math.floor(ib / 5), cb = ib % 5;
    if (ra === rb) {
      return { x: sq[ra * 5 + mod(ca + dir, 5)], y: sq[rb * 5 + mod(cb + dir, 5)], rule: "row" };
    }
    if (ca === cb) {
      return { x: sq[mod(ra + dir, 5) * 5 + ca], y: sq[mod(rb + dir, 5) * 5 + cb], rule: "column" };
    }
    return { x: sq[ra * 5 + cb], y: sq[rb * 5 + ca], rule: "rectangle" };
  }

  /* Encode: returns the cipher pairs plus the working.
   * Decode: ciphertext letters are paired as they stand; an odd count is
   * flagged and the last letter padded so the rest can still be read.
   * tidy (decode only) drops the filler between two identical letters and
   * a filler at the very end — a guess, since a real X could sit there too. */
  function playfair(text, key, decode, opts = {}) {
    const sq = playfairSquare(key);
    const f = cleanFiller(opts.filler);
    const dir = decode ? -1 : 1;
    let pairs;
    let oddLength = false;
    let doubles = false;
    if (decode) {
      const letters = lettersOnly(text).replace(/J/g, "I");
      pairs = [];
      for (let i = 0; i < letters.length; i += 2) {
        const a = letters[i];
        let b = letters[i + 1];
        if (b === undefined) { b = f; oddLength = true; }
        if (a === b) doubles = true;
        pairs.push({ a, b, added: null });
      }
    } else {
      pairs = playfairPrepare(text, f);
    }
    const steps = pairs.map((p) => {
      const r = playfairPair(sq, p.a, p.b, dir);
      return { a: p.a, b: p.b, added: p.added, x: r.x, y: r.y, rule: r.rule };
    });

    let outLetters;
    if (decode && opts.tidy) {
      let s = "";
      steps.forEach((st, i) => {
        const next = steps[i + 1];
        s += st.x;
        const fillerBetweenTwins = next && (st.y === f || st.y === altFiller(f)) && st.x === next.x;
        const fillerAtEnd = !next && (st.y === f || st.y === altFiller(f));
        if (!fillerBetweenTwins && !fillerAtEnd) s += st.y;
      });
      outLetters = s;
    } else {
      outLetters = steps.map((st) => st.x + st.y).join("");
    }

    let out;
    const fmt = opts.format || "pairs";
    if (decode) out = outLetters;
    else if (fmt === "pairs") out = steps.map((st) => st.x + st.y).join(" ");
    else if (fmt === "blocks5") out = groupLetters(outLetters, 5);
    else out = outLetters;

    return { text: out, square: sq, steps, oddLength, doubles, filler: f };
  }

  /* ---------------- Scytale ---------------- */

  /* A strip wound round a rod so that each turn holds `faces` letters.
   * The message is written along the rod, one face (row) after another;
   * unwinding the strip gives the ciphertext.
   *
   * Strip letter i sits on face i % faces, at position floor(i / faces)
   * along the rod. So decoding is "read every faces-th letter", starting
   * from the 1st, then the 2nd, and so on: something a student can do by
   * counting. If the strip does not fill the last turn, the first faces
   * get one more letter than the rest, which is what a real rod does.
   *
   * Only letters and digits are used. pad (encode only) fills the last
   * turn with X so every turn is complete. */
  function scytale(text, faces, decode, opts = {}) {
    const k = Math.max(2, Math.round(+faces) || 2);
    const chars = String(text).toUpperCase().match(/[A-Z0-9]/g) || [];
    let padded = 0;
    if (!decode && opts.pad) {
      while (chars.length % k) { chars.push("X"); padded++; }
    }
    const n = chars.length;
    const strip = new Array(n);
    if (decode) {
      for (let i = 0; i < n; i++) strip[i] = chars[i];
    } else {
      let j = 0;
      for (let r = 0; r < k; r++) for (let i = r; i < n; i += k) strip[i] = chars[j++];
    }
    let plain = "";
    for (let r = 0; r < k; r++) for (let i = r; i < n; i += k) plain += strip[i];
    const cipher = strip.join("");

    const cols = Math.ceil(n / k);
    const grid = [];
    for (let r = 0; r < k; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const i = c * k + r;
        row.push(i < n ? strip[i] : null);
      }
      grid.push(row);
    }
    const turns = [];
    for (let c = 0; c < cols; c++) turns.push(strip.slice(c * k, c * k + k).join(""));

    return { text: decode ? plain : cipher, plain, cipher, grid, turns, faces: k, padded };
  }

  /* ---------------- Polybius square ---------------- */

  /* Each letter becomes its row then its column in a grid.
   *   variant "ij" — 5 x 5, I and J share a cell (the usual one)
   *   variant "ck" — 5 x 5, C and K share a cell (the prisoners' tap code)
   *   variant "6"  — 6 x 6, letters then digits 0–9
   * An optional keyword mixes the grid the same way as Playfair's. */
  function polybiusNorm(c, variant) {
    if (variant === "ij" && c === "J") return "I";
    if (variant === "ck" && c === "K") return "C";
    return c;
  }

  function polybiusSquare(key, variant) {
    const base = variant === "6" ? ALPHA + "0123456789"
      : variant === "ck" ? ALPHA.replace("K", "") : ALPHA.replace("J", "");
    const keyChars = String(key || "").toUpperCase().replace(variant === "6" ? /[^A-Z0-9]/g : /[^A-Z]/g, "");
    const seen = new Set();
    const cells = [];
    let keyLen = 0;
    [...keyChars + base].forEach((c0, i) => {
      const c = polybiusNorm(c0, variant);
      if (base.includes(c) && !seen.has(c)) {
        seen.add(c);
        cells.push(c);
        if (i < keyChars.length) keyLen++;
      }
    });
    return { cells, size: variant === "6" ? 6 : 5, keyLen };
  }

  /* Encode layouts:
   *   pairs — "23 15 31 31 34 / 52 34 42 31 14"
   *   run   — every digit run together, hiding word breaks
   *   taps  — dots for taps: "·· ···", letters two spaces apart, words " / "
   * Decode reads either digits or dots; with digits, words split on /,
   * two or more spaces or a new line; with dots, on / only. */
  function polybius(text, key, decode, opts = {}) {
    const variant = opts.variant || "ij";
    const { cells, size, keyLen } = polybiusSquare(key, variant);
    const steps = [];

    if (!decode) {
      const skipped = new Set();
      const words = [];
      for (const w of String(text).toUpperCase().split(/\s+/).filter(Boolean)) {
        const codes = [];
        for (const c0 of w) {
          const c = polybiusNorm(c0, variant);
          const i = cells.indexOf(c);
          if (i < 0) {
            if (!/[.,;:!?'"()\-]/.test(c0)) skipped.add(c0);
            continue;
          }
          const step = { ch: c, row: Math.floor(i / size) + 1, col: (i % size) + 1 };
          codes.push(step);
          steps.push(step);
        }
        if (codes.length) words.push(codes);
      }
      const fmt = opts.format || "pairs";
      const tap = (n) => "·".repeat(n);
      let out;
      if (fmt === "run") out = words.map((w) => w.map((s) => `${s.row}${s.col}`).join("")).join("");
      else if (fmt === "taps") out = words.map((w) => w.map((s) => `${tap(s.row)} ${tap(s.col)}`).join("  ")).join(" / ");
      else out = words.map((w) => w.map((s) => `${s.row}${s.col}`).join(" ")).join(" / ");
      return { text: out, steps, cells, size, keyLen, skipped: [...skipped], odd: false, bad: [] };
    }

    const norm = String(text).replace(/[·•∙⋅]/g, ".");
    const taps = /\./.test(norm) && !/[0-9]/.test(norm);
    const wordsIn = taps
      ? norm.split("/").map((w) => (w.match(/\.+/g) || []).map((t) => t.length))
      : norm.split(/\/|\s{2,}|\n/).map((w) => (w.match(/[0-9]/g) || []).map(Number));
    let odd = false;
    const bad = new Set();
    const outWords = [];
    for (const nums of wordsIn) {
      if (!nums.length) continue;
      let w = "";
      for (let i = 0; i < nums.length; i += 2) {
        const r = nums[i], c = nums[i + 1];
        if (c === undefined) { odd = true; break; }
        if (r < 1 || r > size || c < 1 || c > size) {
          bad.add(taps ? `${r} taps, ${c} taps` : `${r}${c}`);
          w += "#";
          continue;
        }
        const ch = cells[(r - 1) * size + (c - 1)];
        steps.push({ ch, row: r, col: c });
        w += ch;
      }
      outWords.push(w);
    }
    return { text: outWords.join(" "), steps, cells, size, keyLen, skipped: [], odd, bad: [...bad], taps };
  }

  /* ---------------- Morse ---------------- */

  const MORSE = {
    A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....",
    I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.",
    Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
    Y: "-.--", Z: "--..",
    0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-",
    5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----.",
    ".": ".-.-.-", ",": "--..--", "?": "..--..", "'": ".----.", "!": "-.-.--",
    "/": "-..-.", "(": "-.--.", ")": "-.--.-", "&": ".-...", ":": "---...",
    ";": "-.-.-.", "=": "-...-", "+": ".-.-.", "-": "-....-", "\"": ".-..-.",
    "@": ".--.-.",
  };
  const MORSE_REV = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

  /* Letters are separated by a space, words by " / ". Characters with no
   * Morse code are left out and reported. */
  function morseEncode(text) {
    const skipped = new Set();
    const words = String(text).toUpperCase().split(/\s+/).filter(Boolean);
    const coded = [];
    for (const w of words) {
      const letters = [];
      for (const c of w) {
        if (MORSE[c]) letters.push(MORSE[c]);
        else skipped.add(c);
      }
      if (letters.length) coded.push(letters.join(" "));
    }
    return { text: coded.join(" / "), skipped: [...skipped] };
  }

  /* Accepts the dots and dashes people actually type or paste: . · • and
   * - – — − _. Words split on / or | or a gap of two or more spaces or a new
   * line. A group that is not a code becomes # and is reported. */
  function morseDecode(code) {
    const norm = String(code)
      .replace(/[·•∙⋅]/g, ".")
      .replace(/[–—−_‒]/g, "-");
    const unknown = new Set();
    const words = norm.trim().split(/\s*[\/|]\s*|\s*\n\s*|\s{2,}/).filter(Boolean);
    const out = words.map((w) =>
      w.split(/\s+/).filter(Boolean).map((g) => {
        if (MORSE_REV[g]) return MORSE_REV[g];
        unknown.add(g);
        return "#";
      }).join("")
    );
    return { text: out.join(" "), unknown: [...unknown] };
  }

  /* On/off timings in dot units: dot 1, dash 3, gap inside a letter 1,
   * between letters 3, between words 7. Returns [{on, units}]. */
  function morseTimings(code) {
    const seq = [];
    const push = (on, units) => {
      const last = seq[seq.length - 1];
      if (last && last.on === on) last.units = Math.max(last.units, units);
      else seq.push({ on, units });
    };
    const words = String(code).trim().split(/\s*\/\s*/).filter(Boolean);
    words.forEach((w, wi) => {
      if (wi > 0) push(false, 7);
      w.split(/\s+/).filter(Boolean).forEach((g, gi) => {
        if (gi > 0) push(false, 3);
        [...g].forEach((s, si) => {
          if (si > 0) push(false, 1);
          if (s === ".") seq.push({ on: true, units: 1 });
          else if (s === "-") seq.push({ on: true, units: 3 });
        });
      });
    });
    return seq;
  }

  /* ---------------- Pigpen ---------------- */

  /* The common layout: A–I in a noughts-and-crosses grid, J–R in a second
   * grid with dots, S–V in an X, W–Z in a dotted X. Each letter is drawn as
   * the lines that surround its cell.
   *   grid glyph: sides {t, r, b, l} that are drawn
   *   x glyph:    point — the direction the V's tip faces */
  function pigpenGlyph(letter) {
    const c = String(letter).toUpperCase();
    const n = ALPHA.indexOf(c);
    if (n < 0) return null;
    if (n < 18) {
      const k = n % 9;
      const r = Math.floor(k / 3), col = k % 3;
      return {
        kind: "grid",
        sides: { t: r > 0, b: r < 2, l: col > 0, r: col < 2 },
        dot: n >= 9,
      };
    }
    const k = (n - 18) % 4;
    // S top of the X, T left, U right, V bottom; tip points to the centre.
    const point = ["down", "right", "left", "up"][k];
    return { kind: "x", point, dot: n >= 22 };
  }

  /* Letter for a glyph — the decoder's keypad is built from these. */
  function pigpenLetterFor(glyph) {
    for (const c of ALPHA) {
      const g = pigpenGlyph(c);
      if (JSON.stringify(g) === JSON.stringify(glyph)) return c;
    }
    return null;
  }

  return {
    ALPHA, mod, lettersOnly, shiftChar, formatOutput, groupLetters,
    caesar,
    keywordAlphabet, keywordCipher,
    vigenere,
    playfairSquare, playfairPrepare, playfairPair, playfair,
    scytale,
    polybiusSquare, polybius,
    MORSE, morseEncode, morseDecode, morseTimings,
    pigpenGlyph, pigpenLetterFor,
  };
})();

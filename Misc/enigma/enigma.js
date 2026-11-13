"use strict";

/* ------------------------------------------------------------------ *
 * Enigma machine model — pure functions, no DOM.
 * Loaded by index.html (the simulator) and test.html (the self-test).
 *
 * Positions and ring settings are numbers 0–25 (A = 0). Rotor slots are
 * always listed left, middle, right; the right rotor is the fast one,
 * nearest the keyboard's entry wheel. The M4's thin fourth rotor sits to
 * the left of all three and never steps.
 * ------------------------------------------------------------------ */

const Enigma = (() => {
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const mod = (n, m) => ((n % m) + m) % m;
  const idx = (c) => ALPHA.indexOf(c);

  /* Wiring is where each contact A..Z on the right of the rotor comes out
   * on the left, with the ring at A. The notch letters are what shows in
   * the window when the rotor is about to carry the next one along. */
  const ROTORS = {
    I:     { wiring: "EKMFLGDQVZNTOWYHXUSPAIBRCJ", notch: "Q" },
    II:    { wiring: "AJDKSIRUXBLHWTMCQGZNPYFVOE", notch: "E" },
    III:   { wiring: "BDFHJLCPRTXVZNYEIWGAKMUSQO", notch: "V" },
    IV:    { wiring: "ESOVPZJAYQUIRHXLNFTGKDCMWB", notch: "J" },
    V:     { wiring: "VZBRGITYUPSDNHLXAWMJQOFECK", notch: "Z" },
    VI:    { wiring: "JPGVOUMFYQBENHZRDKASXLICTW", notch: "ZM" },
    VII:   { wiring: "NZJHGRCXMYSWBOUFAIVLPEKQDT", notch: "ZM" },
    VIII:  { wiring: "FKQHTLXOCBJSPDZRAMEWNIUYGV", notch: "ZM" },
    Beta:  { wiring: "LEYJVCNIXWPBQMDRTAKZGFUHOS", notch: "" },
    Gamma: { wiring: "FSOKANUERHMBTIYCWLQPZXVGJD", notch: "" },
  };

  const REFLECTORS = {
    A:        "EJMZALYXVBWFCRQUONTSPIKHGD",
    B:        "YRUHQSLDPXNGOKMIEBFZCWVJAT",
    C:        "FVPJIAOYEDRZXWGCTKUQSBNMHL",
    "B thin": "ENKQAUYWJICOPBLMDXZVFTHRGS",
    "C thin": "RDOBJNTKVEHMLFCWZAXGYIPSUQ",
  };

  const MODELS = {
    I: {
      name: "Enigma I",
      note: "Army and air force, from 1930. Five rotors to choose three from.",
      rotors: ["I", "II", "III", "IV", "V"],
      reflectors: ["A", "B", "C"],
      fourth: null,
      defaults: { rotors: ["I", "II", "III"], reflector: "B" },
    },
    M3: {
      name: "Enigma M3",
      note: "Navy, from 1934. Rotors VI–VIII were for the navy only and have two notches.",
      rotors: ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"],
      reflectors: ["B", "C"],
      fourth: null,
      defaults: { rotors: ["I", "II", "III"], reflector: "B" },
    },
    M4: {
      name: "Enigma M4",
      note: "U-boats, from 1942. A thin fourth rotor and a thin reflector fit where the reflector was.",
      rotors: ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"],
      reflectors: ["B thin", "C thin"],
      fourth: ["Beta", "Gamma"],
      defaults: { rotors: ["I", "II", "III"], reflector: "B thin", fourth: "Beta" },
    },
  };

  const FWD = {}, BWD = {};
  for (const [name, r] of Object.entries(ROTORS)) {
    FWD[name] = [...r.wiring].map(idx);
    BWD[name] = new Array(26);
    FWD[name].forEach((o, i) => { BWD[name][o] = i; });
  }
  const REFL = {};
  for (const [name, w] of Object.entries(REFLECTORS)) REFL[name] = [...w].map(idx);

  /* ---------------- plugboard ---------------- */

  /* "AV BS CG" -> { map, pairs, errors }. Any separators are fine; a
   * letter used twice or a pair of the same letter is reported and skipped. */
  function parsePlugs(text) {
    const map = [...Array(26).keys()];
    const pairs = [];
    const errors = [];
    const used = new Set();
    const tokens = String(text).toUpperCase().split(/[^A-Z]+/).filter(Boolean);
    for (const t of tokens) {
      if (t.length !== 2) { errors.push(`"${t}" is not a pair of letters`); continue; }
      const [a, b] = t;
      if (a === b) { errors.push(`${t} plugs a letter into itself`); continue; }
      if (used.has(a) || used.has(b)) { errors.push(`${t}: ${used.has(a) ? a : b} is already plugged in`); continue; }
      used.add(a); used.add(b);
      map[idx(a)] = idx(b);
      map[idx(b)] = idx(a);
      pairs.push(a + b);
    }
    return { map, pairs, errors };
  }

  function plugsFromPairs(pairs) {
    return parsePlugs(pairs.join(" ")).map;
  }

  /* ---------------- stepping ---------------- */

  const atNotch = (name, p) => ROTORS[name].notch.includes(ALPHA[p]);

  /* One key press. The right rotor always moves. A rotor sitting at its
   * notch carries the one to its left. The middle rotor, when at its own
   * notch, moves itself as well as the left rotor: the "double step". */
  function step(rotors, pos) {
    const [l, m, r] = pos;
    const midAt = atNotch(rotors[1], m);
    const rightAt = atNotch(rotors[2], r);
    let nl = l, nm = m;
    const nr = (r + 1) % 26;
    if (midAt) { nm = (m + 1) % 26; nl = (l + 1) % 26; }
    else if (rightAt) nm = (m + 1) % 26;
    return [nl, nm, nr];
  }

  /* ---------------- signal ---------------- */

  /* Through one rotor. c is the contact (0–25) on the fixed entry side;
   * the result is the fixed contact it leaves by. */
  function through(name, ring, pos, c, back) {
    const s = pos - ring;
    const w = back ? BWD[name] : FWD[name];
    return mod(w[mod(c + s, 26)] - s, 26);
  }

  /* Encipher one letter with the rotors already stepped.
   * cfg: { rotors: [L, M, R], rings: [L, M, R], reflector, fourth, fourthRing, plugs }
   * pos: [L, M, R]; fourthPos for the M4.
   * Returns the lamp and every contact the current passed through. */
  function signal(cfg, pos, fourthPos, key) {
    const plug = cfg.plugs || [...Array(26).keys()];
    const path = { key };
    let c = plug[key];               path.plugIn = c;
    c = through(cfg.rotors[2], cfg.rings[2], pos[2], c, false); path.r = c;
    c = through(cfg.rotors[1], cfg.rings[1], pos[1], c, false); path.m = c;
    c = through(cfg.rotors[0], cfg.rings[0], pos[0], c, false); path.l = c;
    if (cfg.fourth) { c = through(cfg.fourth, cfg.fourthRing || 0, fourthPos || 0, c, false); path.f = c; }
    c = REFL[cfg.reflector][c];      path.refl = c;
    if (cfg.fourth) { c = through(cfg.fourth, cfg.fourthRing || 0, fourthPos || 0, c, true); path.fBack = c; }
    c = through(cfg.rotors[0], cfg.rings[0], pos[0], c, true); path.lBack = c;
    c = through(cfg.rotors[1], cfg.rings[1], pos[1], c, true); path.mBack = c;
    c = through(cfg.rotors[2], cfg.rings[2], pos[2], c, true); path.rBack = c;
    c = plug[c];                     path.lamp = c;
    return path;
  }

  /* Press a key: step, then encipher. */
  function press(cfg, pos, fourthPos, key) {
    const next = step(cfg.rotors, pos);
    const path = signal(cfg, next, fourthPos, key);
    return { pos: next, path, lamp: path.lamp };
  }

  /* Whole message, for tests and auto-typing. Non-letters are skipped. */
  function encipher(cfg, pos, fourthPos, text) {
    let p = pos.slice();
    let out = "";
    for (const ch of String(text).toUpperCase()) {
      const k = idx(ch);
      if (k < 0) continue;
      const r = press(cfg, p, fourthPos, k);
      p = r.pos;
      out += ALPHA[r.lamp];
    }
    return { text: out, pos: p };
  }

  return {
    ALPHA, mod, idx,
    ROTORS, REFLECTORS, MODELS,
    parsePlugs, plugsFromPairs,
    atNotch, step, through, signal, press, encipher,
  };
})();

"use strict";

/* ------------------------------------------------------------------ *
 * Messages to decode. Only the plaintext and the key are stored; the
 * ciphertext is worked out by the machine when the page loads, so it
 * always matches. Settings are written the way a key sheet gave them:
 * rotors left to right, ring settings as numbers (01 = A), start
 * position as letters. The page never applies them for you.
 *
 * X stands for a space, as it did in real German messages.
 * ------------------------------------------------------------------ */

const CHALLENGES = {
  training: {
    title: "Training message",
    intro: "No plugboard and every ring at 01, so only the rotor order and start position matter. A good first go.",
    model: "I",
    fourth: null, fourthRing: 1,
    rotors: ["I", "II", "III"],
    rings: [1, 1, 1],
    reflector: "B",
    plugs: "",
    start: "CAT",
    plain: "HELLOXCLASSXIFXYOUXCANXREADXTHISXTHENXYOURXMACHINEXISXSETXUPXCORRECTLY",
  },
  weather: {
    title: "Weather report",
    intro: "A full army key: rotor order, ring settings, ten plugboard cables and a start position. Weather reports were a gift to Bletchley Park, because they were sent every day and always began the same way, so the codebreakers could guess the first words.",
    model: "I",
    fourth: null, fourthRing: 1,
    rotors: ["II", "V", "III"],
    rings: [12, 4, 19],
    reflector: "B",
    plugs: "AT BL DF GJ HM KN OP QY RZ UW",
    start: "QFT",
    plain: "WEATHERXREPORTXFORXTHEXCHANNELXWINDXSOUTHWESTXFORCEXFIVEXRAINXLATERXVISIBILITYXGOOD",
  },
  uboat: {
    title: "U-boat signal",
    intro: "The four-rotor naval machine. Switch to the M4, then set the thin rotor and its ring as well as the other three. The start position has four letters, thin rotor first. Breaking the M4 in 1942 took Bletchley Park ten months.",
    model: "M4",
    fourth: "Beta", fourthRing: 1,
    rotors: ["VII", "IV", "I"],
    rings: [15, 8, 21],
    reflector: "B thin",
    plugs: "BQ CR DI EJ KW MT OS PX UZ GH",
    start: "VJNA",
    plain: "CONVOYXSIGHTEDXGRIDXSQUAREXAJXNINEXSIXXCOURSEXEASTXSPEEDXNINEXKNOTSXSHADOWINGXREPORTXEVERYXHOUR",
  },
};

/* The machine settings a challenge stands for, in enigma.js's terms. */
function challengeConfig(ch) {
  return {
    rotors: ch.rotors.slice(),
    rings: ch.rings.map((n) => n - 1),
    reflector: ch.reflector,
    fourth: ch.fourth,
    fourthRing: ch.fourthRing - 1,
    plugs: Enigma.parsePlugs(ch.plugs).map,
  };
}

function challengeStart(ch) {
  const s = [...ch.start].map(Enigma.idx);
  return ch.fourth ? { fourthPos: s[0], pos: s.slice(1) } : { fourthPos: 0, pos: s };
}

function challengeCipher(ch) {
  const st = challengeStart(ch);
  return Enigma.encipher(challengeConfig(ch), st.pos, st.fourthPos, ch.plain).text;
}

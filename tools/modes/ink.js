"use strict";

// The look the three mode surfaces share.
//
// The switch banner, the rack (`ccfg mode list`) and the status view
// (`ccfg mode`) are meant to read as one object seen from three angles, so the
// colour of a cartridge, the frame drawn around a heading, and the gauge that
// shows where a dial sits are defined once here instead of three times. Drift
// between them would read as three separate tools rather than one.
//
// The chrome is ASCII, so a terminal with a plain font still draws the
// frames. The per-mode glyphs are the one exception: a reader recognises a
// shape faster than a word, and that is worth the risk of a font that has
// no glyph for it.

const ANSI = /\[[0-9;]*m/g;

/** How many terminal cells a string takes up, ignoring its colour codes. */
function visibleWidth(text) {
  return String(text).replace(ANSI, "").length;
}

/** Pad to a visible width, so a coloured cell lines up with a plain one. */
function pad(text, width) {
  return String(text) + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

/**
 * The ink for one mode: its own hue, plus the neutral weights.
 *
 * `plain` is the single switch for the whole surface. A piped stream,
 * NO_COLOR, or an explicit --plain sets it, and it turns every one of these
 * into the identity function, so no caller asks again whether colour is on.
 *
 * A mode with no colour of its own falls back to the fixed cyan the banner used
 * before modes carried hues, so a surface never loses its structure over a
 * missing field.
 */
function painter(plain, color) {
  const paint = (code, text) => (plain ? String(text) : `[${code}m${text}[0m`);
  return {
    bold: (text) => paint("1", text),
    dim: (text) => paint("2", text),
    green: (text) => paint("32", text),
    red: (text) => paint("31", text),
    yellow: (text) => paint("33", text),
    accent: (text) =>
      paint(
        color === null || color === undefined ? "36" : `38;5;${color}`,
        text,
      ),
  };
}

/**
 * A titled frame: the title sits in the top rule, the rows inside it.
 *
 * A row may carry a right-hand tag, pinned to the frame's right edge, so a
 * state word like CORRUPTED lands in the same column on every surface that
 * has one.
 *
 * The border is drawn dim rather than in the mode's hue. In the hue it added
 * three more lines of the same colour to a screen that already carried the mode
 * name, every changed value and the closing line in it, and a mode with a
 * strong colour came out as one flat wash. The hue is reserved for the
 * values that differ.
 */
function frame({ title, rows = [], width = 50, ink }) {
  const head = `- ${title} `;
  const lines = [
    ink.dim("+" + head + "-".repeat(Math.max(0, width - head.length)) + "+"),
  ];
  for (const row of rows) {
    const left = "  " + (row.left || "");
    const tag = row.right ? `${row.right} ` : "";
    const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(tag));
    lines.push(
      ink.dim("|") + left + " ".repeat(gap) + tag + ink.dim("|"),
    );
  }
  lines.push(ink.dim("+" + "-".repeat(width) + "+"));
  return lines.join("\n");
}

/**
 * Where a value sits on its dial, drawn as a bar one cell per step.
 *
 * Only for a dial that has an order. A dial whose values are alternatives
 * rather than levels gets no bar at all, because drawing one would claim a
 * ranking that does not exist. See `voice` in settings.js.
 */
function gauge(values, value, ink) {
  const position = values.indexOf(value);
  if (position === -1) return ink.dim(`[${"?".repeat(values.length)}]`);
  return (
    ink.dim("[") +
    ink.accent("#".repeat(position + 1)) +
    ink.dim("-".repeat(values.length - position - 1)) +
    ink.dim("]")
  );
}

module.exports = { painter, frame, gauge, pad, visibleWidth };

"use strict";

// The switch banner.
//
// It is a diff, not an announcement. A row whose value did not change renders
// with no arrow, so the eye lands on the three or four that did -- which is the
// only question anyone has at the moment of a switch. Making it pretty and
// making it informative turned out to be the same job.
//
// ASCII box drawing and no emoji: this prints into a terminal that may not be
// rendering a font with the glyphs, and a banner that degrades into replacement
// characters is worse than a plain one.

const settings = require("./settings.js");

const BOX_WIDTH = 50;
const LINE_WIDTH = 56;
const INDENT = "     ";
const NAME_COLUMN = 13;
const VALUE_COLUMN = 8;
const LABEL_COLUMN = 9;

function painter(plain, color) {
  const paint = (code, text) => (plain ? text : `[${code}m${text}[0m`);
  return {
    bold: (text) => paint("1", text),
    dim: (text) => paint("2", text),
    green: (text) => paint("32", text),
    // The mode's own hue, used everywhere the banner refers to the mode it is
    // switching to. A switch is then recognisable by colour before a word of it
    // is read. Falls back to the old fixed cyan for a mode with no colour set,
    // so a banner never loses its structure over a missing field.
    accent: (text) =>
      paint(color === null || color === undefined ? "36" : `38;5;${color}`, text),
  };
}

function box(ink) {
  const title = "- BREACH PROTOCOL ";
  return [
    ink.accent("+" + title + "-".repeat(BOX_WIDTH - title.length) + "+"),
    ink.accent("|") +
      ink.bold("  CARTRIDGE SWAP".padEnd(BOX_WIDTH)) +
      ink.accent("|"),
    ink.accent("+" + "-".repeat(BOX_WIDTH) + "+"),
  ].join("\n");
}

/** A label, its content, and a right-aligned tag pinned to the line width. */
function tagged(label, content, tag, ink) {
  const left = INDENT + label.padEnd(LABEL_COLUMN) + content;
  const gap = Math.max(1, LINE_WIDTH - left.length - tag.length);
  return left + " ".repeat(gap) + ink.dim(tag);
}

function settingRows(fromSettings, toSettings, ink) {
  return Object.keys(settings.SETTINGS).map((name) => {
    const before = fromSettings[name];
    const after = toSettings[name];
    const stem = INDENT + name.padEnd(NAME_COLUMN);
    if (before === after)
      return stem + " ".repeat(VALUE_COLUMN) + "    " + after;
    return (
      stem +
      ink.dim(String(before).padStart(VALUE_COLUMN)) +
      " -> " +
      ink.accent(after)
    );
  });
}

function hookRows(hooks, ink) {
  const core = (hooks.core || []).map((name) => name.replace(/\.js$/, ""));
  const disabled = (hooks.disabled || []).map((name) =>
    name.replace(/\.js$/, ""),
  );
  const rows = [
    tagged("hooks", ink.green(core.join(", ")), `[${core.length} core]`, ink),
  ];
  if (disabled.length > 0)
    rows.push(
      tagged(
        "",
        disabled.map((name) => `-${name}`).join(", "),
        `[${disabled.length} off]`,
        ink,
      ),
    );
  return rows;
}

function modelRow(projects, ink) {
  // A mode pins an effort level and nothing else -- the model is the operator's
  // choice. Labelling the row "model" and leaving it empty, which is what this
  // did once the pins were removed, said the opposite.
  if (projects.effortLevel === undefined) return [];
  return [
    INDENT + "effort".padEnd(LABEL_COLUMN) + ink.dim(projects.effortLevel),
  ];
}

function renderBanner({
  from,
  to,
  fromSettings,
  toSettings,
  ruleCounts,
  hooks = {},
  projects = {},
  icon = "",
  color = null,
  plain = false,
}) {
  const ink = painter(plain, color);
  const dashes = Math.max(3, 18 - String(from).length);
  const counts = `${ruleCounts.primary} primary, ${ruleCounts.standing} standing`;

  return [
    box(ink),
    "",
    INDENT +
      ink.dim(from) +
      " " +
      "-".repeat(dashes) +
      "> " +
      ink.accent(ink.bold((icon ? icon + " " : "") + String(to).toUpperCase())),
    "",
    ...settingRows(fromSettings, toSettings, ink),
    "",
    tagged("rules", counts, "(none dropped)", ink),
    ...hookRows(hooks, ink),
    ...modelRow(projects, ink),
    "",
    ink.accent(INDENT + "POWERING UP"),
    "",
  ].join("\n");
}

module.exports = { renderBanner };

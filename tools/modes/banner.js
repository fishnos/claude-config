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

function painter(plain) {
  const paint = (code, text) => (plain ? text : `[${code}m${text}[0m`);
  return {
    bold: (text) => paint("1", text),
    dim: (text) => paint("2", text),
    cyan: (text) => paint("36", text),
    green: (text) => paint("32", text),
    magenta: (text) => paint("1;35", text),
  };
}

function box(ink) {
  const title = "- BREACH PROTOCOL ";
  return [
    ink.cyan("+" + title + "-".repeat(BOX_WIDTH - title.length) + "+"),
    ink.cyan("|") +
      ink.bold("  CARTRIDGE SWAP".padEnd(BOX_WIDTH)) +
      ink.cyan("|"),
    ink.cyan("+" + "-".repeat(BOX_WIDTH) + "+"),
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
      ink.cyan(after)
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
  const model = projects.model
    ? String(projects.model).replace(/^claude-/, "")
    : null;
  if (model === null && projects.effortLevel === undefined) return [];
  const effort =
    projects.effortLevel === undefined
      ? ""
      : `    effort  ${projects.effortLevel}`;
  return [
    INDENT + "model".padEnd(LABEL_COLUMN) + (model || "") + ink.dim(effort),
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
  plain = false,
}) {
  const ink = painter(plain);
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
      ink.bold(String(to).toUpperCase()),
    "",
    ...settingRows(fromSettings, toSettings, ink),
    "",
    tagged("rules", counts, "(none dropped)", ink),
    ...hookRows(hooks, ink),
    ...modelRow(projects, ink),
    "",
    ink.magenta(INDENT + "POWERING UP"),
    "",
  ].join("\n");
}

module.exports = { renderBanner };

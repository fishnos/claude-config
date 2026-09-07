"use strict";

// The switch banner.
//
// It shows what changed rather than announcing what was loaded. A row whose
// value did not change renders with no arrow, so the reader lands on the
// three or four that did, which is what anyone wants at the moment of a
// switch.
//
// The frame, the colours and the gauges come from ink.js, which the rack and
// the status view draw from too, so the three surfaces keep one look.

const settings = require("./settings.js");
const ink = require("./ink.js");

const BOX_WIDTH = 50;
const LINE_WIDTH = 56;
const INDENT = "     ";
const NAME_COLUMN = 13;
const VALUE_COLUMN = 8;
const LABEL_COLUMN = 9;

/** A label, its content, and a right-aligned tag pinned to the line width. */
function tagged(label, content, tag, paint) {
  const left = INDENT + label.padEnd(LABEL_COLUMN) + content;
  const gap = Math.max(1, LINE_WIDTH - ink.visibleWidth(left) - tag.length);
  return left + " ".repeat(gap) + paint.dim(tag);
}

/** How many of the seven dials read differently between the two modes. */
function movedCount(fromSettings, toSettings) {
  return Object.keys(settings.SETTINGS).filter(
    (name) => fromSettings[name] !== toSettings[name],
  ).length;
}

function settingRows(fromSettings, toSettings, paint) {
  return Object.keys(settings.SETTINGS).map((name) => {
    const before = fromSettings[name];
    const after = toSettings[name];
    const stem = INDENT + name.padEnd(NAME_COLUMN);
    // A dial that held recedes whole, name included. At full weight all seven
    // rows carried the same volume as the three or four that moved.
    if (before === after)
      return paint.dim(stem + " ".repeat(VALUE_COLUMN) + "    " + after);
    return (
      stem +
      paint.dim(String(before).padStart(VALUE_COLUMN)) +
      " -> " +
      paint.accent(after)
    );
  });
}

function hookRows(hooks, paint) {
  const core = (hooks.core || []).map((name) => name.replace(/\.js$/, ""));
  const disabled = (hooks.disabled || []).map((name) =>
    name.replace(/\.js$/, ""),
  );
  const rows = [
    tagged(
      "hooks",
      paint.green(core.join(", ")),
      `[${core.length} core]`,
      paint,
    ),
  ];
  if (disabled.length > 0)
    rows.push(
      tagged(
        "",
        disabled.map((name) => `-${name}`).join(", "),
        `[${disabled.length} off]`,
        paint,
      ),
    );
  return rows;
}

function effortRow(projects, paint) {
  // A mode pins an effort level and nothing else; the model stays the
  // operator's choice. Labelling the row "model" and leaving it empty, which
  // is what this did once the pins were removed, said the opposite.
  if (projects.effortLevel === undefined) return [];
  return [
    INDENT + "effort".padEnd(LABEL_COLUMN) + paint.dim(projects.effortLevel),
  ];
}

/**
 * The switch banner, and the comparison that changes nothing.
 *
 * `applied` is the whole difference between the two. `ccfg mode ship` loads a
 * mode; `ccfg mode diff spike ship` only says what loading it would change.
 * Both used to print the same thing, headed CARTRIDGE SWAP and closed with
 * POWERING UP, which left the operator believing a comparison had switched
 * the mode.
 */
function renderBanner({
  from,
  to,
  toName,
  fromSettings,
  toSettings,
  ruleCounts,
  hooks = {},
  projects = {},
  icon = "",
  fromIcon = "",
  color = null,
  plain = false,
  applied = true,
}) {
  const paint = ink.painter(plain, color);
  const counts = `${ruleCounts.primary} primary, ${ruleCounts.standing} standing`;
  const moved = movedCount(fromSettings, toSettings);
  const total = Object.keys(settings.SETTINGS).length;

  const leaving =
    (fromIcon ? `${fromIcon} ` : "") + String(from).toUpperCase();
  const arriving = (icon ? `${icon} ` : "") + String(to).toUpperCase();
  const command = `ccfg mode ${String(toName || to).toLowerCase()}`;

  return [
    ink.frame({
      title: applied ? "CARTRIDGE SWAP" : "COMPARE",
      rows: [
        {
          left:
            paint.dim(leaving) +
            (applied ? "  ->  " : "  vs  ") +
            paint.accent(paint.bold(arriving)),
          right: paint.dim(
            `[${moved} of ${total} dials ${applied ? "moved" : "differ"}]`,
          ),
        },
      ],
      width: BOX_WIDTH,
      ink: paint,
    }),
    "",
    ...settingRows(fromSettings, toSettings, paint),
    "",
    tagged("rules", counts, "(none dropped)", paint),
    ...hookRows(hooks, paint),
    ...effortRow(projects, paint),
    "",
    applied
      ? paint.accent(INDENT + "POWERING UP")
      : paint.dim(`${INDENT}nothing applied. \`${command}\` loads ${to}`),
    "",
  ].join("\n");
}

module.exports = { renderBanner };

"use strict";

// The glitch layer: what a mode changes beyond the order of the rules.
//
// The seven dials only re-sort the corpus. A glitched mode goes further -- it
// hides skills, refuses tools, forbids subagents, and pins the model. Those are
// the things that make a mode "insanely good at one task with no distractions"
// rather than merely differently worded.
//
// Two facts from measurement shape this module, and neither is negotiable.
//
// FIRST: the layer splits by when it can take effect. Claude Code reads its
// configuration once, at session start, and freezes it -- two subagents spawned
// from a session that had edited CLAUDE.md hours earlier still reported the old
// text. So skills, model and effort cannot change inside a running session,
// while tools and subagents can, because a PreToolUse hook re-reads the lock on
// every call. A mode switched mid-session is therefore only half in force. That
// half-state is real, it is invisible without being told, and this module names
// it: CORRUPTED.
//
// SECOND: a glitched mode may only ever SUBTRACT. It can hide a skill the
// operator has on; it can never reveal one they turned off. It can refuse a
// tool the base config permits; it can never permit one the base config denies.
// Without that rule a mode file is a privilege-escalation vector -- talk the
// model into "switch to this mode" and it widens its own access. With it, the
// worst a hostile mode can do is make the model less capable.

const crypto = require("crypto");

// Tools no mode may refuse. Reading and thinking are how the model finds out it
// is in the wrong mode; a posture that cannot read cannot report its own
// mistake, and a mode that could gag the operator's own instructions would be
// unrecoverable from inside the session.
const UNGATEABLE_TOOLS = ["Read", "Glob", "Grep", "TodoWrite"];

/** Fields that only a new session can pick up. */
const HARD_FIELDS = ["skills", "model", "effortLevel", "commands"];

function fail(message) {
  return { error: message };
}

/**
 * Validate and normalise a mode's `glitch` block.
 *
 * Returns `{ error }` on anything malformed rather than throwing, because this
 * runs while listing modes and one bad file must not take the command down.
 */
function parseGlitch(value, sourcePath) {
  if (value === undefined || value === null)
    return {
      skills: null,
      tools: [],
      subagents: null,
      commands: [],
      projects: {},
      isGlitched: false,
    };
  if (typeof value !== "object" || Array.isArray(value))
    return fail(`${sourcePath}: glitch must be an object`);

  const skills = value.skills ?? null;
  if (skills !== null) {
    if (typeof skills !== "object" || Array.isArray(skills))
      return fail(`${sourcePath}: glitch.skills must be an object`);
    if (skills.only !== undefined && !Array.isArray(skills.only))
      return fail(`${sourcePath}: glitch.skills.only must be an array`);
    if (skills.off !== undefined && !Array.isArray(skills.off))
      return fail(`${sourcePath}: glitch.skills.off must be an array`);
    // `on` would let a mode reveal a skill the operator switched off, which is
    // the escalation this design forbids. Refused by name so the intent is
    // obvious to whoever wrote it.
    if (skills.on !== undefined)
      return fail(
        `${sourcePath}: glitch.skills.on is not allowed -- a mode may only hide skills, never reveal them`,
      );
    if (skills.only === undefined && skills.off === undefined)
      return fail(`${sourcePath}: glitch.skills needs 'only' or 'off'`);
  }

  const tools = value.tools ?? {};
  if (typeof tools !== "object" || Array.isArray(tools))
    return fail(`${sourcePath}: glitch.tools must be an object`);
  if (tools.allow !== undefined)
    return fail(
      `${sourcePath}: glitch.tools.allow is not allowed -- a mode may only deny tools, never grant them`,
    );
  const denied = tools.deny ?? [];
  if (!Array.isArray(denied))
    return fail(`${sourcePath}: glitch.tools.deny must be an array`);
  for (const tool of denied) {
    if (UNGATEABLE_TOOLS.includes(tool))
      return fail(
        `${sourcePath}: ${tool} cannot be gated -- the model must always be able to read and report`,
      );
  }

  const subagents = value.subagents ?? null;
  if (subagents !== null && subagents !== "none" && subagents !== "any")
    return fail(`${sourcePath}: glitch.subagents must be 'none' or 'any'`);

  const commands = value.commands ?? [];
  if (!Array.isArray(commands))
    return fail(`${sourcePath}: glitch.commands must be an array`);

  const projects = value.projects ?? {};
  if (typeof projects !== "object" || Array.isArray(projects))
    return fail(`${sourcePath}: glitch.projects must be an object`);

  return {
    skills,
    tools: denied,
    subagents,
    commands,
    projects,
    isGlitched:
      skills !== null ||
      denied.length > 0 ||
      subagents === "none" ||
      commands.length > 0 ||
      Object.keys(projects).length > 0,
  };
}

/**
 * Skill visibility for a mode, merged over what the operator already set.
 *
 * Subtract-only: an existing override is never loosened, and `only` hides
 * everything outside the list rather than revealing what is in it.
 */
function skillOverridesFor(glitch, installedSkills, baseOverrides) {
  const merged = { ...baseOverrides };
  if (glitch.skills === null) return merged;

  const keep = new Set(glitch.skills.only || []);
  const hide = new Set(glitch.skills.off || []);

  for (const skill of installedSkills) {
    const shouldHide =
      hide.has(skill) || (glitch.skills.only !== undefined && !keep.has(skill));
    if (shouldHide) merged[skill] = "off";
  }
  return merged;
}

/**
 * A fingerprint of everything only a new session can pick up.
 *
 * The lock stores this; a session records the one it started under. When they
 * differ the mode is half-applied, and saying so is the entire point.
 */
function hardHash(glitch, projects) {
  const payload = {
    skills: glitch.skills,
    commands: [...glitch.commands].sort(),
    model: (projects || {}).model ?? null,
    effortLevel: (projects || {}).effortLevel ?? null,
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 16);
}

/** What a mid-session switch cannot deliver until the session restarts. */
function staleFields(fromGlitch, toGlitch, fromProjects, toProjects) {
  const stale = [];
  if (JSON.stringify(fromGlitch.skills) !== JSON.stringify(toGlitch.skills))
    stale.push("skills");
  if ((fromProjects || {}).model !== (toProjects || {}).model)
    stale.push("model");
  if ((fromProjects || {}).effortLevel !== (toProjects || {}).effortLevel)
    stale.push("effort");
  if (
    JSON.stringify([...fromGlitch.commands].sort()) !==
    JSON.stringify([...toGlitch.commands].sort())
  )
    stale.push("commands");
  return stale;
}

module.exports = {
  UNGATEABLE_TOOLS,
  HARD_FIELDS,
  parseGlitch,
  skillOverridesFor,
  hardHash,
  staleFields,
};

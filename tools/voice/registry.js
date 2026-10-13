"use strict";

// Which skills are writing voices.
//
// The skills directory is the registry: a voice is any skills/<name>-voice
// whose SKILL.md says `kind: voice` under `metadata:`. There is no second list
// to go stale, so every caller reads the frontmatter again.
//
// The metadata block is parsed here and not by hooks/lib/skill-index.js,
// which flattens a nested block into one string because the catalogue only
// needs the description.

const fs = require("fs");
const path = require("path");

const VOICE_SUFFIX = "-voice";
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const HAND_BUILT = "hand-built";

function skillName(name) {
  return name.endsWith(VOICE_SUFFIX) ? name : `${name}${VOICE_SUFFIX}`;
}

function shortName(skill) {
  return skill.endsWith(VOICE_SUFFIX)
    ? skill.slice(0, -VOICE_SUFFIX.length)
    : skill;
}

function nameRejection(name) {
  if (typeof name !== "string" || name === "") return "no voice name given";
  if (!NAME_PATTERN.test(name))
    return (
      `'${name}' is not a usable voice name: lower-case letters, digits and ` +
      `hyphens only, starting with a letter or a digit`
    );
  return null;
}

/**
 * The owner is written into YAML frontmatter and into a one-line description,
 * so anything that would end the line or the scalar is refused rather than
 * escaped: an escaping rule is one more thing a hand edit can get wrong.
 */
function ownerRejection(owner) {
  if (typeof owner !== "string" || owner.trim() === "")
    return 'no owner given: --owner "Full Name"';
  const forbidden = owner.match(/[\r\n":#\\{}]/);
  if (forbidden !== null)
    return `an owner cannot contain ${JSON.stringify(forbidden[0])}`;
  return null;
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return String(JSON.parse(trimmed));
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'"))
    return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
}

/**
 * The frontmatter as lines that still carry their own line endings, so a
 * caller that inserts lines and joins them back changes no other byte.
 */
function inspect(text) {
  const lines = text.split(/(?<=\n)/);
  if (lines.length === 0 || lines[0].trim() !== "---") return null;
  const close = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (close === -1) return null;

  const start = lines.findIndex(
    (line, index) => index > 0 && index < close && /^metadata:/.test(line),
  );
  const metadata = {};
  let indent = "  ";
  let inline = false;
  if (start !== -1) {
    inline = lines[start].trim() !== "metadata:";
    for (let index = start + 1; index < close; index += 1) {
      const entry = /^(\s+)([A-Za-z_][\w-]*):(.*)$/.exec(
        lines[index].replace(/\r?\n$/, ""),
      );
      if (entry === null) break;
      if (Object.keys(metadata).length === 0) indent = entry[1];
      metadata[entry[2]] = unquote(entry[3]);
    }
  }
  return { lines, close, start, metadata, indent, inline };
}

function readMetadata(text) {
  const inspected = inspect(text);
  return inspected === null ? null : inspected.metadata;
}

function voiceDirectories(configDir) {
  try {
    return fs
      .readdirSync(path.join(configDir, "skills"))
      .filter((entry) => entry.endsWith(VOICE_SUFFIX))
      .sort();
  } catch {
    return [];
  }
}

function metadataOf(configDir, skill) {
  try {
    return readMetadata(
      fs.readFileSync(path.join(configDir, "skills", skill, "SKILL.md"), "utf8"),
    );
  } catch {
    return null;
  }
}

function listVoices(configDir) {
  const voices = [];
  for (const skill of voiceDirectories(configDir)) {
    const metadata = metadataOf(configDir, skill);
    if (metadata === null || metadata.kind !== "voice") continue;
    const directory = path.join(configDir, "skills", skill);
    voices.push({
      skill,
      name: shortName(skill),
      owner: metadata.owner || "",
      template: metadata.template || "",
      version: metadata.version || "",
      directory,
      file: path.join(directory, "SKILL.md"),
    });
  }
  return voices;
}

function unregisteredVoices(configDir) {
  return voiceDirectories(configDir).filter((skill) => {
    const metadata = metadataOf(configDir, skill);
    return metadata !== null && metadata.kind !== "voice";
  });
}

/**
 * Add the keys that mark a hand-built skill as a voice, and nothing else.
 *
 * Lines are inserted directly under `metadata:` so that every existing line,
 * its order and its line ending are left as found.
 */
function registerVoice(configDir, name, owner) {
  const skill = skillName(name);
  const nameProblem = nameRejection(shortName(skill));
  if (nameProblem !== null) throw new Error(nameProblem);
  const file = path.join(configDir, "skills", skill, "SKILL.md");
  if (!fs.existsSync(file))
    throw new Error(
      `no skill at skills/${skill}/SKILL.md. To start a new voice: ` +
        `ccfg voice new ${shortName(skill)} --owner "Full Name"`,
    );
  const rejection = ownerRejection(owner);
  if (rejection !== null) throw new Error(rejection);

  const inspected = inspect(fs.readFileSync(file, "utf8"));
  if (inspected === null)
    throw new Error(`${file} has no frontmatter block to add the keys to`);
  if (inspected.inline)
    throw new Error(
      `${file} writes metadata on one line. Put its keys on lines of their ` +
        `own under "metadata:" and run this again`,
    );
  if (inspected.metadata.kind === "voice")
    throw new Error(
      `${skill} is already registered as a voice (owner ` +
        `${inspected.metadata.owner || "not stated"})`,
    );
  if ("kind" in inspected.metadata)
    throw new Error(
      `${file} already says kind: ${inspected.metadata.kind}, which is not a voice`,
    );

  const lineEnding = inspected.lines[0].endsWith("\r\n") ? "\r\n" : "\n";
  const wanted = [
    ["kind", "voice"],
    ["owner", JSON.stringify(owner.trim())],
    ["template", JSON.stringify(HAND_BUILT)],
    ["version", '"0.1.0"'],
  ].filter(([key]) => !(key in inspected.metadata));
  const added = wanted.map(
    ([key, value]) => `${inspected.indent}${key}: ${value}${lineEnding}`,
  );

  const lines = [...inspected.lines];
  if (inspected.start === -1)
    lines.splice(inspected.close, 0, `metadata:${lineEnding}`, ...added);
  else lines.splice(inspected.start + 1, 0, ...added);
  fs.writeFileSync(file, lines.join(""));

  return { file, added: wanted.map(([key]) => key) };
}

module.exports = {
  HAND_BUILT,
  skillName,
  shortName,
  nameRejection,
  ownerRejection,
  readMetadata,
  listVoices,
  unregisteredVoices,
  registerVoice,
};

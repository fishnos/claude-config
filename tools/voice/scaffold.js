"use strict";

// Making a voice skill, and feeding one.
//
// Nothing here reads a sample or writes a rule: that is judgment, and it is
// done inside a session by the /voice-build skill. This module copies the
// empty skill into place, copies writing samples in, and numbers the next
// before-and-after file.
//
// The template is kept beside this file and never under skills/, where the
// catalogue builder would list it as a skill of its own.

const fs = require("fs");
const path = require("path");

const registry = require("./registry.js");

const TEMPLATE_VERSION = "1";
const TEMPLATE_DIRECTORY = path.join(__dirname, "template");
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function templateFiles(directory, prefix) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory())
      files.push(...templateFiles(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files.sort();
}

function fill(text, values) {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key) =>
    key in values ? values[key] : whole,
  );
}

function firstName(owner) {
  return owner.trim().split(/\s+/)[0];
}

/**
 * Every file the given paths name, checked before anything is copied.
 *
 * A directory gives the regular files directly inside it. It is not walked,
 * because a folder of writing often holds drafts and exports in subfolders
 * that were never meant as samples.
 */
function resolveSources(sources) {
  const found = [];
  for (const source of sources) {
    let stats;
    try {
      stats = fs.statSync(source);
    } catch {
      throw new Error(`no such file or directory: ${source}`);
    }
    if (stats.isDirectory()) {
      for (const entry of fs
        .readdirSync(source, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name)))
        if (entry.isFile() && !entry.name.startsWith("."))
          found.push({
            from: path.join(source, entry.name),
            name: entry.name,
            listedFromDirectory: true,
          });
    } else if (stats.isFile()) {
      found.push({ from: source, name: path.basename(source) });
    } else {
      throw new Error(`${source} is neither a file nor a directory`);
    }
  }
  const seen = new Set();
  for (const sample of found) {
    if (seen.has(sample.name))
      throw new Error(
        `${sample.name} is given twice. Samples are stored by file name, so ` +
          `rename one of them`,
      );
    seen.add(sample.name);
  }
  return found;
}

function samplesDirectory(skillDirectory) {
  return path.join(skillDirectory, "references", "samples");
}

function refuseTakenNames(skillDirectory, samples) {
  const taken = samples
    .map((sample) => sample.name)
    .filter((name) =>
      fs.existsSync(path.join(samplesDirectory(skillDirectory), name)),
    );
  if (taken.length > 0)
    throw new Error(
      `${samplesDirectory(skillDirectory)} already holds ${taken.join(", ")}. ` +
        `Nothing was copied. Rename the new file, or remove the old one first`,
    );
}

function copySamples(skillDirectory, samples) {
  fs.mkdirSync(samplesDirectory(skillDirectory), { recursive: true });
  for (const sample of samples)
    fs.copyFileSync(
      sample.from,
      path.join(samplesDirectory(skillDirectory), sample.name),
      fs.constants.COPYFILE_EXCL,
    );
  return samples.map((sample) => sample.name);
}

function existingVoiceDirectory(configDir, name) {
  const skill = registry.skillName(name);
  const nameProblem = registry.nameRejection(registry.shortName(skill));
  if (nameProblem !== null) throw new Error(nameProblem);
  const directory = path.join(configDir, "skills", skill);
  if (!fs.existsSync(path.join(directory, "SKILL.md")))
    throw new Error(
      `no voice skill at skills/${skill}. To start one: ` +
        `ccfg voice new ${registry.shortName(skill)} --owner "Full Name"`,
    );
  return { skill, directory };
}

function createVoice({ configDir, name, owner, sources }) {
  const skill = registry.skillName(name);
  const nameProblem = registry.nameRejection(registry.shortName(skill));
  if (nameProblem !== null) throw new Error(nameProblem);
  const ownerProblem = registry.ownerRejection(owner);
  if (ownerProblem !== null) throw new Error(ownerProblem);

  const directory = path.join(configDir, "skills", skill);
  if (fs.existsSync(directory))
    throw new Error(
      `skills/${skill} already exists. To add samples to it: ` +
        `ccfg voice add ${registry.shortName(skill)} FILE...`,
    );
  const files = templateFiles(TEMPLATE_DIRECTORY, "");
  const reservesName = (sample) =>
    files.includes(`references/samples/${sample.name}`);
  // A folder of writing may hold a README.md of its own. It was never named by
  // the user, so it is left out; one the user names is refused below.
  const samples = resolveSources(sources).filter(
    (sample) => !(sample.listedFromDirectory && reservesName(sample)),
  );
  const taken = samples.filter(reservesName);
  if (taken.length > 0)
    throw new Error(
      `a sample cannot be named ${taken[0].name}: the skill keeps a file of ` +
        `that name in its samples directory`,
    );

  const values = {
    SKILL: skill,
    NAME: registry.shortName(skill),
    OWNER: owner.trim(),
    FIRST_NAME: firstName(owner),
    TEMPLATE_VERSION,
  };
  for (const relative of files) {
    const destination = path.join(directory, ...relative.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(
      destination,
      fill(
        fs.readFileSync(
          path.join(TEMPLATE_DIRECTORY, ...relative.split("/")),
          "utf8",
        ),
        values,
      ),
    );
  }
  return { skill, directory, files, samples: copySamples(directory, samples) };
}

function addSamples({ configDir, name, sources }) {
  const { skill, directory } = existingVoiceDirectory(configDir, name);
  if (sources.length === 0)
    throw new Error("no sample files given: ccfg voice add NAME FILE...");
  const samples = resolveSources(sources);
  refuseTakenNames(directory, samples);
  return { skill, directory, samples: copySamples(directory, samples) };
}

function pairText(number, slug, today, ownerFirstName) {
  return [
    `# ${number}: ${slug}`,
    "",
    `**Date:** ${today}`,
    "**Genre:**",
    "",
    "## Claude's draft",
    "",
    "",
    `## ${ownerFirstName}'s rewrite`,
    "",
    "",
    "## What changed",
    "",
    "- One line per change, naming the move.",
    "",
  ].join("\n");
}

function startPair({ configDir, name, slug, today }) {
  const { skill, directory } = existingVoiceDirectory(configDir, name);
  const chosenSlug = slug === undefined || slug === null ? "untitled" : slug;
  if (!SLUG_PATTERN.test(chosenSlug))
    throw new Error(
      `'${chosenSlug}' is not a usable slug: lower-case letters, digits and ` +
        `hyphens only`,
    );

  const pairedDirectory = path.join(directory, "references", "paired");
  fs.mkdirSync(pairedDirectory, { recursive: true });
  const numbers = fs
    .readdirSync(pairedDirectory)
    .map((entry) => /^(\d{3,})-.*\.md$/.exec(entry))
    .filter((match) => match !== null)
    .map((match) => Number(match[1]));
  const number = String(
    numbers.length === 0 ? 1 : Math.max(...numbers) + 1,
  ).padStart(3, "0");

  const metadata = registry.readMetadata(
    fs.readFileSync(path.join(directory, "SKILL.md"), "utf8"),
  );
  const owner =
    metadata !== null && metadata.owner ? metadata.owner : "The owner";
  const file = path.join(pairedDirectory, `${number}-${chosenSlug}.md`);
  fs.writeFileSync(
    file,
    pairText(number, chosenSlug, today, firstName(owner)),
    {
      flag: "wx",
    },
  );
  return { skill, file, number };
}

module.exports = {
  TEMPLATE_VERSION,
  TEMPLATE_DIRECTORY,
  createVoice,
  addSamples,
  startPair,
};

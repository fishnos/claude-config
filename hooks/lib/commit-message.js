"use strict";

// Locating and checking the message of a `git commit` invocation.
//
// Kept separate from the guard so both halves can be tested directly: finding the
// message is string handling, judging it is policy, and they fail differently.

const fs = require("fs");
const path = require("path");

const MAX_MESSAGE_BYTES = 100000;

const SUBJECT_TARGET = 50;
const SUBJECT_CEILING = 72;
const BODY_WRAP = 72;

// Past this the body is almost certainly recounting what the diff already shows.
// A soft signal, not a rule -- some changes genuinely warrant a long explanation.
const BODY_LINES_BEFORE_REVIEW = 30;

const NON_IMPERATIVE =
  /^(added|adds|adding|fixed|fixes|fixing|updated|updates|updating|changed|changes|changing|removed|removes|removing|created|creates|creating|refactored|implemented)\b/i;

// Verbs that name the result rather than the work that produced it. "Stop the
// warning" describes what the reader will notice; it does not say what was
// touched, so it reads as a symptom report and sorts badly beside every other
// subject in the log. The effect belongs in a purpose clause after the change
// -- "Modify X to stop Y" -- or in the body, which has room for it.
const EFFECT_LED =
  /^(stop|prevent|avoid|ensure|allow|let|keep|leave|silence|disallow)\b/i;

// Forms where git composes the message itself, so there is nothing of the author's
// to judge: --fixup/--squash generate their own prefixes, -C/-c reuse another commit.
const GENERATED_MESSAGE =
  /--(fixup|squash|reuse-message|reedit-message)\b|(^|\s)-[Cc](\s|=)/;

/** Pull the quoted or bare value that follows a flag. */
function flagValue(segment, flags) {
  const pattern = new RegExp(
    `(?:^|\\s)(?:${flags})(?:=|\\s+)("([^"]*)"|'([^']*)'|([^\\s]+))`,
  );
  const match = pattern.exec(segment);
  if (!match) return null;
  if (match[2] !== undefined) return match[2];
  if (match[3] !== undefined) return match[3];
  return match[4] !== undefined ? match[4] : null;
}

/**
 * Return the commit message this command would use, or null when there is nothing
 * to check -- no message on the command line, a generated message, or a message
 * that will not exist until an editor or stdin supplies it.
 */
function extract(rawSegment, cwd) {
  if (GENERATED_MESSAGE.test(rawSegment)) return null;

  const inline = flagValue(rawSegment, "-m|--message");
  if (inline !== null) return { text: inline, source: "inline" };

  const file = flagValue(rawSegment, "-F|--file");
  if (file === null) return null;
  // `-F -` reads stdin, which has not been written at the time this hook runs.
  if (file === "-") return null;

  try {
    const resolved = path.isAbsolute(file) ? file : path.join(cwd, file);
    if (fs.statSync(resolved).size > MAX_MESSAGE_BYTES) return null;
    return { text: fs.readFileSync(resolved, "utf8"), source: "file" };
  } catch {
    // Unreadable or not yet written -- silence beats a false complaint.
    return null;
  }
}

/**
 * Judge a commit message against the conventions in the git-workflow skill.
 * Returns human-readable problems; an empty array means nothing to say.
 */
function lint(text) {
  const problems = [];
  // Comment lines are stripped by git before the message is stored.
  const lines = String(text)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !line.startsWith("#"));

  const subject = (lines[0] || "").trim();
  if (subject === "") {
    problems.push("Commit subject is empty.");
    return problems;
  }

  const subjectProblems = [];
  if (subject.length > SUBJECT_CEILING) {
    subjectProblems.push(
      `${subject.length} chars (target ${SUBJECT_TARGET}, hard ceiling ${SUBJECT_CEILING})`,
    );
  } else if (subject.length > SUBJECT_TARGET) {
    subjectProblems.push(`${subject.length} chars (target ${SUBJECT_TARGET})`);
  }
  if (subject.endsWith(".")) subjectProblems.push("trailing period");
  if (NON_IMPERATIVE.test(subject)) {
    subjectProblems.push('not imperative mood -- "Add", not "Added"/"Adds"');
  }
  const effectLed = EFFECT_LED.exec(subject);
  if (effectLed) {
    const verb = effectLed[1].toLowerCase();
    subjectProblems.push(
      `opens with the effect ("${effectLed[1]}") rather than the change -- ` +
        `name what was touched, then the effect ("Modify X to ${verb} Y")`,
    );
  }
  if (subjectProblems.length > 0) {
    problems.push(`Commit subject: ${subjectProblems.join("; ")}.`);
  }

  if (lines.length > 1 && lines[1].trim() !== "") {
    problems.push(
      "Second line must be blank. Git treats everything up to the first blank " +
        "line as the subject, so without it the whole message becomes one subject.",
    );
  }

  const body = lines.slice(2);

  // A line with no spaces cannot be wrapped -- a URL, a path, a hash.
  const overWide = body.filter(
    (line) => line.length > BODY_WRAP && /\s/.test(line.trim()),
  );
  if (overWide.length > 0) {
    problems.push(
      `${overWide.length} body line(s) exceed ${BODY_WRAP} chars. Git indents log ` +
        "output by four spaces, so wrapping keeps it readable in an 80-column terminal.",
    );
  }

  const substantive = body.filter((line) => line.trim() !== "").length;
  if (substantive > BODY_LINES_BEFORE_REVIEW) {
    problems.push(
      `Body is ${substantive} lines. A body earns its length by answering why the ` +
        "change was needed, why this approach over the alternative, and what is " +
        "still wrong or unverified. Anything describing how the code works belongs " +
        "in a comment or the README, which stay current when the code changes.",
    );
  }

  return problems;
}

module.exports = { extract, lint, BODY_LINES_BEFORE_REVIEW };

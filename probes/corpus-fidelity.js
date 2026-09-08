"use strict";

// Is every rule in the corpus still the text the operator actually wrote?
//
// The previous version of this probe asked whether 80% of a rule's *vocabulary*
// appeared somewhere in CLAUDE.md. That passes for a rule that has been
// substantially rewritten, because rules about testing and verification share
// most of their words with the rest of the file. It reported every rule healthy
// while seven had drifted and three sentences had been lost outright, including
// the clause stopping a skill from overriding the operator's own instructions.
//
// So this checks text, not vocabulary, and checks it both ways:
//
//   forward:  every sentence of every rule traces to the source
//   backward: every source sentence the corpus claims is carried in full
//
// Backward is the one that matters. A rule can be trimmed without ever failing
// a forward check, and a trimmed rule is a silently weakened instruction.
//
// It compares against modes/SOURCE-SNAPSHOT.md rather than the live CLAUDE.md,
// because the corpus was cut out of CLAUDE.md: the live file no longer contains
// the rules and can no longer answer the question.

const fs = require("fs");
const path = require("path");

const rules = require("../tools/modes/rules.js");

const norm = (text) => text.replace(/\s+/g, " ").trim();

/**
 * Fold the punctuation that carries no instruction.
 *
 * Every comparison below is an exact substring match, so a rule that swaps an
 * em dash for a comma would be reported as a sentence invented and a sentence
 * lost, neither of which happened. Dashes, commas, semicolons and colons are
 * therefore flattened to a space on both sides before matching. What survives
 * the fold is the words and their order, which is what "carried in full" means
 * and the only thing a weakened instruction can hide in.
 */
const fold = (text) =>
  norm(
    String(text)
      .replace(/\u2014|\u2013|--/g, " ")
      .replace(/[,;:]/g, " "),
  );

const strip = (text) =>
  norm(text)
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "");

/** Sentences long enough to be a claim rather than a fragment. */
function sentences(text) {
  return strip(text)
    .split(/(?<=[.!?])\s+(?=[A-Z`*\-"(])/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 24);
}

// Two sentences added during transcription that read as rationale for the rule
// they sit in rather than as new instruction. Listed explicitly so that any
// OTHER addition fails the probe: an allowance that is a wildcard is not an
// allowance, it is a disabled check.
const ALLOWED_ADDITIONS = [
  "A subagent that reports your change is correct has checked your reasoning, not the running code.",
  "Say which you actually ran.",
];

module.exports = {
  name: "corpus-fidelity",
  kind: "oracle",
  question:
    "Is every corpus rule still the exact text it was cut from, with nothing lost?",
  why: "The corpus was transcribed by hand and seven rules drifted without anything noticing. A rule that quietly loses a clause is a weakened instruction the operator still believes they have.",

  async run({ configDir }) {
    const snapshotPath = path.join(configDir, "modes", "SOURCE-SNAPSHOT.md");
    if (!fs.existsSync(snapshotPath))
      return {
        pass: false,
        answer: "no provenance snapshot",
        evidence: `${snapshotPath} is missing, so no rule can be traced to its source`,
      };

    const snapshot = fold(fs.readFileSync(snapshotPath, "utf8"));
    const corpus = rules.loadCorpus(path.join(configDir, "modes", "rules"));
    if (corpus.errors.length > 0)
      return {
        pass: false,
        answer: "the corpus does not load",
        evidence: corpus.errors.join("; "),
      };

    const added = [];
    for (const rule of corpus.rules) {
      for (const sentence of sentences(rule.body)) {
        if (snapshot.includes(fold(sentence))) continue;
        if (ALLOWED_ADDITIONS.some((allowed) => fold(allowed) === fold(sentence)))
          continue;
        added.push(`${rule.id}: ${sentence.slice(0, 80)}`);
      }
    }

    const joined = corpus.rules.map((rule) => fold(rule.body)).join("\n");
    const lost = [];
    const truncated = [];
    for (const line of fs.readFileSync(snapshotPath, "utf8").split("\n")) {
      const text = norm(line);
      if (text.length < 40 || text.startsWith("#") || text.startsWith("|")) continue;
      const parts = sentences(text);
      // A line the corpus claims: at least one of its sentences is carried.
      const claims = parts.some((piece) => joined.includes(fold(piece)));
      if (!claims) continue;
      for (const piece of parts) {
        if (joined.includes(fold(piece))) continue;
        let longest = 0;
        for (let end = piece.length; end > 24; end -= 1) {
          if (joined.includes(fold(piece.slice(0, end)))) {
            longest = end;
            break;
          }
        }
        if (longest >= 25) truncated.push(`...${piece.slice(longest, longest + 90)}`);
        else lost.push(piece.slice(0, 90));
      }
    }

    const problems = [
      ...lost.map((text) => `LOST ${text}`),
      ...truncated.map((text) => `TRUNCATED ${text}`),
      ...added.map((text) => `ADDED ${text}`),
    ];

    return {
      pass: problems.length === 0,
      answer:
        problems.length === 0
          ? `all ${corpus.rules.length} rules match their source exactly`
          : `${problems.length} discrepancies across ${corpus.rules.length} rules`,
      evidence:
        problems.length === 0
          ? "nothing lost, nothing truncated, nothing invented"
          : problems.join("\n       "),
    };
  },
};

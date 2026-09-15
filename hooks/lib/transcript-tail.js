"use strict";

// What the model last saw, read from the end of a session transcript.
//
// The context gauge reads this on every prompt and tools/context-report.js reads
// it across every transcript on disk. Both count the same way, or zone numbers
// tuned from the report would not describe what the gauge measures.

const fs = require("fs");

// A whole transcript passes 10 MB, and the gauge runs in front of every prompt.
const TAIL_BYTES = 256 * 1024;

function parseLines(text) {
  const entries = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // The first line of a tail is usually cut mid-record.
    }
  }
  return entries;
}

function readTail(file, byteCount) {
  let descriptor;
  try {
    descriptor = fs.openSync(file, "r");
    const size = fs.fstatSync(descriptor).size;
    const length = Math.min(size, byteCount);
    const buffer = Buffer.alloc(length);
    fs.readSync(descriptor, buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } catch {
    return "";
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function isCompactBoundary(entry) {
  return (
    Boolean(entry) &&
    entry.type === "system" &&
    entry.subtype === "compact_boundary"
  );
}

function contextTokens(entry) {
  if (!entry || entry.type !== "assistant" || entry.isSidechain === true)
    return null;
  const usage = entry.message && entry.message.usage;
  if (!usage) return null;
  return (
    (usage.input_tokens || 0) +
    (usage.cache_read_input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0)
  );
}

/**
 * Context size of the latest main-thread turn, or 0 when there is none.
 *
 * A compaction boundary after the last turn means the recorded size describes
 * history that no longer exists, so it reads as 0 until the next turn.
 */
function latestContextTokens(transcriptPath, byteCount = TAIL_BYTES) {
  if (!transcriptPath) return 0;
  const entries = parseLines(readTail(transcriptPath, byteCount));
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (isCompactBoundary(entries[index])) return 0;
    const tokens = contextTokens(entries[index]);
    if (tokens !== null) return tokens;
  }
  return 0;
}

/**
 * Peak context, turns over a threshold, and compactions for one transcript.
 *
 * The transcript writes one entry per content block and each repeats the
 * request's usage, so turns are counted once per request.
 */
function summarize(entries, thresholdTokens) {
  let peakTokens = 0;
  const requestsOver = new Set();
  const compactions = [];
  for (const entry of entries) {
    if (isCompactBoundary(entry)) {
      const metadata = entry.compactMetadata || {};
      compactions.push({
        trigger: metadata.trigger || "unknown",
        preTokens: metadata.preTokens || 0,
      });
      continue;
    }
    const tokens = contextTokens(entry);
    if (tokens === null) continue;
    if (tokens > peakTokens) peakTokens = tokens;
    if (tokens > thresholdTokens)
      requestsOver.add(entry.requestId || entry.uuid);
  }
  return { peakTokens, turnsOver: requestsOver.size, compactions };
}

/** Text of the latest main-thread assistant entry that carries any, or "". */
function latestAssistantText(transcriptPath, byteCount = TAIL_BYTES) {
  if (!transcriptPath) return "";
  const entries = parseLines(readTail(transcriptPath, byteCount));
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.type !== "assistant" || entry.isSidechain === true)
      continue;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((block) => block && block.type === "text")
      .map((block) => block.text)
      .join("\n");
    if (text.trim() !== "") return text;
  }
  return "";
}

module.exports = {
  TAIL_BYTES,
  parseLines,
  contextTokens,
  latestContextTokens,
  summarize,
  latestAssistantText,
};

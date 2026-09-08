"use strict";

// Executing a model probe: arms x tasks x repetitions, one file per cell.
//
// The isolation substrate is `claude -p --safe-mode --append-system-prompt-file`.
// safe-mode drops CLAUDE.md, skills, plugins, hooks and MCP while keeping auth,
// so an arm's prompt is the only instruction the model has. Without it every arm
// silently inherits the config under test, which is the thing being measured.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const runner = require("./runner.js");

/** Every cell a probe needs filled, in a stable order. */
function planCells(probe) {
  const cells = [];
  for (const arm of Object.keys(probe.arms)) {
    for (const task of probe.tasks) {
      for (let repetition = 1; repetition <= probe.reps; repetition += 1) {
        cells.push({ arm, taskId: task.id, repetition, task });
      }
    }
  }
  return cells;
}

function armPromptFile(temporaryDir, arm, text) {
  const file = path.join(temporaryDir, `arm-${arm}.txt`);
  fs.writeFileSync(file, text);
  return file;
}

/**
 * One cell, in a scratch directory.
 *
 * `--safe-mode` drops CLAUDE.md, skills, plugins, hooks and MCP, but it does not
 * change the working directory, and so a cell run from the config repo can read the
 * operator's uncommitted diff and answer from that instead of from the task. One
 * probe did exactly that and prefaced every reply with commentary on real files.
 */
function runCell(cell, promptFile, timeoutMs, scratchDir, userPrefix) {
  return new Promise((resolve) => {
    const args = ["-p", "--safe-mode"];
    // An empty arm is the control: no appended prompt at all, rather than an
    // empty file, which the CLI would still announce as an appended prompt.
    if (promptFile !== null) args.push("--append-system-prompt-file", promptFile);
    // Text an arm puts in front of the user's own message, which is where a
    // UserPromptSubmit hook lands its context. An arm testing that hook has to
    // inject where the hook injects: the same words in the system prompt sit at
    // a different position, and position is the thing under test.
    args.push(userPrefix ? `${userPrefix}\n\n${cell.task.prompt}` : cell.task.prompt);

    const child = spawn("claude", args, { encoding: "utf8", cwd: scratchDir });
    let stdout = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ output: null, reason: "timeout" });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ output: null, reason: error.message });
    });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stdout.trim() === "") return resolve({ output: null, reason: "empty" });
      resolve({ output: stdout, reason: null });
    });
  });
}

/**
 * Fill every empty cell, at most `parallelism` at a time.
 *
 * A contaminated cell is left unfilled rather than written, so the next run
 * retries it. Writing it and filtering later is how a limit notice ends up
 * graded as a trial.
 */
async function fill(probe, options) {
  const { configDir, parallelism, timeoutMs, io } = options;
  const directory = runner.resultsDir(configDir, probe.name);
  fs.mkdirSync(directory, { recursive: true });

  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-probe-arm-"));
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-probe-cwd-"));
  const promptFiles = {};
  for (const [arm, text] of Object.entries(probe.arms)) {
    promptFiles[arm] =
      text.trim() === "" ? null : armPromptFile(temporaryDir, arm, text);
  }

  const pending = planCells(probe).filter(
    (cell) =>
      !fs.existsSync(
        runner.cellPath(configDir, probe.name, cell.arm, cell.taskId, cell.repetition),
      ),
  );

  const tally = { written: 0, contaminated: 0, failed: 0 };
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < pending.length) {
      const cell = pending[cursor];
      cursor += 1;
      const { output, reason } = await runCell(
        cell,
        promptFiles[cell.arm],
        timeoutMs,
        scratchDir,
        probe.userPrefix ? probe.userPrefix[cell.arm] : undefined,
      );
      done += 1;

      if (output === null) {
        tally.failed += 1;
      } else if (runner.isContaminated(output)) {
        tally.contaminated += 1;
      } else {
        fs.writeFileSync(
          runner.cellPath(configDir, probe.name, cell.arm, cell.taskId, cell.repetition),
          output,
        );
        tally.written += 1;
      }

      if (done % 10 === 0 || done === pending.length) {
        io.progress(
          `  ${done}/${pending.length} cells  ` +
            `${tally.written} written  ${tally.contaminated} contaminated  ${tally.failed} failed`,
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(parallelism, pending.length) }, worker),
  );
  fs.rmSync(temporaryDir, { recursive: true, force: true });
  fs.rmSync(scratchDir, { recursive: true, force: true });
  return tally;
}

module.exports = { planCells, fill };

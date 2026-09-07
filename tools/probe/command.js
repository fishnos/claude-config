"use strict";

// `ccfg probe` -- behavioural checks against this config.
//
// Distinct from `ccfg test`, which runs unit suites over deterministic code.
// A probe asks one question about how the config actually behaves and answers it
// with evidence.

const os = require("os");
const path = require("path");

const probes = require("./probes.js");
const runner = require("./runner.js");
const model = require("./model.js");
const stats = require("./stats.js");
const report = require("./report.js");

// A run past this many cells asks first. Model probes spend real money and the
// interesting mistake is a typo in `reps` turning a 40-cell probe into 4,000.
const CONFIRM_ABOVE = 100;
const DEFAULT_PARALLELISM = 4;
const CELL_TIMEOUT_MS = 180000;

const CONFIG_DIR =
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const PROBE_DIR = path.join(CONFIG_DIR, "probes");

// Cheapest first: an oracle failure usually invalidates the assumption a model
// probe was about to spend an hour testing.
const KIND_ORDER = { oracle: 0, live: 1, model: 2 };

const VERDICT_STYLE = {
  PASS: (io) => io.ok,
  FAIL: (io) => io.problem,
  UNKNOWN: (io) => io.warn,
};

function loadProbes(io) {
  const { probes: loaded, errors } = probes.loadAll(PROBE_DIR);
  for (const error of errors) io.problem(error);
  loaded.sort(
    (left, right) =>
      KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
      left.name.localeCompare(right.name),
  );
  return loaded;
}

function commandList(io) {
  const loaded = loadProbes(io);
  io.heading("Probes");
  if (loaded.length === 0) {
    io.warn("no probes defined", `add one to ${PROBE_DIR}`);
    return;
  }
  for (const probe of loaded) {
    console.log(
      `  ${io.bold(probe.name.padEnd(20))} ${io.dim(probe.kind.padEnd(7))} ${probe.question}`,
    );
  }
  console.log(
    io.dim(
      "\n  run one:  ccfg probe run <name>       all:  ccfg probe run --all" +
        "\n  read it:  ccfg probe inspect <name>   reset: ccfg probe clean <name>",
    ),
  );
}

async function runModel(probe, io, flags) {
  // Before any budget is spent. A grader that cannot separate its own fixtures
  // produces a number, not a finding.
  const gate = runner.checkFixtures(probe);
  if (!gate.pass) {
    io.problem(`${probe.name}: ${gate.reason}`, "no cells were run");
    return "FAIL";
  }

  const planned = model.planCells(probe);
  const already = runner.readCells(CONFIG_DIR, probe.name).length;
  const remaining = planned.length - already;

  if (flags.dryRun) {
    io.ok(
      `${probe.name}  ${planned.length} cells (${Object.keys(probe.arms).length} arms x ${probe.tasks.length} tasks x ${probe.reps} reps)`,
      `${already} already filled, ${remaining} to run -- nothing spent`,
    );
    return "UNKNOWN";
  }

  if (remaining > CONFIRM_ABOVE && !flags.yes) {
    io.problem(
      `${probe.name}: ${remaining} cells is above the ${CONFIRM_ABOVE}-cell threshold`,
      "re-run with --yes once you have seen the count from --dry-run",
    );
    return "FAIL";
  }

  if (remaining > 0) {
    console.log(io.dim(`  filling ${remaining} cells, ${flags.parallelism} at a time`));
    const tally = await model.fill(probe, {
      configDir: CONFIG_DIR,
      parallelism: flags.parallelism,
      timeoutMs: CELL_TIMEOUT_MS,
      io,
    });
    if (tally.contaminated > 0)
      io.warn(
        `${tally.contaminated} cells held a platform limit notice and were discarded`,
        "re-run to fill them; they were not graded",
      );
  }

  const cells = runner.readCells(CONFIG_DIR, probe.name);
  const byArm = new Map(
    Object.keys(probe.arms).map((arm) => [
      arm,
      { name: arm, hits: 0, trials: 0, declined: 0 },
    ]),
  );
  for (const cell of cells) {
    const arm = byArm.get(cell.arm);
    if (arm === undefined) continue;
    const task = probe.tasks.find((candidate) => candidate.id === cell.taskId);
    const graded = probe.grade(cell.output, task ? task.fixture || "" : "");
    // A model that declined the task produced no artifact to judge. Counting the
    // refusal as a violation scores a rule for working: the arm that correctly
    // refused to invent details it was not given came out looking worse than the
    // arm that invented them.
    if (graded.declined === true) {
      arm.declined += 1;
      continue;
    }
    arm.trials += 1;
    if (graded.violations.length > 0) arm.hits += 1;
  }

  const armResults = [...byArm.values()];
  const control = armResults.find((arm) => arm.name === probe.control);
  const best = armResults
    .filter((arm) => arm.name !== probe.control)
    .sort((left, right) => left.hits / (left.trials || 1) - right.hits / (right.trials || 1))[0];
  const test =
    control && best
      ? stats.twoProportion(best.hits, best.trials, control.hits, control.trials)
      : { p: 1 };

  const decision = report.verdict({
    cells: planned.length,
    filled: cells.length,
    fixturesPassed: true,
    p: test.p,
  });

  console.log(`\n  ${io.bold(probe.name)}  ${io.dim(probe.question)}`);
  if (decision === "INCOMPLETE") {
    io.problem(
      `INCOMPLETE -- ${cells.length}/${planned.length} cells filled`,
      "a partial run is not a weak result; re-run to fill the rest",
    );
    return "FAIL";
  }
  console.log(report.table(armResults, probe.control, stats, io));
  console.log(
    `  ${decision === "RESULT" ? io.bold(decision) : decision}` +
      io.dim(`   read the raw output before acting: ccfg probe inspect ${probe.name}`),
  );
  return decision === "RESULT" ? "PASS" : "UNKNOWN";
}

async function runOne(probe, io, flags) {
  if (probe.kind === "model") return runModel(probe, io, flags);

  let outcome;
  try {
    outcome = await probe.run({ configDir: CONFIG_DIR, io });
  } catch (error) {
    io.problem(`${probe.name}: threw`, error.message);
    return "FAIL";
  }

  // `pass: null` means the probe ran and reports a number rather than a
  // judgement. Collapsing that into FAIL would turn "here is the count" into
  // "something is broken".
  const verdict =
    outcome.pass === true ? "PASS" : outcome.pass === null ? "UNKNOWN" : "FAIL";

  VERDICT_STYLE[verdict](io)(
    `${probe.name}  ${io.dim(outcome.answer || "")}`,
    verdict === "PASS" ? undefined : outcome.evidence,
  );
  if (verdict === "PASS" && outcome.evidence)
    console.log(`       ${io.dim(outcome.evidence)}`);
  return verdict;
}

async function commandRun(argv, io) {
  const loaded = loadProbes(io);
  const flags = {
    dryRun: argv.includes("--dry-run"),
    yes: argv.includes("--yes"),
    parallelism: argv.includes("--parallel")
      ? Number(argv[argv.indexOf("--parallel") + 1])
      : DEFAULT_PARALLELISM,
  };
  const wantedKind = argv.includes("--kind")
    ? argv[argv.indexOf("--kind") + 1]
    : null;
  const all = argv.includes("--all") || wantedKind !== null;
  // Drop the values belonging to flags that take one, so `--parallel 6` does
  // not leave `6` looking like a probe name.
  const flagValues = new Set();
  for (const withValue of ["--kind", "--parallel"]) {
    const at = argv.indexOf(withValue);
    if (at !== -1 && argv[at + 1] !== undefined) flagValues.add(argv[at + 1]);
  }
  const named = argv.filter(
    (argument) => !argument.startsWith("--") && !flagValues.has(argument),
  );

  let selected;
  if (all) {
    selected = wantedKind
      ? loaded.filter((probe) => probe.kind === wantedKind)
      : loaded;
  } else if (named.length > 0) {
    selected = loaded.filter((probe) => named.includes(probe.name));
    const unknown = named.filter(
      (name) => !loaded.some((probe) => probe.name === name),
    );
    for (const name of unknown) {
      console.error(`unknown probe: ${name}`);
      process.exitCode = 2;
    }
  } else {
    commandList(io);
    return;
  }

  if (selected.length === 0) return;

  io.heading(`Running ${selected.length} probe(s)`);
  const tally = { PASS: 0, FAIL: 0, UNKNOWN: 0 };
  for (const probe of selected) {
    tally[await runOne(probe, io, flags)] += 1;
  }

  console.log(
    `\n  ${io.bold(String(tally.PASS))} pass  ` +
      `${tally.FAIL > 0 ? io.bold(String(tally.FAIL)) : "0"} fail  ` +
      `${tally.UNKNOWN} unknown`,
  );
  if (tally.FAIL > 0) process.exitCode = 1;
}

/**
 * Raw model output from the arms that matter, with the grader's verdict beside it.
 *
 * The report tells the reader to do this and, until now, gave them no way to.
 * Every wrong finding this config has produced survived because the numbers were
 * read and the text was not: a grader blind to the violation, a grader linting a
 * refusal as if it were an answer. Both were obvious in one cell.
 */
function commandInspect(argv, io) {
  const loaded = loadProbes(io);
  const [name] = argv.filter((argument) => !argument.startsWith("--"));
  const probe = loaded.find((candidate) => candidate.name === name);
  if (probe === undefined) {
    console.error(`unknown probe: ${name}`);
    process.exit(2);
  }

  const perArm = argv.includes("--count")
    ? Number(argv[argv.indexOf("--count") + 1])
    : 3;
  const cells = runner.readCells(CONFIG_DIR, probe.name);
  if (cells.length === 0) {
    io.warn(`${probe.name}: no cells recorded`, `run it first`);
    return;
  }

  for (const arm of Object.keys(probe.arms)) {
    const mine = cells.filter((cell) => cell.arm === arm);
    const graded = mine.map((cell) => {
      const task = probe.tasks.find((candidate) => candidate.id === cell.taskId);
      return { cell, result: probe.grade(cell.output, task ? task.fixture || "" : "") };
    });
    const violating = graded.filter((entry) => entry.result.violations.length > 0);
    const clean = graded.filter(
      (entry) => entry.result.violations.length === 0 && entry.result.declined !== true,
    );

    io.heading(`${arm}  --  ${violating.length} violating, ${clean.length} clean, ${mine.length} cells`);
    // Both ends, always. Reading only the failures is how a grader that flags
    // everything looks like a strong effect.
    for (const [label, group] of [["VIOLATING", violating], ["CLEAN", clean]]) {
      for (const entry of group.slice(0, perArm)) {
        console.log(
          `\n  ${io.bold(label)} ${io.dim(entry.cell.taskId + " #" + entry.cell.repetition)}` +
            (entry.result.violations.length > 0
              ? `\n  ${io.yellow(entry.result.violations.join("; ").slice(0, 160))}`
              : ""),
        );
        console.log(
          entry.cell.output
            .trim()
            .split("\n")
            .slice(0, 14)
            .map((line) => `    ${line}`)
            .join("\n"),
        );
      }
    }
  }
}

function commandProbe(argv, io) {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || subcommand === "list") return commandList(io);
  if (subcommand === "run") return commandRun(rest, io);
  if (subcommand === "inspect") return commandInspect(rest, io);
  if (subcommand === "clean") {
    const [name] = rest;
    if (name === undefined) {
      console.error("usage: ccfg probe clean <name>");
      process.exit(2);
    }
    require("fs").rmSync(runner.resultsDir(CONFIG_DIR, name), {
      recursive: true,
      force: true,
    });
    io.ok(`discarded recorded cells for ${name}`);
    return;
  }
  console.error(`unknown: probe ${subcommand}`);
  process.exit(2);
}

module.exports = { commandProbe };

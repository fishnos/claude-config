// Grades every trial in out/ with the config's own commit-message linter.
// No LLM judge: lint() is pure and returns an array of problem strings.
const fs = require("fs");
const path = require("path");
const { lint } = require(path.join(process.env.HOME, ".claude/hooks/lib/commit-message.js"));

const OUT = path.join(__dirname, "out");

// The prompt forbids fences; strip them anyway so we grade the message, not
// the packaging. Whether a fence appeared is recorded separately.
function unwrap(raw) {
  let text = raw.trim();
  let fenced = false;
  const fence = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/);
  if (fence) { text = fence[1].trim(); fenced = true; }
  return { text, fenced };
}

const rows = [];
for (const file of fs.readdirSync(OUT).filter((f) => f.endsWith(".txt"))) {
  const [task, arm, rep] = file.replace(/\.txt$/, "").split("__");
  const raw = fs.readFileSync(path.join(OUT, file), "utf8");
  if (raw.trim() === "") continue;
  const { text, fenced } = unwrap(raw);
  const problems = lint(text);
  rows.push({ task, arm, rep, fenced, problems, count: problems.length, clean: problems.length === 0 });
}

const arms = [...new Set(rows.map((r) => r.arm))].sort();
const summary = arms.map((arm) => {
  const inArm = rows.filter((r) => r.arm === arm);
  const clean = inArm.filter((r) => r.clean).length;
  const total = inArm.reduce((sum, r) => sum + r.count, 0);
  return {
    arm,
    trials: inArm.length,
    clean,
    cleanRate: inArm.length ? clean / inArm.length : 0,
    problemsPerTrial: inArm.length ? total / inArm.length : 0,
    fenced: inArm.filter((r) => r.fenced).length,
  };
});

// Which checks fire, by arm -- this is where the interesting signal lives.
const kind = (p) =>
  /not imperative/.test(p) ? "non-imperative"
  : /opens with the effect/.test(p) ? "effect-led"
  : /counts what it will not name/.test(p) ? "counted-placeholder"
  : /stands in for the thing/.test(p) ? "vague-referent"
  : /trailing period/.test(p) ? "trailing-period"
  : /chars \(target/.test(p) ? "subject-too-long"
  : /Second line must be blank/.test(p) ? "no-blank-line"
  : /body line\(s\) exceed/.test(p) ? "body-too-wide"
  : /Body is \d+ lines/.test(p) ? "body-too-long"
  : "other";

const breakdown = {};
for (const r of rows) for (const p of r.problems) {
  const k = kind(p);
  breakdown[k] = breakdown[k] || {};
  breakdown[k][r.arm] = (breakdown[k][r.arm] || 0) + 1;
}

console.log("\narm       trials  clean  clean%   problems/trial  fenced");
for (const s of summary) {
  console.log(
    `${s.arm.padEnd(9)} ${String(s.trials).padStart(5)} ${String(s.clean).padStart(6)} ` +
    `${(s.cleanRate * 100).toFixed(0).padStart(6)}% ${s.problemsPerTrial.toFixed(2).padStart(15)} ` +
    `${String(s.fenced).padStart(7)}`,
  );
}
console.log("\ncheck                    " + arms.map((a) => a.padStart(8)).join(""));
for (const [k, byArm] of Object.entries(breakdown).sort()) {
  console.log(k.padEnd(24) + arms.map((a) => String(byArm[a] || 0).padStart(8)).join(""));
}
fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify({ summary, breakdown, rows }, null, 2));
console.log(`\n${rows.length} trials graded -> results.json`);

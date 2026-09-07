const { rows } = require("./results.json");

const pick = (arm) => rows.filter((r) => r.arm === arm);
const rate = (rs) => rs.filter((r) => r.clean).length / rs.length;

// Normal approximation to the difference of two proportions.
function ztest(a, b) {
  const [xa, na] = [a.filter((r) => r.clean).length, a.length];
  const [xb, nb] = [b.filter((r) => r.clean).length, b.length];
  const pa = xa / na, pb = xb / nb;
  const pooled = (xa + xb) / (na + nb);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / na + 1 / nb));
  const z = (pa - pb) / se;
  // Abramowitz-Stegun 7.1.26 erf approximation.
  const erf = (x) => {
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
      - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  };
  const p = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
  // Unpooled SE for the CI on the difference.
  const seDiff = Math.sqrt((pa * (1 - pa)) / na + (pb * (1 - pb)) / nb);
  return { pa, pb, diff: pa - pb, z, p, ci: [pa - pb - 1.96 * seDiff, pa - pb + 1.96 * seDiff] };
}

const cmp = (x, y) => {
  const r = ztest(pick(x), pick(y));
  console.log(
    `${x} (${(r.pa * 100).toFixed(1)}%) vs ${y} (${(r.pb * 100).toFixed(1)}%)  ` +
    `diff ${(r.diff * 100).toFixed(1)}pp  95% CI [${(r.ci[0] * 100).toFixed(1)}, ${(r.ci[1] * 100).toFixed(1)}]  ` +
    `z=${r.z.toFixed(2)}  p=${r.p < 0.0001 ? "<0.0001" : r.p.toFixed(4)}`,
  );
};

console.log("\n=== clean-rate contrasts ===");
cmp("scoped", "full");
cmp("full", "bare");
cmp("scoped", "bare");

console.log("\n=== per task: clean rate, scoped vs full ===");
console.log("task            scoped    full   delta");
const tasks = [...new Set(rows.map((r) => r.task))].sort();
let wins = 0;
for (const t of tasks) {
  const s = rate(rows.filter((r) => r.arm === "scoped" && r.task === t));
  const f = rate(rows.filter((r) => r.arm === "full" && r.task === t));
  if (s > f) wins++;
  console.log(`${t.padEnd(14)} ${(s * 100).toFixed(0).padStart(6)}% ${(f * 100).toFixed(0).padStart(6)}% ${((s - f) * 100).toFixed(0).padStart(6)}pp`);
}
console.log(`\nscoped beats full on ${wins}/${tasks.length} tasks`);

#!/usr/bin/env node
'use strict';

// End-to-end validation of the ~/.claude config: every hook parses and runs, every
// claim the docs make is true, and nothing references a file that no longer exists.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(os.homedir(), '.claude');
let failures = 0;

function check(label, ok, detail) {
  console.log(`[${ok ? 'PASS' : '**FAIL**'}] ${label}`);
  if (!ok) {
    failures += 1;
    if (detail) console.log(`         ${detail}`);
  }
}

function section(title) {
  console.log(`\n--- ${title}`);
}

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

section('Syntax and imports');
const jsFiles = [
  'hooks/git-guard.js',
  'hooks/style-check.js',
  'hooks/review-reminder.js',
  'hooks/test-hooks.js',
  'hooks/lib/hook-io.js',
  'hooks/lib/paths.js',
  'hooks/lib/commit-message.js',
  'hooks/notify.js',
  'hooks/format.js',
];
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', path.join(ROOT, file)], {
    encoding: 'utf8',
  });
  check(`${file} parses`, result.status === 0, result.stderr);
}
for (const file of ['hooks/lib/hook-io.js', 'hooks/lib/paths.js', 'hooks/lib/commit-message.js']) {
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(ROOT, file))})`], {
    encoding: 'utf8',
  });
  check(`${file} loads`, result.status === 0, result.stderr);
}

section('settings.json');
let settings;
try {
  settings = JSON.parse(read('settings.json'));
  check('settings.json is valid JSON', true);
} catch (error) {
  check('settings.json is valid JSON', false, error.message);
  settings = { hooks: {} };
}
const hookCommands = Object.values(settings.hooks || {})
  .flat()
  .flatMap((group) => group.hooks || [])
  .map((hook) => hook.command);
check('every hook command is node-based', hookCommands.every((c) => c.startsWith('node ')),
  hookCommands.filter((c) => !c.startsWith('node ')).join(' | '));
check('no hook references python', !hookCommands.some((c) => /python/i.test(c)));
check('no hook uses $HOME or ~', !hookCommands.some((c) => c.includes('$HOME') || c.includes('~/')));

section('Referenced hook scripts exist');
for (const command of hookCommands) {
  const named = /'([\w.-]+\.js)'/.exec(command);
  if (!named) continue;
  const target = path.join(ROOT, 'hooks', named[1]);
  check(`hooks/${named[1]} exists`, fs.existsSync(target));
}

section('Hook behaviour end to end (through the real bootstrap)');
function invoke(script, payload) {
  const boot =
    `const p=require('path'),d=process.env.CLAUDE_CONFIG_DIR||p.join(require('os').homedir(),'.claude');` +
    `require(p.join(d,'hooks','${script}'))`;
  const result = spawnSync(process.execPath, ['-e', boot], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 20000,
  });
  try {
    return JSON.parse((result.stdout || '').trim() || '{}');
  } catch {
    return {};
  }
}
const denied = invoke('git-guard.js', {
  tool_name: 'Bash',
  cwd: os.tmpdir(),
  tool_input: { command: 'git' + ' push origin main' },
});
check('guard denies a push via bootstrap',
  denied.hookSpecificOutput && denied.hookSpecificOutput.permissionDecision === 'deny');
const allowed = invoke('git-guard.js', {
  tool_name: 'Bash',
  cwd: os.tmpdir(),
  tool_input: { command: 'git status' },
});
check('guard stays silent on git status', !allowed.hookSpecificOutput);

section('Regression suite');
const suite = spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'test-hooks.js')], {
  encoding: 'utf8',
  timeout: 300000,
});
const summary = /PASS (\d+)\s+FAIL (\d+)/.exec(suite.stdout || '');
check('suite exits zero', suite.status === 0, (suite.stderr || '').slice(0, 300));
check('suite has zero failures', summary !== null && summary[2] === '0', summary ? summary[0] : 'no summary');
const suiteCount = summary ? Number(summary[1]) : 0;
console.log(`         ${suiteCount} cases`);

section('Docs match reality');
const readme = read('README.md');
const claimed = /— (\d+) cases/.exec(readme);
check('README case count matches the suite', claimed !== null && Number(claimed[1]) === suiteCount,
  `README says ${claimed ? claimed[1] : '?'}, suite ran ${suiteCount}`);
check('README has no stale .py references', !/hooks\/[\w-]+\.py|test_hooks\.py/.test(readme));
check('README no longer claims POSIX-only', !/POSIX only/.test(readme));
for (const anchor of ['Engineering standards', 'Pushing']) {
  check(`README section "${anchor}" exists`, new RegExp(`^## ${anchor}`, 'm').test(readme));
}
const claudeMd = read('CLAUDE.md');
check('CLAUDE.md keeps the never-push rule', /Never commit, never push/.test(claudeMd));
check('CLAUDE.md carries the three-questions rule', /answers three questions/.test(claudeMd));
check('git-workflow carries the three-questions rule',
  /earns its length by answering three questions/.test(read('skills/git-workflow/SKILL.md')));

section('Skills resolve from both paths');
const skills = [
  'google-code-review', 'google-cl-author', 'google-style', 'google-testing',
  'react-testing', 'git-workflow', 'ros2-testing',
];
for (const skill of skills) {
  const tracked = path.join(ROOT, 'skills', skill, 'SKILL.md');
  const shared = path.join(os.homedir(), '.agents', 'skills', skill, 'SKILL.md');
  const realDirectory = fs.existsSync(tracked) && !fs.lstatSync(path.join(ROOT, 'skills', skill)).isSymbolicLink();
  check(`${skill}: real dir in repo + reachable via ~/.agents`,
    realDirectory && fs.existsSync(shared));
}

section('Prepared commit messages lint clean');
const messageDir = path.join(ROOT, '.commit-msgs');
if (fs.existsSync(messageDir)) {
  const { lint } = require(path.join(ROOT, 'hooks', 'lib', 'commit-message.js'));
  for (const name of fs.readdirSync(messageDir).sort()) {
    const problems = lint(fs.readFileSync(path.join(messageDir, name), 'utf8'));
    check(`${name} passes its own linter`, problems.length === 0, problems.join(' | '));
  }
}

section('No secrets stageable');
const grep = spawnSync('git', ['-C', ROOT, 'grep', '-nE', '\\bAKIA[0-9A-Z]{16}\\b', '--', '.'], {
  encoding: 'utf8',
});
check('no live-looking AWS key in tracked files', !grep.stdout || grep.stdout.trim() === '',
  (grep.stdout || '').slice(0, 200));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

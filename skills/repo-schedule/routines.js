#!/usr/bin/env node
"use strict";

// Reconcile a repository's committed routine declarations against the routines
// actually live on the account.
//
// Routines exist only in the cloud: nothing in a repository records what is
// scheduled against it, they are not shared with teammates, and a fresh clone
// carries no trace of them. This turns `.claude/routines/*.md` into the source
// of truth and computes the exact difference, so the caller performs a decided
// list of API calls rather than improvising against a live account.
//
// The diff is computed here; the API calls belong to the caller, which reaches
// the account through the RemoteTrigger tool.

const fs = require("fs");
const path = require("path");

const configDir =
  process.env.CLAUDE_CONFIG_DIR || path.resolve(__dirname, "..", "..");
const repoAudit = require(path.join(configDir, "hooks", "lib", "repo-audit"));

// Routines are named `<repo>: <declaration>` on the account. The prefix is what
// makes ownership decidable: without it a reconciliation cannot tell a routine
// this repo stopped declaring from one belonging to another repo or created by
// hand, and would propose disabling routines it never owned.
function remoteName(repositoryName, declarationName) {
  return `${repositoryName}: ${declarationName}`;
}

/**
 * Frontmatter parser covering the subset a routine declaration uses: scalars,
 * inline `[a, b]` lists, and block `- item` lists. A real YAML parser would be
 * a dependency for three shapes, and an unsupported shape must fail loudly
 * rather than parse into something subtly different.
 */
function parseFrontmatter(text, file) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (match === null) {
    throw new Error(`${file}: missing --- frontmatter block`);
  }
  const fields = {};
  let currentListKey = null;
  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.replace(/\s+#.*$/, "").trimEnd();
    if (line.trim() === "") continue;

    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem !== null) {
      if (currentListKey === null) {
        throw new Error(`${file}: list item outside any key: ${line}`);
      }
      fields[currentListKey].push(unquote(listItem[1]));
      continue;
    }

    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (pair === null) throw new Error(`${file}: cannot parse line: ${line}`);
    const [, key, rawValue] = pair;
    const value = rawValue.trim();
    if (value === "") {
      fields[key] = [];
      currentListKey = key;
      continue;
    }
    currentListKey = null;
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      fields[key] = inner === "" ? [] : inner.split(",").map((v) => unquote(v));
    } else if (value === "true" || value === "false") {
      fields[key] = value === "true";
    } else {
      fields[key] = unquote(value);
    }
  }
  return { fields, body: match[2].trim() };
}

function unquote(value) {
  const trimmed = String(value).trim();
  return /^(".*"|'.*')$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

/**
 * Reject anything the API would reject, plus sub-hourly schedules.
 *
 * The minimum interval is one hour, and the failure is quiet: an expression like
 * `0,30 * * * *` looks valid and is refused on create, after the declaration has
 * already been committed.
 */
function validateCron(expression, file) {
  const fields = String(expression).trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`${file}: cron needs 5 fields, got ${fields.length}`);
  }
  const [minute] = fields;
  if (minute.includes("*") || minute.includes("/")) {
    throw new Error(
      `${file}: minute field "${minute}" runs more than hourly; the minimum interval is 1 hour`,
    );
  }
  if (minute.split(",").length > 1) {
    throw new Error(
      `${file}: minute field "${minute}" fires several times an hour; the minimum interval is 1 hour`,
    );
  }
}

function normalizeRepositoryUrl(value) {
  const trimmed = String(value).trim().replace(/\.git$/, "");
  if (/^https?:\/\//.test(trimmed)) return trimmed;
  const sshMatch = /^git@[^:]+:(.+)$/.exec(trimmed);
  if (sshMatch) return `https://github.com/${sshMatch[1].replace(/\.git$/, "")}`;
  return `https://github.com/${trimmed}`;
}

const DEFAULT_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep"];

/** Every declaration under `.claude/routines`, validated. */
function readDeclarations(root) {
  const directory = path.join(root, ".claude", "routines");
  let files = [];
  try {
    files = fs.readdirSync(directory).filter((name) => name.endsWith(".md"));
  } catch {
    return [];
  }
  return files.sort().map((file) => {
    const full = path.join(directory, file);
    const { fields, body } = parseFrontmatter(fs.readFileSync(full, "utf8"), file);
    const name = fields.name || file.replace(/\.md$/, "");
    if (!fields.schedule) throw new Error(`${file}: no schedule`);
    validateCron(fields.schedule, file);
    if (body === "") throw new Error(`${file}: prompt body is empty`);
    return {
      file,
      name,
      remoteName: remoteName(path.basename(root), name),
      schedule: String(fields.schedule).trim(),
      enabled: fields.enabled !== false,
      model: fields.model || "claude-sonnet-5",
      repositories: (fields.repos || []).map(normalizeRepositoryUrl),
      environment: fields.environment || null,
      allowedTools: fields.allowed_tools || DEFAULT_TOOLS,
      connectors: fields.connectors || [],
      prompt: body,
    };
  });
}

/** The fields of a live routine this tool considers its own to manage. */
function describeLive(routine) {
  const ccr = routine.job_config?.ccr || {};
  const context = ccr.session_context || {};
  return {
    id: routine.id,
    name: routine.name,
    schedule: routine.cron_expression || null,
    enabled: routine.enabled === true,
    model: context.model || null,
    repositories: (context.sources || [])
      .map((source) => source.git_repository?.url)
      .filter(Boolean)
      .map(normalizeRepositoryUrl),
    prompt: (ccr.events?.[0]?.data?.message?.content || "").trim(),
  };
}

function differences(declaration, live) {
  const changed = [];
  if (declaration.schedule !== live.schedule) changed.push("schedule");
  if (declaration.enabled !== live.enabled) changed.push("enabled");
  if (declaration.model !== live.model) changed.push("model");
  if (declaration.prompt !== live.prompt) changed.push("prompt");
  const declared = [...declaration.repositories].sort().join(",");
  const actual = [...live.repositories].sort().join(",");
  if (declared !== actual) changed.push("repos");
  return changed;
}

/**
 * The action list.
 *
 * Orphans are disabled rather than removed: the API exposes no delete, so a
 * declaration deleted from the repository can only be stopped, and removing it
 * for good stays a deliberate act on the web.
 */
function plan(declarations, liveRoutines, repositoryName) {
  const owned = liveRoutines
    .map(describeLive)
    .filter((routine) => routine.name.startsWith(`${repositoryName}: `));
  const byName = new Map(owned.map((routine) => [routine.name, routine]));
  const actions = [];

  for (const declaration of declarations) {
    const live = byName.get(declaration.remoteName);
    if (live === undefined) {
      actions.push({ action: "create", declaration });
      continue;
    }
    byName.delete(declaration.remoteName);
    const changed = differences(declaration, live);
    if (changed.length > 0) {
      actions.push({
        action: "update",
        triggerId: live.id,
        changed,
        declaration,
      });
    } else {
      actions.push({ action: "unchanged", triggerId: live.id, declaration });
    }
  }

  for (const orphan of byName.values()) {
    if (!orphan.enabled) continue;
    actions.push({ action: "disable", triggerId: orphan.id, name: orphan.name });
  }
  return actions;
}

/** The exact `RemoteTrigger` create body for a declaration. */
function createBody(declaration, environmentId, uuid) {
  return {
    name: declaration.remoteName,
    cron_expression: declaration.schedule,
    enabled: declaration.enabled,
    job_config: {
      ccr: {
        environment_id: declaration.environment || environmentId,
        session_context: {
          model: declaration.model,
          sources: declaration.repositories.map((url) => ({
            git_repository: { url },
          })),
          allowed_tools: declaration.allowedTools,
        },
        events: [
          {
            data: {
              uuid,
              session_id: "",
              type: "user",
              parent_tool_use_id: null,
              message: { content: declaration.prompt, role: "user" },
            },
          },
        ],
      },
    },
  };
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "list";
  // The live-routines dump is also a path, so the repository is the first
  // non-flag path that is not it. Selecting by position instead would make
  // `plan <live.json> <repo>` resolve the repository to the caller's directory.
  const repoArgument = args
    .slice(1)
    .find(
      (value) =>
        !value.startsWith("--") &&
        !value.endsWith(".json") &&
        (value.includes("/") || value === "."),
    );
  const root = repoAudit.findRepositoryRoot(
    repoArgument ? path.resolve(repoArgument) : process.cwd(),
  );
  if (root === null) {
    console.error("Not inside a git repository.");
    process.exit(1);
  }

  let declarations;
  try {
    declarations = readDeclarations(root);
  } catch (error) {
    console.error(`Invalid declaration -- ${error.message}`);
    process.exit(1);
  }

  if (command === "list") {
    if (declarations.length === 0) {
      console.log(`No routine declarations in ${root}/.claude/routines/`);
      return;
    }
    for (const declaration of declarations) {
      console.log(
        `${declaration.file}\n  remote name : ${declaration.remoteName}\n` +
          `  schedule    : ${declaration.schedule} UTC (${declaration.enabled ? "enabled" : "disabled"})\n` +
          `  model       : ${declaration.model}\n` +
          `  repos       : ${declaration.repositories.join(", ") || "(none)"}\n` +
          `  connectors  : ${declaration.connectors.join(", ") || "(none)"}`,
      );
    }
    return;
  }

  if (command === "plan") {
    const livePath = args.find((value) => value.endsWith(".json"));
    let live = [];
    if (livePath) {
      const raw = fs.readFileSync(livePath, "utf8");
      // The RemoteTrigger result is prefixed with its HTTP status line.
      const json = raw.slice(raw.indexOf("{"));
      live = JSON.parse(json).data || [];
    }
    const actions = plan(declarations, live, path.basename(root));
    console.log(JSON.stringify({ repo: root, actions }, null, 2));
    return;
  }

  if (command === "body") {
    const name = args[1];
    const declaration = declarations.find(
      (candidate) => candidate.name === name || candidate.file === name,
    );
    if (declaration === undefined) {
      console.error(`No declaration named ${name}`);
      process.exit(1);
    }
    const environmentId = args.find((value) => value.startsWith("env_")) || "";
    const uuid = args.find((value) => /^[0-9a-f-]{36}$/.test(value)) || "";
    console.log(JSON.stringify(createBody(declaration, environmentId, uuid), null, 2));
    return;
  }

  console.error(`Unknown command: ${command}. Use list, plan, or body.`);
  process.exit(1);
}

if (require.main === module) main();

module.exports = { createBody, plan, readDeclarations, validateCron };

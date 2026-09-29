---
name: tool-search
description: Finds the specific components, libraries, and services from a curated list of web resources (React Bits, Aceternity UI, 21st, Bklit, Motion, vgpu, Supabase, Vercel and others) that fit a website or app being planned, and returns checked links with install commands. Use when the user asks which components, tools, or technology to use for a site, wants links to UI components for a page, or runs /tool-search with a description of what they are building.
argument-hint: "[what you're building]"
allowed-tools: Read WebFetch WebSearch
---

# Tool search

Turn a description of a site into a shopping list: for each thing the site
needs, the exact components and tools from the resource catalog, each
with a working link and an install command.

**Task:** $ARGUMENTS

If the task is empty, ask what they are building and stop.

## Steps

1. **Read the catalog.** `references/catalog.md` lists every resource with
   what it is, what it fits, its deepest searchable entry point, and how to
   install from it.
2. **Break the task into needs.** Sections and features first (hero, gallery,
   charts, contact form), then infrastructure (framework, data, auth, hosting,
   design). Infer the obvious needs the user did not name, such as icons or
   hosting.
3. **Match needs to resources.** Only resources whose "Fits" line matches.
4. **Search inside each matched resource** for specific items, not homepages.
   Open its entry point (`llms.txt`, `.md` pages, JSON catalog) and pick the
   individual components or doc pages that serve the need. When these tools
   are connected, prefer them:
   - shadcn MCP (`search_items_in_registries`) across `@react-bits`,
     `@aceternity`, `@bklit`, `@magicui`. It needs a `components.json` in
     the working directory; without one, confirm each install name by
     checking its registry JSON URL (listed in the catalog) instead.
   - 21st MCP (`search`) for the 21st catalog
   - a documentation lookup tool (such as Context7) for frameworks and
     services
5. **Go outside the catalog only when it has nothing for a need.** Label
   those rows "outside the catalog". Each one, and any tool the user named
   that the catalog lacks, becomes a proposed catalog entry (see Output).
6. **Check every link.** Pass every URL you will return through
   `bash scripts/check-links.sh URL...` (from this skill's directory). Replace
   or drop anything marked `dead`; `blocked` means the site refuses scripts,
   keep it.

## Output

Return exactly these parts, in order:

1. **Stack, in one sentence:** the resources you would build with.
2. **One section per need**, headed by the need, holding a table:

   | Pick | What it gives you | Link | Install |
   | ---- | ----------------- | ---- | ------- |

   One row per specific component or page. **Link** is a full `https://`
   URL to that item, never a relative path or a bare homepage when a deeper
   page exists. **Install** is the exact command for that item; for a doc
   page, the package the page is about; otherwise `none`.

3. **Skipped:** one line naming the catalog resources that do not fit this
   task, each with a three-to-six-word reason.
4. **Not verified:** every claim that came from memory or a page summary
   rather than a page you opened (prices, limits, licenses, browser support).
   Write `none` if there are none.
5. **Add to catalog:** for every resource labelled "outside the catalog",
   a complete entry in the catalog's five-field shape (URL, What, Fits,
   Search, Install), with the catalog heading it belongs under, ready to
   paste. Also list any catalog entry whose link came back `dead`, with the
   replacement URL. Write `none` if there is nothing to add or fix.

End with the link-check line: how many URLs were checked and how many were
`ok`, `blocked`, or replaced. If part 5 is not `none`, then ask whether to
add those entries to the catalog.

## Maintaining the catalog

The catalog grows from use: every search that has to leave it proposes the
missing resources in part 5, so a tool that was useful once is there next
time. When the user says yes, or asks to add a resource directly:

1. Append the entry under the matching heading in `references/catalog.md`,
   creating the heading if none fits.
2. Add the resource's name to that heading's line in the catalog's
   **Contents** list.
3. Run `bash scripts/check-links.sh` over the entry's URLs and fix anything
   `dead` before finishing.

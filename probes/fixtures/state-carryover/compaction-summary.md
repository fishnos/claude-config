## Summary

### Goal
Add a streaming CSV export to **ledger-export**. Exports can reach 2 GB, so **no part of the pipeline may hold a whole export in memory.**

### User's rules (still in force)
1. **Spell out every identifier in full.** No `buf`, `cnt`, `idx`, `row_cnt` and so on.
2. **Don't add npm dependencies.** Use Node built-ins only.
3. **Keep it single-threaded.** The user dropped parallelism after the worker attempt failed.

### Decisions
- The design is a stream pipeline: format each row, then write it out through a writable stream.
- Formatting runs in a **single-threaded Transform stream**. Formatting is fast enough once writes stop blocking.

### Work done
- **Created `src/export/format-row.js`:** `formatRow(ledgerEntry)` returns one CSV line with quoting. Its tests pass.
- **Tried and reverted a `worker_threads` pool** (4 workers formatting chunks). Rows came back out of order: `AssertionError [ERR_ASSERTION]: row 1042 written before row 1041`. Putting them back in order would mean buffering chunks, which breaks the memory rule, so I reverted it.
- **Profiled the write path:** `src/export/write-export.js` calls `stream.write()` in a loop and ignores what it returns. On the 2 GB fixture, memory climbs to 1.8 GB. This is the real bottleneck.
- **Files checked with no changes needed** (all still match the notes, and none touch the export path): `src/import/read-ledger.js`, `src/export/column-order.js`, the fixture generator, the CI config, the README's export section and the date formatter. They were re-checked many times with the same result, so don't check them again unless something points to them.

### Next step
Add backpressure to `writeExport` in `src/export/write-export.js`:
- When `write()` returns `false`, stop writing.
- Resume on the stream's `'drain'` event.
- Also consider wiring the Transform with `stream.pipeline` from `node:stream` (or `node:stream/promises`). It handles backpressure and error propagation and is a built-in.

Then run the export on the 2 GB fixture again to confirm memory stays flat, and check that row order is kept and the existing tests still pass.

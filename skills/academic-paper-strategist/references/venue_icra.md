# Venue Profile: ICRA (IEEE ICRA / IROS / RA-L family)

This file **overrides** the philosophy-preprint defaults in `SKILL.md` and in
`academic-paper-composer`. Those were written for PhilArchive, PhilSci-Archive,
and arXiv long-form argument: no page limit, 250-300 word abstracts, 1,500-word
introductions, 1,200-word chapters. Every one of those numbers is wrong for
ICRA. When this file and a skill body disagree, this file wins.

Verified against the ICRA 2027 call for papers on 2026-08-30. Re-check the
current CFP before every submission cycle, because these numbers move year to year.

---

## Hard constraints (desk-reject if violated)

| Constraint | Value |
|---|---|
| Page limit | **8 pages**, complete paper |
| What counts toward it | text, figures, tables, acknowledgements, **references** |
| Over limit | returned **without review**, no overlength purchase |
| Format | IEEE **double column** PDF |
| Review | **double-anonymous** (RAS rules) |
| ICRA 2027 deadline | **2026-09-15, 11:59 PST** |
| Video (optional) | =20MB, =180s, mpeg/mp4/mpg, =480 height, =20fps, progressive |
| Video windows | Aug 5 - Sep 9 2026, and Sep 17 - 22 2026 |

References inside the 8 pages is the constraint people underestimate. A 40-entry
bibliography in two-column IEEE is roughly three quarters of a page, so the body
has about 7.25 pages, and figures eat another 1.5 to 2 page-equivalents.

## Word budget

Estimated rather than measured: IEEE two-column 10pt runs roughly 900-1000 words per
full text page. Treat these as the ceiling to write against, then cut:

| Section | Words |
|---|---|
| Abstract | 150-200 |
| I. Introduction | 700-900 |
| II. Related Work | 500-700 |
| III. Method / Approach | 1,500-2,000 |
| IV. Experimental Setup | 600-900 |
| V. Results and Discussion | 800-1,200 |
| VI. Conclusion | 200-300 |
| **Body total** | **~5,000-6,000** |

Anything the strategist or composer proposes above this is out of scope for the
venue and must be cut at outline stage, not at draft stage.

## Structure

ICRA is empirical, not argumentative. The contribution is a system, method, or
result that was **built and measured**, and the paper's spine is the evidence,
not the reasoning. This is the deepest difference from the philosophy framework
these skills ship with.

- **Introduction** ends in an explicit bulleted contributions list. Reviewers
  look for it. Three to four items, each one falsifiable.
- **Related Work** positions against named systems, not schools of thought. Every
  paragraph ends in the delta: what they did, what this does differently.
- **Method** must be reproducible from the text plus the figures alone.
- **Experiments** state the hypothesis each experiment tests before its numbers.
  Baselines, ablations, and failure cases are expected, not optional.
- **Figures carry the argument.** A system diagram and a results figure do work
  that prose cannot afford at this page count. Budget them first, write around them.
- **Conclusion** is short and states limitations honestly. No aspiration.

## Double-anonymous checklist

Run before submitting:

- No author names or affiliations anywhere in the PDF
- No `\thanks{}` funding or acknowledgement block (add it in the camera-ready)
- Self-citations in third person: "Prior work [7] showed", never "our prior work [7]"
- No identifying repo, lab, dataset, or project-page URLs. Use anonymized links
- Strip PDF metadata (author fields survive LaTeX -> PDF and leak)
- Video contains no faces, lab signage, institution logos, or spoken names
- arXiv preprints are permitted, but the paper must not be under review anywhere else
- All co-authors entered in PaperPlaza at first submission (visible to editors only)

## AI disclosure, to read before using these skills on a submission

This matters directly, because this skill pipeline generates prose.

IEEE policy as stated in the ICRA 2027 CFP:

- Generative AI **may not be listed as an author**.
- AI-generated content **must be disclosed in the acknowledgements**, naming the
  specific sections that contain it.
- "The use of AI systems for editing and grammar enhancement is generally outside
  the intent of the above policy."
- Violation consequence named in the CFP: registration fees are not refunded.

The line therefore falls between **editing** and **generation**. Running
`daniel-voice` as a constraint layer over sentences the author wrote is editing.
Having `academic-paper-composer` draft a Method section from an outline is
generation, and is disclosable. Decide which side of that line the paper sits on
before drafting, and if any section is generated, write the acknowledgement now
rather than remembering it at camera-ready.

Never let either skill invent an experimental result, a baseline number, a
citation, or a related-work claim. At this venue that is not a style problem.

## Voice at this venue

`daniel-voice` applies here as a **constraint, not a register**: flow and
mechanics, personal voice dialed back. See the Voice section in either skill body.
Concretely: keep the flow rule (each sentence opens on what the previous
established), the connective set, and the ban on hollow closers. Drop the
narrative opener, the personal register, and the first-person singular. "We"
is standard and expected at ICRA; "I" is not.

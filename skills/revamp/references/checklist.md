# Review checklist

Run every item, every round, against the screenshots from `shoot.js` and
the code. Judge what the screenshots show, not what the code intends. An
item that fails gets fixed before the next round; nothing goes to the user
with a failing item.

## Measured by shoot.js (must exit 0)

1. No horizontal overflow at 390, 768 or 1440px.
2. No broken images; every image has alt text.
3. Button and pill labels sit within 2px of vertical centre.
4. No tap target under 24px.
5. No tracked all-caps text.
6. No empty band taller than 40% of the viewport (gap under the hero).
7. No console errors, including hydration mismatches, with and without
   reduced motion.

## Read from the screenshots

8. The phone shot, top to bottom, reads as designed for a phone, not a
   squeezed desktop: nothing cramped against the edge, a 16px or wider
   side gutter, headings not breaking one word per line.
9. The signature element is visible on the first screen at desktop and
   within the first two screens on phone.
10. Every section's background is the same colour; nothing separates
    sections but space and type.
11. Nothing in the reduced-motion shot is missing or half-faded.
12. Every photo is cropped on its subject (faces and performers not cut
    off); set `objectPosition` where it isn't.
13. Text alignment is consistent within each section; edges line up with
    the container. A rounded button inside a rounded bar is concentric:
    equal gaps where the curves meet, radius = bar radius minus gap.
14. Nothing looks like a template: no centred-hero-with-gradient, no row
    of three equal icon cards, no glass panels, no default library theme
    colours (purple, grey) left showing.

## Read from the code

15. Every fact on the page is in the content file and has a source there;
    no source list, "Sources:" line or "come from" copy on the page.
16. Every copied component has its source credited and differs from the
    original only in props, imports and colours.
17. One easing token; no `ease` or `linear` on UI transitions.
18. Fonts: one or two families, self-hosted, only the weights used; no
    monospace or typewriter face on headings, ledes or navigation, no
    italic sentences, and none of the overused faces in `lessons.md`.
19. Links use the underline sweep; focus rings are visible.
20. No arrows in link or button text; no generated logo; no footer
    without a job.
21. No unused components, fonts or packages left in the repo.
22. README design, facts and credits match the site.

## Gates

23. `npx tsc --noEmit` and `npx eslint .`: no errors.
24. `next build` passes.
25. Contrast: body text 4.5:1, large text and controls 3:1
    (`contrast-master`).
26. Every lesson in `lessons.md` checked against this site.

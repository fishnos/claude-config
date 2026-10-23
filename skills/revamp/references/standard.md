# The standard

What gns-astronomy, daniel-eng-portfolio and Stedo actually do, written as
principles so a new site reaches the same level without copying either
look. Where the reference code and `lessons.md` disagree, lessons win:
astronomy still has tracked capitals and hairline dividers the user later
rejected.

## Identity comes from the subject

Each site is built around one idea taken from what it is about, stated in
a sentence before any code.

- Astronomy: "black and white, like a photographic plate". The page colour
  matches the black around the telescope photos, so photos sit on the page
  instead of in boxes; photos are greyscale with a lighten blend.
- Portfolio: a Mac desktop seen by a robotics-and-art student. Warm paper,
  ink, one rose and one orange accent.

- Stedo (the user's startup, `~/Desktop/Stedo/dashboard/src/pages/Home.tsx`):
  a monochrome "pixel instrument". One near-black page, white as the only
  accent, emphasis by a glow on one word rather than a hue, small figure
  labels ("01 / Quote") set like a technical paper, and "/" as a separator
  where other sites reach for arrows.

Each has one **signature element only that subject could have**, built
from real data or real photos: astronomy's "Tonight from the dome" strip,
computed live with Astronomy Engine; the portfolio's folder that fans out
project cards; Stedo's ring of pixels that lights along a frame's edge
around the cursor, repeated on the hero screenshot and every card. A
signature is not a generic effect with the club's name on
it. Ask: could a different club use this unchanged? If yes, it isn't one.

## Typography

- Two named families whose character fits the subject (astronomy: Old
  Standard TT display with Hanken Grotesk text; portfolio: Instrument Sans
  display with Inter text), self-hosted, only the weights used.
- Base text around 18px, line-height about 1.6, kerning and ligatures on.
- Headings sized with `clamp()`, leading 1.05 or tighter, tracking zero or
  slightly negative (astronomy h1: 2.8–5.4rem, leading 1.02, −0.015em).
- Body measure capped, 34–65ch.
- Tabular lining figures for numbers, dates and times.
- Labels sentence case in a quieter colour, never tracked capitals.
- Roman throughout: no typewriter or monospace display type, no italic
  ledes (see `lessons.md` for the banned faces).

## Layout and rhythm

- A wide container (astronomy 84rem) with narrower text inside it.
- Deliberately uneven grids where content allows (astronomy join grid
  1.4fr / 1fr / 1fr), not equal cards.
- Section padding varies on purpose; not one value repeated everywhere.
- Sections separate by space, scale and type, not borders and (per
  lessons) not alternating colour bands.

## Motion

- One easing curve, defined once as a token and used for every transition
  (astronomy `cubic-bezier(0.22, 1, 0.36, 1)`; portfolio
  `[0.16, 1, 0.3, 1]`). Never the default `ease`.
- Small transitions 160–360ms; entrances 0.5–0.9s; word staggers ~90ms.
  Stedo's one entrance: rise 8px, unblur 6px, 0.7s, once; reduced motion
  renders a plain element.
- Headlines are short and concrete (Stedo: "Quote. Fly. Deliver."); demo
  numbers look real ("2,440 sq ft, ready in 4:51").
- A few effects with a reason (a headline coming into focus, cards
  stacking on scroll), each tied to the content.
- Every animated component honours reduced motion, plus a global fallback
  block in the stylesheet.

## Library components, adapted from outside

- Each component comes from a published library and is credited, in a
  header comment or the README.
- It stays close to as shipped. Restyle it from outside: CSS variables
  passed as props, overrides in the stylesheet, descendant selectors.
  Remove its library theme (astronomy removes the nav's purple tint) and
  turn off extras that don't serve the content.

## Content

- Every fact in one content file or as constants at the top of the page:
  real names, days, rooms, dates, each with a source recorded there and in
  the README, never printed on the page.
- Copy is short and dry: one or two plain sentences per item, no marketing
  adjectives. Astronomy: "There is food."
- Photos through `next/image` with `sizes`, alt text that says what is
  seen, and layout that respects each photo's real aspect ratio.
- No photo for something? Use typography (a large word in roman, set by
  size and weight), never a stock image.

## Craft details

- Links: a real underline treatment. Astronomy uses a 1px underline at
  partial colour that goes full on hover; the portfolio's underline sweeps
  in from the left on hover and focus. The user's default for club sites
  is the portfolio sweep.
- Focus ring visible on every background (astronomy: 2px currentColor,
  4px offset). Selection colours set.
- Navigation does one memorable thing well: astronomy's dot follows the
  section in view; the portfolio's full-screen menu wipes in with a focus
  trap, Escape to close, and `inert` when hidden.
- Footer only when it holds something shown nowhere else.
- Favicon: the club's real mark or a plain shape, never a drawn logo.

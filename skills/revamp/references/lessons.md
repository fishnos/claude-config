# Lessons

Every correction the user has had to make on a revamp, turned into a check.
Read this before the brief and again before every review round. When the
user corrects something new, add it here the same day, newest first, with
the site it came from and the check that would have caught it.

Format: **the rule.** Where it came from. _Check:_ how to verify it.

## Look and identity

- **No AI-tell typography.** gns-mock-trial, 2026-10: a bold Courier Prime
  headline over an italic Libre Caslon lede, flagged as "ai tell tales,
  such as these fonts and italicizing style". Banned: a monospace or
  typewriter face (Courier, Courier Prime, Space Mono, JetBrains Mono, IBM
  Plex Mono, anything named "Mono") for headings, ledes, navigation or a
  signature block of text, even when the subject is typed (transcripts,
  code, terminals); italic for a whole sentence or lede (italic stays for a
  title or one stressed word inline); and the display faces generated sites
  keep reaching for: Instrument Serif, Fraunces, Playfair Display, Libre
  Caslon, Cormorant, DM Serif, EB Garamond, Space Grotesk. Pick a face with
  a real tie to the club or subject (a government or institutional
  typeface, the school's own, a face from the subject's printed matter) and
  build hierarchy from size and weight in roman. _Check:_ `shoot.js`
  reports "monospace heading" and "italic sentence"; `ls app/fonts` names
  none of the faces above; the brief says why the face fits this club.
- **One background colour across the whole site; no alternating red, gold
  or tinted section fields.** gns-acc, 2026-10. _Check:_ every section's
  computed background is the same token; sections separate by space and
  type, not by colour bands.
- **No ruled lines between sections.** gns-astronomy, gns-research.
  _Check:_ no `border-top`/`border-bottom`/`<hr>` between sections.
- **No all-caps tracked labels or eyebrows; labels are sentence case.**
  gns-astronomy. _Check:_ `shoot.js` reports "tracked capitals".
- **No arrow characters in buttons or links.** gns-astronomy. _Check:_ grep
  the built pages for → ↗ ➜ › ».
- **No generated logos.** gns-astronomy. _Check:_ the favicon is the
  framework default, a plain shape in the site's colour, or the club's real
  logo; no drawn mascots or monograms.
- **Colours come from a real source the user names** (the club's own
  palette file, school colours), never invented. gns-research. _Check:_ the
  brief names the source of every colour.
- **Don't copy another club site's look or components; copy the process.**
  gns-research, gns-acc. _Check:_ the brief's identity comes from this
  club's subject, and no component file is copied from a sibling repo.

## Components

- **Every visible component comes from a published library** (React Bits,
  Aceternity, Magic UI, ScrollX UI, 21st.dev), not written from scratch.
  gns-acc: "i dont want any house-made components at all". _Check:_ each
  file in `components/` carries a source comment, or only feeds content into
  a library component.
- **Adapt library components from the stylesheet, not by rewriting them.**
  gns-acc. _Check:_ copied files differ from the source only in props,
  imports and colours; layout fixes live in the global stylesheet.
- **When a registry needs a sign-in (21st.dev), take the source from the
  component's GitHub repository** (`gh search code`, `gh api`). gns-acc.

## Layout and detail

- **No gap under the hero.** Library heroes often carry a fixed height
  (Aceternity Hero Parallax: `h-[300vh]`). gns-acc. _Check:_ `shoot.js`
  reports no "empty band"; look at the phone shot below the hero.
- **Labels sit in the vertical middle of their buttons and bars.** Text
  faces draw their capitals above or below the middle of their line box,
  each by a different amount, so flex centring alone leaves a 1-2px drift
  that shows when two faces share a bar. gns-acc: "JUST CENTRE IT
  VERTICALLY USING FLEX"; gns-sadd: "the nav is not vertically centered".
  Use `text-box: trim-both cap alphabetic` on each label so its box is cap
  height, then flex-centre the box. The trim works on block boxes only, so
  a button's text needs its own `display: block` span. _Check:_ `shoot.js`
  reports no "label low/high"; for a bar mixing faces, measure the letter
  pixels in a 2x screenshot against the bar's middle.
- **A rounded control inside a rounded container is concentric: outer
  radius = inner radius + gap,** and the gap is equal on every side the
  two curves share. A 40px pill button in a 56px pill bar needs 8px on top,
  bottom and the end, and its radius is fully round. gns-sadd: "it should
  be radially and mathematically aligned". _Check:_ in the scrolled
  header, the button's gaps to the container are equal and the centres of
  the two end curves share an x.
- **Site classes in `globals.css` beat Tailwind utilities on the same
  element,** because unlayered CSS outranks layered utilities; `mt-6` on a
  `.body` paragraph did nothing. gns-sadd. Never mix a site class and a
  spacing utility on one element; put the spacing in the site stylesheet.
  _Check:_ grep for elements carrying both a site class and an `m*-`/`p*-`
  utility.
- **Sticky header with a blurred background.** gns-acc, after astronomy.
  Put the blur on a pseudo-element: `backdrop-filter` on the header itself
  traps a fixed-position phone menu inside it. _Check:_ open the phone menu
  in the phone shot.
- **Link hover is the portfolio's underline sweep**
  (daniel-eng-portfolio `components/lab/OutboundLink.jsx`). gns-acc.
- **No footer unless it has a real job** (contact details not shown
  elsewhere). A school-name line or a "built by" credit is not a job.
  gns-research.

## Content

- **Sources stay off the page.** gns-key-club and gns-mock-trial,
  2026-10: "Sources:" lines and a "Where these facts come from" list
  closed the sections. The user: "i seriously dont want to see sources at
  the footer instaed of good information." Sources live in the content
  file and the README for whoever maintains the site; the page spends that
  space on information a visitor wants. No copy about where the copy came
  from either ("every answer below is on the record"). Linking an article
  as the thing itself (a Southerner story to read) is content, not a
  source line. _Check:_ grep the page files for `source`, `Sources:` and
  "come from"; nothing renders a source list or a "From the …" credit.
- **Real facts and real photos only**, each fact traceable to a public
  source (school clubs sheet, The Southerner, district pages). All copy
  lives in one content file. gns-astronomy, gns-acc.
- **The README matches the site**: fonts, palette, component credits,
  facts. gns-acc shipped a stale README until the commit step caught it.
- **Photos and fonts live in the repo**, not on postimg or Google Fonts.
  gns-sadd: postimg took 9.5s for one photo and broke the image optimizer;
  Google Fonts timeouts left screenshots in a fallback face. Copy photos to
  `public/` (resized with `sips`) and fonts to `app/fonts/` with
  `next/font/local`. _Check:_ the content file names no image host; no
  `next/font/google` import.

## Motion

- **Reduced motion is handled in CSS when the server can't know the
  preference**; branching on `useReducedMotion` in a server-rendered
  component causes a hydration mismatch. gns-acc. _Check:_ the
  `desktop-reduced` shot shows every element, and the console is clean.
  Reading the preference only to set a `transition` is safe, since timing
  never reaches the HTML (gns-sadd, console clean both ways).
- **A shrinking header is fast and reaches its target.** Aceternity's
  Resizable Navbar ships an overdamped spring aimed at a 40% width that its
  own 800px minimum cuts off, so it crept and then stopped dead. gns-sadd:
  "the pill animation is also very poor, sohuld be much faster and
  smoother". Tween about 0.35s on the site's ease-out to a reachable px
  width, and fade the fill in with it rather than toggling a class.
  _Check:_ sample the header's width each frame after a scroll; it settles
  under 400ms with no flat stretch before the end.

## Shipping

- **Vercel's framework preset must be Next.js** before the first push of a
  rebuilt site. Three sites kept the Create React App preset and every build
  failed with `STATIC_BUILD_NO_OUT_DIR`. 2026-10-21. A committed
  `vercel.json` with `"framework": "nextjs"` overrides the project setting
  without touching the account (gns-sadd). _Check:_ `vercel.json` exists,
  or `vercel project inspect <name> --scope daniel-kosukhins-projects`.
- **The user commits and pushes.** Prepare the commit with `/commit` and
  hand over the command.

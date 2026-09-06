---
target: HomePage
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:C:\\code\\HearthShelf-WebApp\\src\\pages\\HomePage.tsx"
target_fingerprint: "sha256:68abf02a8a1237f531371a119240929566b829266eabaf0834bf7f8d731da078"
target_path: "C:\\code\\HearthShelf-WebApp\\src\\pages\\HomePage.tsx"
timestamp: 2026-09-05T06-05-22Z
slug: src-pages-homepage-tsx
---
Method: dual-agent (A: design review · B: detector + static evidence)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Primary query has loading + error; six secondary queries have neither |
| 2 | Match System / Real World | 3 | "QuestGiver", "your server", "All libraries" are infrastructure vocabulary on the listener's surface |
| 3 | User Control and Freedom | 3 | Density choice and arrange-reorder both commit with no undo |
| 4 | Consistency and Standards | 2 | Tailwind + lucide LoadingSpinner/ErrorState inside a design.css + Material Symbols page |
| 5 | Error Prevention | 3 | Nothing prevents arranging yourself into a blank Home |
| 6 | Recognition Rather Than Recall | 2 | Comfy/Compact has no label; section hints hidden inside Arrange mode |
| 7 | Flexibility and Efficiency | 4 | Drag-reorder, per-section visibility, rec-count stepper, dismissals, context menus |
| 8 | Aesthetic and Minimalist Design | 2 | Four author-mode control clusters above the fold on an Operate surface |
| 9 | Error Recovery | 2 | ErrorState renders beneath a playable hero; self-fetching bands render null on failure |
| 10 | Help and Documentation | 2 | Section hint copy exists at HomeSectionsEditor.tsx:31-77, unreachable from the page it describes |
| **Total** | | **26/40** | **Acceptable - significant improvements needed** |

## Design Specificity Verdict

Specific in its logic, generic in its atmosphere. TAINTED_ABS_SHELVES (HomePage.tsx:65) suppresses ABS recommendation shelves because they leak other household members' books; continueSeries is rebuilt from /series so each tile carries the series id the hide action needs (:276). No generic media app contains that reasoning. But the top 60px - greeting over progress sentence over chrome pills - is the most-copied media-app header in existence, and does not participate in the "warm room with one fire" north star.

DETERMINISTIC SCAN: effectively unavailable for this target. Detector ran clean (exit 0, zero findings) on HomePage.tsx and src/components/home, but a control test showed a JSX blind spot: rules match CSS declaration syntax (font-size: 13px), not React style objects (style={{ fontSize: 13 }}), which is how this page styles everything. A synthetic file with a deliberate no-alt img and a bare div onClick also scored zero. The clean exit is uninformative, not corroborating. This means the TSX layer has been under-scanned across this whole session; the earlier 806-finding audit count came almost entirely from design.css.

FALSE POSITIVES: none - no findings to verify.

VISUAL OVERLAYS: unavailable. Dev server blocked by pk_live_ Clerk key; browser visualization skipped. Evidence is source-only; rendered contrast and car-shell behaviour unverified.

## Overall Impression

Excellent bones aimed at the wrong person. Empty-state engineering is better than most shipped products manage. Then the header hands the invited non-technical listener four configuration controls before they have seen a book, and the first-run empty state is a grey icon with no way out. Biggest opportunity: Home is designed for the person who configures it, not the person who uses it. Heuristics 4, 6, 8, 9, 10 all sit at 2 and share that root cause.

## What's Working

1. Absence is engineered, not handled. hasAnyContent combines five sources (:424); selfFetchingOn (:436) prevents a false "nothing here" above a club shelf; empty shelves dropped before layout (:412); allSectionsHidden (:440) distinguishes "you turned everything off" from "there is nothing".
2. Arrange mode replaces shelves in place (:533) so the order you drag is the order you see; hidden sections stay dimmed rather than moving to a bucket.
3. Colors fully tokenized - zero hex/rgb literals across all five files; 11 var(--...) references.

## Priority Issues

[P0] First-run empty state is a dead end. "Nothing in progress yet" (:481) + .sg-empty (:526) with no button, link, or route out. PRODUCT.md's primary user at their most fragile moment. The rarer allSectionsHidden state (:538) correctly ships a primary button - pattern applied to the wrong state. Contradicts Product Principle 3. Fix: .cozy-empty vocabulary (design.css:13426), eyebrow + Libre Baskerville line + btn-primary to /library; branch when libraries.length === 0 without mentioning servers. Command: /impeccable onboard

[P1] Four configuration controls occupy the reader's primary surface (:484-517), at space-between with the greeting. Mode is Operate; none help find a book. Comfy|Compact has no label. Fix: collapse into one .icon-btn popover (.pop-row .seg exists); move All-libraries to the library switcher; label density "Shelf size". Command: /impeccable distill

[P1] Six of seven data queries render failure and emptiness identically. Both assessments converged independently. Only the primary shelves query has all three states (:523-531); the rest destructure { data } alone and return null on failure (HomeClubShelf.tsx:26, ReleaseCountdownBanner.tsx:83). A failed club load and no clubs are byte-identical. Fix: read isError per query, quiet inline retry in the band's own space. Command: /impeccable harden

[P2] Up to ~12 co-equal shelves. 11 sections + up to 8 generated rec rows + AI shelf, all same 17px heading. "Continue Listening" is typographically identical to an algorithmic row; peak-end tail is the consequence. Fix: .section-head.is-suggested tier applied when isGeneratedRecShelf(shelf.id) - predicate already imported at :10. Command: /impeccable layout

[P2] Two design systems collide. LoadingSpinner/ErrorState are Tailwind + lucide + shadcn Button; the page is design.css + Material Symbols. Both render at :523-524, at the moment the app is failing. Fix: author .shelf-loading and .shelf-error on existing tokens with Icon. Command: /impeccable polish

## Persona Red Flags

Jordan (first-timer): greeting + negative sentence + grey icon, nowhere to go. "Continue Series" vs "Finish the series" are near-synonyms for different data. "QuestGiver" unexplained. Comfy|Compact resizes the page with no undo. .rc-banner is border 1px solid var(--primary) on a primary wash - the loudest non-cover element - so the eye goes to a book they cannot listen to.

Sam (keyboard + screen reader): every book tile is div onClick, not tabbable, announces as nothing (BookTile.tsx:66) - the page's primary content. .hero-calm (HomePage.tsx:166) confirmed no role/tabIndex/onKeyDown; mobile forces compact so the resume hero is keyboard-dead. .club-tile and .dash-card are real buttons with no focus ring. Icon hard-codes aria-hidden; 2 aria-labels across 5 files. Toast has no role="status". Arrange is pointer-only. ReleaseCountdownBanner.tsx:90 does carry role/tabIndex/onKeyDown - the team knows the pattern and applied it once.

Ruth (invited listener, derived from PRODUCT.md): "All libraries" exposes server topology. "Recently Added" described as "The newest books on your server" - the word server in listener-facing copy, explicit Product Principle 1 violation. With QuestGiver and clubs off, Arrange still lists all 11 sections with hints for features that will never appear. Streak nudge reads as guilt to a twice-a-week listener.

## Minor Observations

- .hero-resume-card 20px and .hero-spotlight 22px radius - neither on the five-step ladder; JSX borderRadius literals 16/12/4.
- ResumeHero h2 inline-styled at 30px, between Title (25px) and Headline (34px); fontSize literals 30/15/13.
- .eyebrow letter-spacing 0.34em vs DESIGN.md 0.32em Tracked Kicker Rule; .hc-k uses 0.2em. Three values for one named rule.
- greetingWord() returns "Good evening" until 23:59.
- aiPreview.intro puts unbounded model output in an h2 with no clamp or text-overflow.
- Density writes to localStorage while section order syncs to the account.
- ReleaseCountdownBanner onKeyDown activates on Space for role="link".
- ReleaseCountdownBanner.tsx:101 img lacks loading="lazy" - slipped the earlier optimize pass.

## Questions to Consider

1. What if Home had exactly one job - resume - and everything else was the Library?
2. Who is the arrangement system for, and does that person exist? PRODUCT.md says the centre of gravity is the invited listener, who will never open Arrange.
3. What if the empty state were the best screen in the app instead of the worst? The new listener is the only reader guaranteed to look carefully.

---
project: "10xPlantsInventory"
context_type: greenfield
created: 2026-05-19
updated: 2026-05-19
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "triple-pain product: workflow friction + missing capability + decision paralysis — AI is the differentiator that addresses all three"
    - topic: "primary persona scope"
      decision: "hobbyist plant owner with plants across 2+ physical locations (home, work, garden plot); dozens of plants total; personal use only"
    - topic: "core insight"
      decision: "Photo→AI care-info pipeline removes the biggest data-entry friction; notifications close the loop from catalog to action; AI chat for plant problems addresses a real unmet need"
    - topic: "auth model"
      decision: "passwordless magic-link via email — comparable build effort to email+password but zero passwords to manage"
    - topic: "role model"
      decision: "flat single-user role — each user owns and sees only their own plants/locations; no admin, no sharing (sharing is explicitly NOT-MVP)"
    - topic: "scope-cost resolution"
      decision: "scope-down with move A only (drop AI chat for v1) — keeps the 3-week after-hours budget; AI chat for plant diseases moves to v2"
    - topic: "MVP timeline"
      decision: "3 weeks of after-hours work; no hard external deadline; user accepts that 6 subsystems in 3 weeks remains ambitious and prioritizes shipping the catalog + AI vision + notifications loop"
  frs_drafted: 22
  quality_check_status: accepted
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

# Shape Notes — 10xPlantsInventory

## Vision & Problem Statement

Hobbyist plant owners who keep plants across multiple physical locations — home, workplace, garden plot — lose track of per-plant care needs. Watering schedules, sunlight requirements, winterization cutoffs, and species-specific quirks live in fragmented memory or scattered notes; plants die or struggle because the owner can't recall which plant needed what or when. The pain bites on three fronts simultaneously: workflow friction (coordinating care across locations), missing capability (not knowing how to care for a newly acquired plant), and decision paralysis (too many plants to mentally schedule against).

The insight that makes this worth building: AI has crossed a usability threshold where a phone photo of a plant can plausibly generate trustworthy care information in seconds, collapsing what was historically the largest data-entry barrier for any plant-tracking product. Combine that with a notification layer that turns the catalog into actionable daily/weekly care work, and the product is no longer a passive list — it's a system that closes the loop between cataloging and care.

## User & Persona

**Primary persona — Hobbyist multi-location plant owner.** Adult plant enthusiast who keeps dozens of plants across two or more distinct locations (e.g., apartment + office desk + summer garden plot, or family home + parents' balcony + greenhouse). Cares enough to take care seriously but not enough to memorize every species' requirements, and definitely not enough to keep a paper journal up to date. Reaches for this product at care-cycle moments: "Did I water the orchid at work this week?", "Which of my plot plants need winterization before October?", "Why is this one turning yellow?". Personal use, not commercial. No team or shared-ownership context.

## Success Criteria

### Primary

- **≥75% of AI-generated plant descriptions are accepted by users** — measured as the rate at which a user saves the AI's suggested description without edits, or with only minor edits (operational definition of "minor" to be finalized in PRD).
- **≥75% of plants in the catalog are created via the AI-assist path** — measured as `plants_created_with_ai / total_plants_created`. Proves the AI flow is the path users actually take, not an unused alternative.
- **Within the first 2 weeks of use, the user receives and acts on at least one reminder** — measured as a non-zero count of `reminder → care-marked-done` actions per active user. Proves the catalog → reminder → action loop closes.

### Secondary

- **Time from "open the app" to "first plant saved" under 60 seconds** for a returning user with at least one location already created. Falsifiable yardstick for cataloging speed.

### Guardrails

- **Per-user data isolation** — a user can never read, modify, or be affected by another user's plants, photos, locations, or reminders. Even though the domain is low-stakes, leakage is a regression.
- **Catalog functionality survives AI outage** — if the AI service is slow, rate-limited, or unavailable, the user can still create a plant manually (skip the AI suggestion step) and save it. AI is a value-add, not a hard dependency for core cataloging.
- **Reminders are not noisy** — the system must batch / cap reminders such that a typical user with a dozen plants never receives more than a small, manageable number of reminders in a single day. Specific batching rules to be finalized in PRD.
- **Plant photos persist** — uploaded photos are not silently deleted on account inactivity, account closure (within a reasonable grace window), or any background cleanup. Data durability is part of user trust.

## v1 MVP Flow (synthesis)

Narrative of the smallest end-to-end flow the FRs and user stories below collectively cover:

1. **Sign in** — user enters email, receives magic link, clicks link, lands in the app.
2. **Create a location** — user adds a named location ("Apartment", "Office", "Garden plot"). Multiple locations are supported from day one.
3. **Add a plant** — user opens a location, taps "Add plant", and uploads a photo from their device.
4. **AI suggestion** — the app generates a species guess plus suggested care info (watering interval, sunlight, winterization cutoff, short description).
5. **Accept / edit / save** — user accepts the AI suggestion verbatim, edits any fields, and saves the plant. The accept/edit choice is recorded for the 75% success metric.
6. **Reminder** — at the scheduled interval, the user receives a reminder that a plant needs watering (or winterization in season). Notification delivery channel is an open question.
7. **Daily care view** — user opens the app and sees today's care tasks ("3 plants need water"), marks them as done.
8. **Browse / edit / delete** — user can view all plants per location, edit their info (including the AI-generated description), or delete plants and locations.

**Subsystems involved:** magic-link auth · multi-location data model · plant CRUD with photo upload · AI vision (photo → species + care info) · accept/edit UX · reminders.

**Out of v1:** AI chat for plant disease diagnosis (deferred to v2 — keeps the 3-week budget achievable).

## User Stories

### US-01: User adds a plant from a photo with AI-suggested care info

- **Given** a signed-in user with at least one location created
- **When** they tap "Add plant" in a location, upload a photo, and wait for the AI response
- **Then** they see a pre-filled, fully-editable form containing the AI's species guess plus suggested watering interval, sunlight needs, winterization cutoff, and a short description; they can accept, edit any field, or replace the suggestion entirely before saving

#### Acceptance Criteria

- AI suggestion appears within a target time window; if the AI does not respond within a reasonable bound, the user is offered a "create manually" fallback with the uploaded photo preserved
- All AI-suggested fields are editable in the same form (no separate edit step required)
- The user's accept-vs-edit choice is recorded for the 75% acceptance metric (per Success Criteria)
- The manual creation path is always reachable regardless of AI availability
- Saved plant is immediately visible in the assigned location's plant list

### US-02: User receives a reminder when a plant needs care

- **Given** a saved plant with a known watering interval that has elapsed (or a winterization cutoff that is approaching)
- **When** the next scheduled reminder delivery time arrives
- **Then** the user receives a reminder identifying which specific plant(s) need care, delivered via the configured notification channel

#### Acceptance Criteria

- Reminder identifies the plant(s) needing care, not a generic "you have plants to water"
- If multiple plants need care, reminders are batched or capped to honor the "not noisy" guardrail
- A user with zero plants needing care does not receive an empty reminder
- The reminder includes (or links to) a path to mark the plant(s) as cared-for
- The watering reminder and the winterization reminder are distinguishable to the user

### US-03: User marks a plant as cared-for

- **Given** a signed-in user viewing their daily care list (or a plant detail screen) with a plant flagged as needing care
- **When** they tap "Mark watered" (or "Mark winterized" for the seasonal case) on that plant
- **Then** the relevant care interval resets, the plant is removed from today's care list, and the next reminder for that plant is scheduled per its interval

#### Acceptance Criteria

- The action is reversible within a short undo window — a mis-tap does not silently reset an interval the user didn't actually complete
- Today's care list updates immediately (no manual refresh required)
- A bulk "mark all watered" action is required for v1 — single-plant action is NOT sufficient

## Functional Requirements

### Authentication

- FR-001: User can request a magic sign-in link by entering their email address. Priority: must-have
  > Socratic: No counter raised — magic-link auth was locked in Phase 2; this is the minimal "request" operation.
- FR-002: User can sign in by clicking a single-use magic link delivered to their email. Priority: must-have
  > Socratic: No counter — required complement to FR-001; the entire auth model depends on this.
- FR-003: User can sign out from any authenticated screen. Priority: must-have
  > Socratic: Counter considered: "long session expiry could replace explicit sign-out." Resolution: kept; sign-out is standard UX, trivial to implement, and matters for shared devices. The "sign me out of all devices" variant was raised and intentionally not added to v1.

### Locations

- FR-004: User can create a named location (e.g., "Apartment", "Office", "Garden plot"). Priority: must-have
  > Socratic: No counter — multi-location is the differentiator and locations must be creatable.
- FR-005: User can rename a location. Priority: must-have
  > Socratic: Counter considered: "rename + delete may be rare-edge UI." Resolution: kept; users expect to fix typos and adjust seasonal labels. Trivial to ship alongside create.
- FR-006: User can delete a location and is warned if the location still contains plants. Priority: must-have
  > Socratic: Counter considered: "deletion may be rare, could be deferred." Resolution: kept; without delete, users live with mistakes. The "warn if non-empty" guard prevents orphaned plants.
- FR-007: User can view a list of all their locations with plant counts. Priority: must-have
  > Socratic: Counter considered: "could be a sidebar/nav instead of a dedicated screen." Resolution: kept as a capability; UI shape is a downstream design choice. Location-reorder variant raised and deferred.

### Plants — cataloging

- FR-008: User can add a plant by uploading a photo from their device. Priority: must-have
  > Socratic: No counter — photo upload is the entry point for the AI vision flow that defines the product.
- FR-009: User can receive an AI-generated species guess plus suggested care info (watering interval, sunlight needs, winterization cutoff, short description) from the uploaded photo. Priority: must-have
  > Socratic: No counter — this IS the core insight; without it the product is plain CRUD.
- FR-010: User can accept the AI suggestion as-is, edit individual fields, or replace the suggestion entirely before saving. Priority: must-have
  > Socratic: No counter — the accept/edit choice is what feeds the 75% acceptance success metric.
- FR-011: User can manually create a plant without using the AI suggestion as a fallback when AI is unavailable or the user prefers manual entry. Priority: must-have
  > Socratic: Counter considered: "manual fallback doubles maintenance and undermines the AI-first thesis." Resolution: kept; the "AI outage" guardrail in Success Criteria explicitly requires the catalog to work without AI. Manual entry is the only way to honor that guardrail.
- FR-012: User can assign a plant to one of their locations at creation time. Priority: must-have
  > Socratic: Counter considered: "if user tapped 'Add plant' from inside a location, the assignment is inferred — no UI needed." Resolution: kept as a capability; the user MAY override the inferred location at creation. The exact UI affordance (auto-set vs explicit picker) is a downstream design call.
- FR-013: User can replace or retake the photo before the AI suggestion is finalized, and trigger a new AI suggestion against the new photo. Priority: must-have
  > Socratic: Counter considered: "AI accuracy depends heavily on photo quality — without retake, a bad photo locks in a bad AI suggestion." Resolution: added to FR list (was missing in initial draft). User can iterate on the photo before saving the plant.

### Plants — managing

- FR-014: User can view a list of plants within a location, showing photo, name, and next care date. Priority: must-have
  > Socratic: No counter — primary navigation surface for the catalog. Search/filter variant raised and deferred (v1 caters to dozens-of-plants users; search becomes useful at 100+).
- FR-015: User can open a plant's detail screen showing all stored care info and the original AI suggestion, with each field editable in place (no separate edit step). Priority: must-have
  > Socratic: Counter considered: "view + edit as separate flows doubles UI work for a CRUD app." Resolution: merged the original FR-014 (detail view) and FR-015 (edit) into a single editable-detail-screen FR. The read-only / edit-mode split is not justified at v1 scope.
- FR-016: User can delete a plant. Priority: must-have
  > Socratic: No counter — standard CRUD operation.
- FR-017: User can add a free-text note to a plant. Priority: must-have
  > Socratic: Counter considered: "free-text notes are scope creep — users with serious notes need a journal, not a stub." Resolution: kept as a single-field text capture, not a journal. Trivial to ship, fills the "this plant had aphids in May" gap without inventing a journaling subsystem.

### Reminders

- FR-018: User can receive a reminder when a plant's watering interval has elapsed. Priority: must-have
  > Socratic: No counter — primary mechanism for closing the catalog→action loop.
- FR-019: User can receive a reminder when a plant's winterization cutoff is approaching, on a seasonal cadence. Priority: must-have
  > Socratic: Counter considered: "winterization is one-time/seasonal, not interval-shaped — treating it like watering could produce confusing UX." Resolution: kept with explicit framing as "approaching a cutoff date" rather than an elapsed interval. The reminder is fired once per winterization window per plant, not periodically.
- FR-020: User can mark a plant's care action as done (watered, winterized), which resets the corresponding interval. Priority: must-have
  > Socratic: No counter — required to keep the reminder loop honest; without mark-done, intervals never reset and reminders spam.
- FR-021: User can view today's care tasks across all their locations on a single screen. Priority: must-have
  > Socratic: Counter considered: "today view is redundant with reminders — pick one surface." Resolution: kept both; reminders are external nudge (push the user to act), today view is in-app aggregator (where the user lands when they actually open the app). Removing either weakens the loop.
- FR-022: User can snooze a reminder for one or more days when the care can't happen today, deferring (not falsely marking-done) the action. Priority: must-have
  > Socratic: Counter considered: "without snooze, users either ignore reminders (loop dies) or mark-watered falsely (data corrupts)." Resolution: added to FR list (was missing in initial draft). Snooze preserves the integrity of the watering-interval data while accommodating real-world delays.

## Non-Functional Requirements

- AI suggestion turnaround from photo upload to suggestion visible: under 10 seconds at the 95th percentile of successful suggestions.
- The product is usable on the current major versions of the four mainstream desktop browsers (Chrome, Safari, Firefox, Edge) and on the current major versions of mobile Safari and mobile Chrome.
- A user's catalog data — plants, photos, locations, reminders, notes — is not returned by the storage layer to any party other than the owning user; isolation is enforced at the storage boundary, not at the UI layer.
- A user can upload a plant photo of up to approximately 10 MB without friction (no client-side compression workflow imposed on the user, no manual size warnings under the cap, no failed-upload retry loops for files under the cap).
- A user's account and uploaded plant photos remain available for at least 12 months after the last sign-in; silent garbage-collection during this retention window is forbidden.

## Business Logic

**The application transforms a plant photo into a personalized care schedule, then continuously flags which plants in the user's catalog need action today.**

**Inputs:** a photo of a single plant, optionally annotated with the user's free-text note. Implicit context: the location the plant lives in, since location materially affects care needs (the same species on an office desk versus an outdoor balcony has different sunlight and watering profiles).

**Outputs:** a structured care profile per plant — species (with the user able to override the AI's guess), watering interval, light needs, winterization cutoff (a date or "none"), and a short prose description. Combined with the "last care done" timestamps the user records over time, the care profile determines when the plant's next reminder fires and whether the plant appears in today's care list.

**How the user encounters it:** within seconds of uploading a photo the user sees a pre-filled, editable form they confirm or revise. From that point on, the user's role shifts from "tracking schedules" to "confirming care actions" ("mark watered") as they happen. The application maintains the schedule and decides which plants need attention today.

## Access Control

Multi-user web application with **passwordless magic-link authentication**. Each user signs in by entering their email and clicking a single-use link sent to that address. Sign-up and sign-in collapse into a single flow — entering a new email creates an account on first link-click; entering a known email signs the user into an existing account.

**Single flat role: `user`.** No admin role, no shared access, no viewers. Every user owns their own plants and locations and can read/write only their own data. There is no public content in the app — unauthenticated visits to any route redirect to the sign-in screen.

Sharing of locations or plants between users is explicitly out of MVP scope (per Non-Goals).

## Non-Goals

- **AI chat for plant disease diagnosis** — scoped out in Phase 3 to fit the 3-week MVP budget. Diagnosis chat moves to v2 once the catalog + AI vision + reminder loop ships and operates.
- **Sharing locations or plants between users** — v1 is strictly single-user. No family sharing, no co-owners, no view-only access for partners or roommates. Multi-user sharing is a v2+ concern that would require rethinking the access model.
- **Photo gallery per plant** — each plant carries one current photo (replaceable via plant edit). No multi-photo history, no time-lapse views, no per-plant photo album. Storing only one photo per plant is the explicit shape.
- **Inventory change history / journal-style tracking** — no audit log of "plant X moved from location A to B on date Y", no journal of care actions over time. The app stores today's state of the catalog; historical state is not retained.
- **Native mobile apps** — v1 is web-only. The product is responsive web (mobile + desktop browsers per NFR), but no iOS/Android native apps.

## Open Questions

1. **Notification delivery channel** — email, web push (requires PWA + service worker + permissions UX), in-app only, or a combination? This is the second-biggest cost driver after AI vision. Owner: user, before tech-stack selection. Block: no (default to email-only if unresolved by implementation start).
2. **"Minor edit" definition for the 75% acceptance metric** — does adding a single field count as edit-acceptance or rejection? Owner: user, by PRD finalization.
3. **Reminder cap / batching rules** — exact threshold for "not noisy" (e.g., one digest per day vs. one notification per plant). Owner: user, by PRD finalization.
4. **Reminder delivery-latency precision** — explicit NFR for "reminders fire within N minutes of scheduled time" was raised and not adopted in this round. Defaults to "best-effort within the constraints of the chosen channel"; revisit once the delivery channel is decided. Owner: user, post tech-stack selection.
5. **Accessibility floor** — WCAG 2.1 Level A baseline was raised and not adopted for v1. Acceptable for a personal-use MVP but worth revisiting if user base grows or any external pressure surfaces. Owner: user, by v1.1 / external feedback.
6. **AI provider disclosure** — single-named-provider transparency was raised and not adopted as an NFR. The product currently has no commitment to telling users which AI service processes their photos. Decision needed before any public launch; legal/ethical expectations vary by jurisdiction. Owner: user, before public launch.

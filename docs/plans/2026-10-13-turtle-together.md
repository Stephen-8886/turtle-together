# 龟龟同频 Implementation Plan

**Goal:** Build a mobile PWA with four task quadrants, immutable time commitments, daily/weekly occurrences, focus animation and slideshow, per-person celebration, and real shared rooms with nudges.

**Architecture:** A dependency-free Node server owns room membership, immutable task definitions, task occurrences and nudge events. JSON state persists through atomic writes. HTTP APIs and Server-Sent Events keep devices synchronized. A responsive browser client renders an editable Figma design using shared tokens and exported artwork.

**Tech Stack:** Node 24, HTML/CSS/JavaScript modules, HTTP/SSE, Web App Manifest and service worker. No cloud account is assumed; local and LAN operation must be real, and public HTTPS deployment is documented.

## Design and acceptance

- New Figma file: fqeZVcKgwDcDn7RTdlqvCj. Five editable 390px screens: today, add task, focus, team, reward. Use Noto Sans SC, rounded green turtle artwork, cream and moss palette. Scope is application screens, with only the foundations needed by them.
- Design discovery: no Code Connect files or existing screens. No matching turtle brand components, variables or styles were found in library search. Create matching tokens instead of importing a different brand.
- Mobile web/PWA was explicitly selected by the user. Implement without waiting for further approvals.

## Steps

1. Create Figma screens and prototype links; inspect screenshot; obtain high-fidelity design context and download every used static asset.
2. Implement server in `server.mjs`, date/occurrence logic in `public/domain.js`, and persistent state in `data/`. Verify ownership, recurrence, deadline/duration checks, two-user synchronization, restart persistence and nudge cooldown with `node --test`.
3. Implement client in `public/index.html`, `public/app.js`, `public/styles.css`, `public/sw.js`, and `public/manifest.webmanifest`. Cover creation/join, date selection, four quadrants, add/confirm, timer, scenery import, team plans, nudge inbox, completion, exceptions and reduced motion.
4. Run real browser checks at mobile widths and two isolated browser sessions. Verify keyboard/dialog accessibility, no overflow, live updates and reload countdown continuity. Capture final UI.
5. Write launch/LAN/HTTPS instructions and known boundaries in `README.md`; leave the app running and open the preview.

## Product rules

- New commitments require the exact requested warning and explicit acknowledgement. Task title, time, duration and recurrence are immutable after submission. An exception records a reason and unsuccessful occurrence; it never silently rewrites the promise.
- Dates and weekly recurrence use the room's Asia/Shanghai timezone. Completion belongs to each member separately. A duration task needs elapsed wall-clock focus time and must finish by its deadline. Closing a page does not pause the timer.
- Daily settlement requires at least one due task and every due occurrence completed. New due tasks reopen the day; reward is shown once per member/day/task-set.
- Rooms use unguessable invitations, member session credentials and ownership checks. Invitation holders can see room plans; no public directory exists. Nudges have a 60-second per-sender/recipient cooldown and respect recipient DND. Unseen nudges persist and replay on reconnect.
- PWA shell works offline; shared mutations require a connection. No misleading fake success or queued completion.
- System notifications are optional and require browser permission. In-app nudges are always available while online; closed-app push requires a hosted HTTPS push service and must be described honestly.

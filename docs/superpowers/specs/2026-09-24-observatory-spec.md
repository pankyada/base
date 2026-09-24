# PT-109 — Cosmic Observatory

User chose observatory after three concept mockups. Implement the procedural version:
orbital collection worlds, file panels, stars, ivory/brass instrumentation, a luminous
portal and compact search/preview controls. Mock imagery is inspiration, not a promise
of photoreal assets. Existing Town work is preserved; rollback copies are in
`output/observatory-rollback/`.

## Scope and acceptance

- A visible Town portal and keyboard-accessible entry lead to `/observatory`.
- Return restores the departure camera pose; normal Town overview remains available.
- Three collections read immediate supported regular files from `~/Downloads/images`,
  `~/Downloads/PDFs & Documents`, and `~/Downloads/Videos` on the Web server host.
  No recursive whole-home scan. Missing/unavailable/empty/truncated states are explicit.
- Collection selection, filename search, image/document/video preview and browser-open
  links operate on real files. Browser-unsupported video formats show a useful fallback.
- File routes are bounded to named roots, reject traversal/symlink escape, stream files,
  support ranges and avoid active HTML/SVG. No filesystem mutations or agent dispatch.
- Orbital scene supports drag/zoom, pointer collection selection, keyboard-accessible
  equivalents, reduced motion and cleanup. UI remains usable if WebGL is unavailable.
- Validate file containment/ranges with temporary fixtures, Web typecheck/build and
  browser Town→Observatory→Town, filtering/preview, narrow viewport and reduced motion.
- User visual acceptance and release/deployment are separate from local implementation.

## Compatibility

ORCH-06 primary, Web only. Additive Next server routes; Core REST/WS/schema/prompt and
TUI unchanged. This local single-operator Web instance reads files on its own host,
not a remote Core host. An explicit server-side fixture root override supports tests.
No new dependencies. No authentication added; deployment must retain local binding.

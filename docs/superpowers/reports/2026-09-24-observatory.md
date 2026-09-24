# PT-109 — Cosmic Observatory evidence

## Implementation

Web-only `/observatory` experience with procedural stars, nebula, brass orbits,
three collection worlds, telescope/platform and a return portal. Selecting a world
frames it and stops its orbital rotation. The accessible collection index supports
filename filtering, original image/text/PDF/video previews and browser-open links.
Town has a mesh portal, a clickable scene label and a persistent keyboard-accessible
entry. Scoped session storage retains the departure camera without mutating Town
settings. Existing Town edits were preserved with pre-edit copies under
`output/observatory-rollback/`.

Fixed source roots are `~/Downloads/images`, `~/Downloads/PDFs & Documents`, and
`~/Downloads/Videos` on the Web host. Local catalog returned 17 supported images,
8 documents and 5 supported videos. These are counts of supported regular files,
not all files in each directory. No recursive scan, filesystem mutation, model
call, new dependency, Core contract or TUI change.

The catalog caps each collection at 120 supported files and 4096 examined directory
entries. The scene caps each world at 12 file panels and GPU thumbnails at 512px;
large images over 20MB use a labeled placeholder in the scene. Full originals are
available on explicit preview/open. Hidden entries, symlinked roots/files, path
traversal and unsupported active formats are rejected. GET/HEAD and byte ranges
stream files, including correct empty-file and unsatisfiable-range handling.

## Evidence

- Final full Web suite: **41 files / 217 tests passed**. Final Web typecheck and
  isolated production build also pass. Root/Core and Go suites not run: no Core/TUI edits.
- Web typecheck and isolated production build passed. Existing chart/operator CSS
  `end` autoprefixer and Pyodide dynamic-import/cache warnings remain.
- API regression tests cover bounded/missing collections, symlink/traversal rejection,
  MIME behavior, byte ranges, zero-byte files and cross-origin rejection.
- Browser: actual local collections, filename filtering, selected-file detail,
  image preview and modal close/focus return passed. MP4 playback advanced to
  5.95 seconds of an 8-second video with no media error.
- PDF response was byte-for-byte identical to its original (516541 bytes, PDF MIME).
  Embedded PDF rendering was blank in the in-app browser. The UI explicitly offers
  Open original and a browser-support fallback; PDF visual acceptance remains open.
- At 390×844, document scroll width and page width both equal 390px; collection index
  fits and scrolls. Default 817×964 overview and selected-world camera focus inspected.
- Pause control sets the shared reduced-motion path; platform reduced-motion media
  preference is wired but was not changed in the host OS for this check.
- Initial camera roundtrip exposed a max-distance clamp during empty Town load; fixed
  both scene initialization and the late storage-read path. Final real-browser departure
  and return DOM camera poses match exactly:
  `500.53,1002.05,500.53:0.00,1.00,0.00`. Both scene-label and corner entry links work.
- Keyboard ArrowLeft and Home work with no browser errors. Motion pause checked.
  Manual inspection found and corrected invalid CSS2D numeric border radius and
  removed new Three material/Clock warnings. No final browser errors observed.

## Delivery and remaining acceptance

Working tree and live development preview at `http://localhost:3000/observatory`.
The separate IPv4 production listener at `127.0.0.1:3000` still returns 404 for this
new route; it has not been rebuilt or restarted. No commit, release or deployment.
PT-111 tracks user visual acceptance, browser-dependent PDF rendering and any desired
follow-on source expansion. No broader Town PT-053 acceptance is implied.

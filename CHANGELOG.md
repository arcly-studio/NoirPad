# Changelog

All notable changes to NoirPad. Versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] – 2026-10-12

First public release.

### Highlights
- Windows installer (per-user, no admin rights) with a WebView2 check, and a self-hostable web
  version.
- Notes and folders with tabs, tags, favorites and trash; rich-text or Markdown per note with live
  preview, task lists and syntax highlighting; 17 themes; customizable shortcuts.
- Password-locked notes (Fernet, PBKDF2-SHA256 480 000 iterations). The password is sent once to
  unlock; only the derived key is kept in memory while the note is open.
- Optional app lock (scrypt hash only; the server refuses every request until unlocked).
- English and Czech user interface.
- Export everything as Markdown (folders, images in `assets/`) or HTML; import Markdown files or
  ZIPs; full ZIP backup and restore.
- No account, no cloud, no telemetry; all fonts and libraries are bundled.

### Security and reliability (since the internal builds)
- Safe Markdown/rich-text rendering (markdown-it + DOMPurify), link allowlist, strict
  Content-Security-Policy, uploads limited to real PNG/JPEG/GIF/WebP images.
- Host-header check (DNS rebinding), CSRF protection, a random per-launch token in the desktop app.
- Atomic saves with rotating snapshots; a damaged data file is kept aside and the newest good
  snapshot restored; a safety copy before every backup import; zip-bomb limits.
- One NoirPad per data folder (no lost writes from two instances).
- Unreferenced images are moved to `images/.trash` after 24 h and deleted after 30 days.
- A log file (`%LOCALAPPDATA%\NoirPad\logs\noirpad.log`) and clear messages instead of silent
  crashes at start-up.

Screenshot placeholders for the NoirPad README.
=================================================

Drop the following PNG files in this directory to populate
the README screenshot grid (see README.md / README.cs.md):

  welcome.png     — Welcome screen (NoirPad logo + tagline)
  markdown.png    — Markdown split-pane view with syntax highlighting
  themes.png     — Themes dropdown or 2-3 theme variants side-by-side
  encryption.png  — Lock dialog or encrypted note view
  pdf.png        — PDF export preview / print dialog
  mobile.png     — Mobile/responsive layout (<= 900px viewport)

Recommended specs:
  - Format:  PNG (transparency OK, but a solid background looks cleaner)
  - Width:   1200-1600 px for desktop shots, 380-430 px for mobile
  - DPI:     Standard (96), no need to upscale for retina
  - Naming:  exact filenames above (case-sensitive on Linux)

Once added, run `git add docs/screenshots/*.png` and commit.

This README.txt and the .gitkeep next to it are kept in git so the
directory exists even with no screenshots — the README's image links
won't 404 the directory itself, only the missing files.

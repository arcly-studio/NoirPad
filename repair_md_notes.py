"""
Best-effort restoration of newlines in markdown notes that got
corrupted by the editor.innerText-on-hidden-div bug. Reads
notes_data.json, repairs candidate notes (heuristic), writes back.

Heuristic: insert \n before tokens that begin a markdown block when
they appear mid-line (heading hashes, blockquote markers, list
bullets, images, links, fenced code starts) and before recognized
inline C# keywords so the test note becomes legible again.

Operates on:
  - notes flagged as markdown in note_modes
  - rich-text notes whose content matches the same corrupted pattern
    (the bug created cross-note copies under non-markdown ids)
"""

import json
import re
import sys
from pathlib import Path

DATA_FILE = Path(__file__).parent / "notes_data.json"

# Tokens that, when appearing mid-string, almost certainly start a
# new line. Ordered: longest/most-specific first so e.g. "### " wins
# over "## " wins over "# ".
LINE_STARTERS = [
    r"###\s",
    r"##\s",
    r"#\s",
    r">\s",
    r"-\s",
    r"\+\s",
    r"\d+\.\s",
    r"```",
    r"!\[",
    r"\[[^\]]+\]\(",
]

# C# / generic code patterns that the corrupted test note jammed
# onto one line.
CODE_STARTERS = [
    r"Console\.",
    r"string\s+\w+",
    r"int\s+\w+",
    r"var\s+\w+",
    r"public\s+",
    r"private\s+",
]

ALL_STARTERS = LINE_STARTERS + CODE_STARTERS


def repair(content: str) -> str:
    if not content:
        return content
    if "\n" in content:
        # already has line breaks — leave alone
        return content

    # If none of the markdown-ish patterns appear past position 0,
    # this isn't a corrupted markdown note — skip.
    if not any(re.search(p, content[1:]) for p in LINE_STARTERS):
        return content

    pattern = "|".join("(?:" + p + ")" for p in ALL_STARTERS)
    # Add a \n before each match position > 0 (skip the very first
    # token which is already at line start).
    out = []
    last = 0
    for m in re.finditer(pattern, content):
        start = m.start()
        if start == 0:
            continue
        # Avoid stacking hashes: `## ` should not be split into `#\n# `.
        # Find the actual hash run before this position.
        prev_char = content[start - 1] if start > 0 else ""
        if prev_char == "#" and m.group().startswith("#"):
            continue
        out.append(content[last:start])
        out.append("\n")
        last = start
    out.append(content[last:])
    repaired = "".join(out)

    # A second pass for inline bold/italic that follow another token
    # — only when preceded by a non-space non-newline character.
    repaired = re.sub(
        r"(?<=[^\s\n*])(\*\*[^*\n]+\*\*)", r"\n\1", repaired
    )
    repaired = re.sub(
        r"(?<=[^\s\n*])(\*[^*\n]+\*)(?=$|\s)", r"\n\1", repaired
    )

    # Collapse runs of 3+ newlines that the heuristic may produce.
    repaired = re.sub(r"\n{3,}", "\n\n", repaired)
    return repaired


def main() -> int:
    raw = DATA_FILE.read_text(encoding="utf-8")
    data = json.loads(raw)

    notes = data.get("notes", {})
    modes = data.get("note_modes", {})
    md_ids = set(modes.keys())

    changed: list[str] = []
    for nid, content in list(notes.items()):
        if not isinstance(content, str):
            continue
        new = repair(content)
        if new != content:
            notes[nid] = new
            kind = "markdown" if nid in md_ids else "rich-text"
            changed.append(f"  {nid} ({kind}): "
                           f"{content.count(chr(10))} -> "
                           f"{new.count(chr(10))} newlines")

    if not changed:
        print("No corrupted notes found.")
        return 0

    DATA_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Repaired {len(changed)} note(s):")
    for line in changed:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())

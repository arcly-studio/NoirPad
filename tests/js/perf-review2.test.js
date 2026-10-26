// Review 2, speed: R3 (thousands of formats), R4 (a huge Markdown
// paragraph), R5 (find-all while typing, the coloured Markdown source).
import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

/* The previous implementations, as the reference for the new ones. */
function oldLineColToOffset(text, lineCol) {
    const [l, c] = lineCol.split(".");
    const line = parseInt(l, 10), col = parseInt(c, 10);
    const lines = text.split("\n");
    let offset = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) offset += lines[i].length + 1;
    return offset + col;
}
function oldOffsetToLineCol(text, offset) {
    let line = 1, col = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === "\n") { line++; col = 0; } else col++;
    }
    return line + "." + col;
}

describe("formats of a long note (R3)", () => {
    it("line.col <-> offset give exactly what they gave before", () => {
        const win = loadApp(["js/utils.js"]);
        const texts = ["", "a", "\n", "ab\ncd\n", "\n\nx\n\n", "one\ntwo\nthree"];
        for (const t of texts) {
            for (let o = -2; o <= t.length + 2; o++) {
                expect(win.NP.offsetToLineCol(t, o), JSON.stringify([t, o])).toBe(oldOffsetToLineCol(t, o));
            }
            for (let l = 0; l <= 6; l++) {
                for (let c = 0; c <= 4; c++) {
                    expect(win.NP.lineColToOffset(t, l + "." + c), JSON.stringify([t, l, c]))
                        .toBe(oldLineColToOffset(t, l + "." + c));
                }
            }
        }
    });

    it("6 000 formats render and save in well under a second each (were 4–8 s)", () => {
        const win = loadApp(["js/utils.js", "js/editor.js"]);
        const ed = win.document.getElementById("editor");
        win.NP.editor.el = ed;
        const lines = Array.from({ length: 6000 }, (_, i) => "line number " + i + " with some words in it ok");
        const fmts = lines.map((_, i) => ({ start: (i + 1) + ".5", end: (i + 1) + ".11", bold: true }));
        let t = performance.now();
        win.NP.editor.renderContent(ed, lines.join("\n"), fmts);
        const render = performance.now() - t;
        t = performance.now();
        const out = win.NP.editor._extractFormats();
        const extract = performance.now() - t;
        expect(out.length).toBe(6000);
        expect(out[5999]).toMatchObject({ start: "6000.5", end: "6000.11", bold: true });
        expect(render).toBeLessThan(2500);
        expect(extract).toBeLessThan(2500);
    });

    it("overlapping formats still split into the right runs", () => {
        const win = loadApp(["js/utils.js", "js/editor.js"]);
        const ed = win.document.getElementById("editor");
        win.NP.editor.el = ed;
        win.NP.editor.renderContent(ed, "abcdefghij", [
            { start: "1.0", end: "1.6", bold: true }, { start: "1.3", end: "1.9", italic: true }]);
        expect(ed.innerHTML).toBe("<strong>abc</strong><strong><em>def</em></strong><em>ghi</em>j");
    });
});

describe("a Markdown paragraph of 80 000 lines (R4)", () => {
    it("renders instead of 'Maximum call stack size exceeded'", () => {
        const win = loadApp(["vendor/markdown-it/markdown-it.min.js", "vendor/markdown-it-task-lists/markdown-it-task-lists.min.js",
            "vendor/dompurify/purify.min.js", "vendor/highlight/highlight.min.js", "js/utils.js",
            "js/syntax-highlight.js", "js/markdown.js"]);
        const preview = win.document.getElementById("md-preview");
        const src = Array.from({ length: 80000 }, (_, i) => "w" + i).join("\n");
        expect(() => win.NP.markdown.renderInto(preview, src)).not.toThrow();
        expect(preview.textContent).toContain("w79999");
    }, 60000);
});

describe("find-all while typing (R5)", () => {
    function open() {
        const win = loadApp(["js/utils.js", "js/find-all.js"]);
        const notes = {};
        const tree = [];
        for (let i = 0; i < 50; i++) {
            notes["n" + i] = "alpha beta gamma " + i;
            tree.push({ id: "n" + i, name: "Note " + i, type: "note" });
        }
        win.NP.state = { data: { tree, notes } };
        win.NP.findAll.show();
        return { win, input: win.document.querySelector(".np-findall-overlay input") };
    }
    const results = (win) => win.document.querySelectorAll(".np-findall-result").length;

    it("searches once typing pauses, and Enter uses what is typed right now", async () => {
        vi.useFakeTimers();
        try {
            const { win, input } = open();
            const before = results(win);
            for (const ch of "gam") {
                input.value += ch;
                input.dispatchEvent(new win.Event("input"));
            }
            expect(results(win)).toBe(before);           // not yet
            vi.advanceTimersByTime(200);
            expect(results(win)).toBeGreaterThan(0);
            input.value = "nothing-like-this";
            input.dispatchEvent(new win.Event("input"));
            input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
            expect(results(win)).toBe(0);                // fresh, not the "gam" list
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("the coloured Markdown source of a long note (R5)", () => {
    function setup() {
        const win = loadApp(["js/md-source.js"], { body:
            '<div id="md-source"><div id="md-highlight"></div><textarea id="editor-md"></textarea></div>' });
        win.document.dispatchEvent(new win.Event("DOMContentLoaded"));
        return { win, ta: win.document.getElementById("editor-md"),
            hl: win.document.getElementById("md-highlight"), box: win.document.getElementById("md-source") };
    }

    it("plain text and line breaks are one text node, not one per line", () => {
        const { win, ta, hl } = setup();
        ta.value = Array.from({ length: 500 }, (_, i) => "plain line " + i).join("\n");
        win.NP.mdSource.refresh();
        expect(hl.childNodes.length).toBe(1);
        expect(hl.textContent).toBe(ta.value);
    });

    it("over 20 000 characters: recoloured after a pause, plain text meanwhile", () => {
        vi.useFakeTimers();
        try {
            const { win, ta, hl, box } = setup();
            ta.value = "# Title\n" + "x".repeat(25000);
            win.NP.mdSource.refresh();
            expect(box.classList.contains("md-hl-on")).toBe(true);
            ta.value += "y";
            ta.dispatchEvent(new win.Event("input"));
            expect(box.classList.contains("md-hl-on")).toBe(false);   // the textarea's own text shows
            vi.advanceTimersByTime(300);
            expect(box.classList.contains("md-hl-on")).toBe(true);
            expect(hl.textContent.endsWith("y")).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});

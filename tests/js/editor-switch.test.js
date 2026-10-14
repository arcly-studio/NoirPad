// K1: switching notes quickly must never save one note's text under another
// note's id (loadNote sets the new id before the new content has arrived).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

let win;
let pending;   // id -> resolve function of the outstanding getNote
let saved;     // [id, content]

function deferredApi() {
    pending = {};
    saved = [];
    return {
        getNote: vi.fn((id) => new Promise((resolve) => { pending[id] = resolve; })),
        saveNote: vi.fn((id, content) => { saved.push([id, content]); return Promise.resolve({}); }),
    };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    win = loadApp(["js/utils.js", "js/editor.js"]);
    win.NP.state = { data: { tree: [
        { id: "A", name: "A", type: "note" },
        { id: "B", name: "B", type: "note" },
        { id: "C", name: "C", type: "note" },
    ] } };
    win.NP.api = deferredApi();
    win.NP.editor.init();
});

async function open(id, content) {
    const p = win.NP.editor.loadNote(id);
    pending[id]({ content, formats: [] });
    await p;
}

describe("switching notes (K1)", () => {
    it("a save while the next note is still loading writes nothing", async () => {
        await open("A", "text of A");
        win.NP.editor.loadNote("B");          // B's content not here yet
        await win.NP.editor.save(true);        // e.g. tabs.activate on the next click
        expect(saved).toEqual([]);
    });

    it("a late answer for a note the user already left is ignored", async () => {
        await open("A", "text of A");
        win.NP.editor.loadNote("B");
        const c = win.NP.editor.loadNote("C");
        pending.C({ content: "text of C", formats: [] });
        await c;
        pending.B({ content: "text of B", formats: [] });   // arrives last
        await flush();
        expect(win.NP.editor.el.textContent).toContain("text of C");
        expect(win.NP.editor.el.textContent).not.toContain("text of B");
        await win.NP.editor.save(false);
        expect(saved).toEqual([["C", "text of C"]]);
    });

    it("normal saves still work", async () => {
        await open("A", "text of A");
        win.NP.editor.el.textContent = "edited A";
        await win.NP.editor.save(false);
        expect(saved).toEqual([["A", "edited A"]]);
    });
});

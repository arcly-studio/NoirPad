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

describe("long notes are saved before the window closes (K5)", () => {
    it("typing in a rich-text note is saved shortly after the typing stops", async () => {
        await open("A", "short");
        win.NP.editor.el.textContent = "x".repeat(100000);   // far above keepalive's 64 kB
        win.NP.editor.el.dispatchEvent(new win.Event("input", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 1600));        // well before the 30 s net
        expect(saved.length).toBe(1);
        expect(saved[0][0]).toBe("A");
        expect(saved[0][1].length).toBe(100000);
    });

    it("flushForClose saves the open note and resolves when it is stored", async () => {
        await open("A", "text of A");
        win.NP.editor.el.textContent = "y".repeat(90000);
        await win.NP.editor.flushForClose();
        expect(saved).toEqual([["A", "y".repeat(90000)]]);
    });
});

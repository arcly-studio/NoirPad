// T1 / T2 (review 2): deleting a folder (or a note) that is open in a tab.
import { describe, expect, it } from "vitest";
import { flush, startApp } from "./flow.js";

const TREE = [
    { id: "F", name: "Folder", type: "folder", children: [
        { id: "A", name: "A", type: "note" },
        { id: "S", name: "Sub", type: "folder", children: [{ id: "B", name: "B", type: "note" }] },
    ] },
    { id: "C", name: "C", type: "note" },
];
const NOTES = { A: "text of A", B: "text of B", C: "text of C" };

async function app() {
    const a = startApp({ tree: TREE, notes: NOTES });
    await a.ready();
    return a;
}

describe("deleting a folder with an open note (T1)", () => {
    it("closes the note's tab, shows the start page and nothing typed can get lost", async () => {
        const a = await app();
        await a.open("A");
        a.type("text of A + typed just before");
        await a.NP.tree.deleteSelected("F");
        await flush();
        // What was typed went to the trash with the note.
        expect(a.srv.trash.notes.A).toBe("text of A + typed just before");
        // No tab and no editor is left on the trashed note.
        expect(a.tabs()).toEqual([]);
        expect(a.NP.state.currentNoteId).toBe(null);
        expect(a.NP.editor._currentNoteId).toBe(null);
        expect(a.NP.editor.el.contentEditable).toBe("false");
        expect(a.win.document.body.classList.contains("np-no-note")).toBe(true);
        // Nothing was sent into the trashed note.
        await a.NP.editor.save(true);
        expect(a.srv.refused).toEqual([]);
    });

    it("closes the tabs of every note in the subtree, the other tabs stay", async () => {
        const a = await app();
        await a.open("B");
        await a.open("C");
        await a.open("A");
        await a.NP.tree.deleteSelected("F");
        await flush();
        expect(a.tabs()).toEqual(["C"]);
        expect(a.NP.state.activeTabId).toBe(null);
        expect(a.NP.editor._currentNoteId).toBe(null);
    });

    it("deleting a folder whose note is open in a background tab keeps the open note", async () => {
        const a = await app();
        await a.open("A");
        await a.open("C");
        a.type("C edited");
        await a.NP.tree.deleteSelected("F");
        await flush();
        expect(a.tabs()).toEqual(["C"]);
        expect(a.NP.state.activeTabId).toBe("C");
        expect(a.NP.editor._currentNoteId).toBe("C");
        await a.NP.editor.save(true);
        expect(a.srv.notes.C).toBe("C edited");
        expect(a.srv.refused).toEqual([]);
    });
});

describe("deleting a note open in a background tab (T2)", () => {
    it("leaves no zombie tab that would open the trashed note", async () => {
        const a = await app();
        await a.open("A");
        await a.open("C");
        await a.NP.tree.deleteSelected("A");
        await flush();
        expect(a.tabs()).toEqual(["C"]);
        expect(a.NP.state.activeTabId).toBe("C");
        expect([...a.win.document.querySelectorAll(".tab-pill")].map((p) => p.dataset.id)).toEqual(["C"]);
    });

    it("deleting the open note shows the start page, not a neighbour under a stale tab", async () => {
        const a = await app();
        await a.open("C");
        await a.open("A");
        await a.NP.tree.deleteSelected("A");
        await flush();
        expect(a.tabs()).toEqual(["C"]);
        expect(a.NP.state.activeTabId).toBe(null);
        expect(a.NP.editor._currentNoteId).toBe(null);
        expect(a.win.document.querySelector(".tab-pill.active")).toBe(null);
    });
});

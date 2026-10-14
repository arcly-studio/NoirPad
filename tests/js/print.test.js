// PDF export = the browser print dialog over the live editor DOM.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

let win;

beforeEach(() => {
    win = loadApp(["js/utils.js", "js/editor.js", "js/markdown.js", "js/print.js"]);
    win.NP.state = {
        currentNoteId: "n1",
        data: { tree: [{ id: "n1", name: "Úkoly – řešení", type: "note" }] },
    };
    win.NP.dialog = { alert: vi.fn(() => Promise.resolve()) };
});

describe("PDF export", () => {
    it("prints the rich-text note with the note name as document title", () => {
        let titleDuringPrint = null;
        win.print = vi.fn(() => { titleDuringPrint = win.document.title; });
        win.NP.editor.renderContent(win.document.getElementById("editor"), "obsah", []);

        win.NP.print.exportCurrentNote();

        expect(win.print).toHaveBeenCalledTimes(1);
        expect(titleDuringPrint).toBe("Úkoly – řešení");
        expect(win.document.body.classList.contains("np-print-wrapped")).toBe(true);
    });

    it("refuses without a selected note", () => {
        win.print = vi.fn();
        win.NP.state.currentNoteId = null;
        win.NP.print.exportCurrentNote();
        expect(win.print).not.toHaveBeenCalled();
        expect(win.NP.dialog.alert).toHaveBeenCalled();
    });
});

// R6 (review 2, NoirPad-web with two windows): a note saved in another
// window meanwhile is never overwritten silently.
import { describe, expect, it } from "vitest";
import { flush, startApp } from "./flow.js";

const TREE = [{ id: "A", name: "Alpha", type: "note" }, { id: "B", name: "Beta", type: "note" }];

async function app(opts = {}) {
    const a = startApp({ tree: TREE, notes: { A: "text of A", B: "text of B" }, ...opts });
    await a.ready();
    await a.open("A");
    a.srv.notes.A = "saved in the other window";          // the other window
    return a;
}

describe("a note changed in another window (R6)", () => {
    it("the save asks; 'keep mine' saves nothing and the autosave does not nag", async () => {
        const a = await app();
        a.type("typed here");
        a.srv.confirmAnswer = false;
        expect(await a.NP.editor.save(true)).toBe(false);
        expect(a.NP.dialog.confirm).toHaveBeenCalledTimes(1);
        expect(a.NP.dialog.confirm.mock.calls[0][0]).toContain("Alpha");
        expect(a.srv.notes.A).toBe("saved in the other window");
        expect(a.NP.editor.el.textContent).toBe("typed here");      // nothing lost here either
        a.type("typed here, more");
        expect(await a.NP.editor.save(true)).toBe(false);
        expect(a.NP.dialog.confirm).toHaveBeenCalledTimes(1);       // asked once
        expect(a.NP.dialog.failed).not.toHaveBeenCalled();
    });

    it("'overwrite with mine' saves this text", async () => {
        const a = await app();
        a.type("typed here");
        a.srv.confirmAnswer = true;
        expect(await a.NP.editor.save(true)).toBe(true);
        expect(a.srv.notes.A).toBe("typed here");
        // and the next save is an ordinary one
        a.type("typed here again");
        expect(await a.NP.editor.save(true)).toBe(true);
        expect(a.NP.dialog.confirm).toHaveBeenCalledTimes(1);
        expect(a.srv.notes.A).toBe("typed here again");
    });

    it("without a change elsewhere nothing is asked, also after many saves", async () => {
        const a = startApp({ tree: TREE, notes: { A: "text of A", B: "text of B" } });
        await a.ready();
        await a.open("A");
        for (const t of ["one", "two", "three"]) {
            a.type(t);
            expect(await a.NP.editor.save(true)).toBe(true);
        }
        expect(a.NP.dialog.confirm).not.toHaveBeenCalled();
        expect(a.srv.notes.A).toBe("three");
    });

    it("hiding the window does not put an older text back over the other window's", async () => {
        const a = await app();
        const sent = [];
        a.NP.api.fetch = (url, opts) => { sent.push(JSON.parse(opts.body)); return Promise.resolve({ ok: false }); };
        a.NP.editor._flushBeacon(false);                          // unchanged here: nothing sent
        expect(sent).toEqual([]);
        a.type("typed, then hidden");
        a.NP.editor._flushBeacon(false);
        expect(sent).toHaveLength(1);
        expect(sent[0].base_rev).toBe("r:text of A");             // the server refuses it (409)
        await flush();
    });
});

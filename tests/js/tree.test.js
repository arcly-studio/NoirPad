// The sidebar tree: trash buttons (N1) and favorites pinned in their folder (N2).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

let win;
let calls;

function setup(data, open = {}) {
    win = loadApp(["js/utils.js", "js/tree.js"], { body: '<div id="tree-container"></div>' });
    calls = [];
    const ok = (name) => vi.fn((...args) => { calls.push([name, ...args]); return Promise.resolve({}); });
    win.NP.state = {
        data: { tree: [], favorites: [], trash: { tree: [], notes: {} }, ...data },
        selectedId: null,
        getFolderOpenState: (id) => open[id] !== false,
        setFolderOpenState: () => {},
        init: () => Promise.resolve(),
    };
    win.NP.api = { restoreFromTrash: ok("restore"), deleteTrashItem: ok("delete") };
    win.NP.trash = { empty: ok("empty") };
    win.NP.dialog = { confirm: vi.fn(() => Promise.resolve(true)) };
    win.NP.tree.render();
}

const rows = () => [...win.document.querySelectorAll("#tree-container .tree-item:not(.tree-item--trash)")]
    .map((el) => el.textContent.replace(/[◆★▽▷📁]/gu, "").trim());
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("trash (N1)", () => {
    beforeEach(() => {
        setup({ trash: { tree: [{ id: "t1", name: "Stará <b>", type: "note" }], notes: {} } });
    });

    it("restore and delete are real buttons with a label and their own colours", () => {
        const row = win.document.querySelector(".tree-item--trash");
        const restore = row.querySelector("button.trash-btn--restore");
        const del = row.querySelector("button.trash-btn--danger");
        expect(restore.title).toBe("Restore");
        expect(restore.getAttribute("aria-label")).toBe("Restore 'Stará <b>'");
        expect(del.title).toBe("Delete permanently");
        expect(del.getAttribute("aria-label")).toBe("Delete 'Stará <b>' permanently");
        expect(row.querySelector("b")).toBeNull();          // the name is text, not HTML
    });

    it("the 32×32 minimum is in the stylesheet", async () => {
        const fs = await import("node:fs");
        const css = fs.readFileSync(new URL("../../static/css/noirpad.css", import.meta.url), "utf8");
        const rule = css.match(/\.trash-btn \{[^}]*\}/)[0];
        expect(rule).toContain("min-width: 32px");
        expect(rule).toContain("min-height: 32px");
    });

    it("permanent delete asks first (danger dialog) and only then deletes", async () => {
        win.NP.dialog.confirm = vi.fn(() => Promise.resolve(false));
        win.document.querySelector(".tree-trash-delete").click();
        await flush();
        expect(win.NP.dialog.confirm.mock.calls[0][1]).toMatchObject({ danger: true });
        expect(calls).toEqual([]);

        win.NP.dialog.confirm = vi.fn(() => Promise.resolve(true));
        win.document.querySelector(".tree-trash-delete").click();
        await flush();
        expect(calls).toEqual([["delete", "t1"]]);
    });

    it("restore needs no confirmation", async () => {
        win.document.querySelector(".tree-trash-restore").click();
        await flush();
        expect(calls).toEqual([["restore", "t1"]]);
        expect(win.NP.dialog.confirm).not.toHaveBeenCalled();
    });

    it("the trash header has an 'Empty trash' button", () => {
        const btn = win.document.querySelector(".tree-trash-header button");
        expect(btn.textContent).toBe("Empty trash");
        btn.click();
        expect(calls).toEqual([["empty"]]);
    });
});

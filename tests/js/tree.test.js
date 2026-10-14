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

describe("favorites stay in their folder (N2)", () => {
    const tree = () => [
        { id: "n1", name: "Root note 1", type: "note" },
        { id: "f1", name: "Work", type: "folder", children: [
            { id: "a", name: "A", type: "note" },
            { id: "sub", name: "Sub", type: "folder", children: [{ id: "s1", name: "Deep", type: "note" }] },
            { id: "b", name: "B", type: "note" },
            { id: "c", name: "C", type: "note" },
        ] },
        { id: "n2", name: "Root note 2", type: "note" },
        { id: "f2", name: "Home", type: "folder", children: [] },
    ];

    it("without favorites: folders, then notes, each in the user's order", () => {
        setup({ tree: tree() });
        expect(rows()).toEqual(["Work", "Sub", "Deep", "A", "B", "C", "Home", "Root note 1", "Root note 2"]);
    });

    it("a favorite note is pinned at the top of its own folder's notes, below the subfolders", () => {
        setup({ tree: tree(), favorites: ["c"] });
        expect(rows()).toEqual(["Work", "Sub", "Deep", "C", "A", "B", "Home", "Root note 1", "Root note 2"]);
        const c = win.document.querySelector('[data-id="c"]');
        const a = win.document.querySelector('[data-id="a"]');
        expect(c.style.paddingLeft).toBe(a.style.paddingLeft);     // same depth as its siblings
        expect(c.textContent).toContain("★");
    });

    it("at the root too, and never above the folders", () => {
        setup({ tree: tree(), favorites: ["n2"] });
        expect(rows()).toEqual(["Work", "Sub", "Deep", "A", "B", "C", "Home", "Root note 2", "Root note 1"]);
    });

    it("favorites are neither duplicated nor lost, also in a closed folder", () => {
        setup({ tree: tree(), favorites: ["c", "s1", "n2", "f2"] }, { f1: false });
        expect(rows()).toEqual(["Home", "Work", "Root note 2", "Root note 1"]);  // favorite folder first
        setup({ tree: tree(), favorites: ["c", "s1", "n2", "f2"] });
        const ids = [...win.document.querySelectorAll(".tree-item[data-id]")].map((el) => el.dataset.id);
        expect(ids.sort()).toEqual(["a", "b", "c", "f1", "f2", "n1", "n2", "s1", "sub"]);
    });

    it("the stored tree order is not changed", () => {
        const data = tree();
        setup({ tree: data, favorites: ["c", "n2"] });
        expect(data[1].children.map((i) => i.id)).toEqual(["a", "sub", "b", "c"]);
        expect(data.map((i) => i.id)).toEqual(["n1", "f1", "n2", "f2"]);
    });
});

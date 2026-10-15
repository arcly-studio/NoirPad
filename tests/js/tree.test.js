// The sidebar tree: trash buttons (N1) and favorites pinned in their folder (N2).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

let win;
let calls;

function setup(data, open = {}) {
    win = loadApp(["js/utils.js", "js/topbar.js", "js/tree.js"], {
        body: '<div id="tree-container"></div><div class="side-head" id="side-tags-head"></div><div id="tag-list"></div>' });
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

describe("folder rows (D2 / N8)", () => {
    function setupFolders() {
        const state = { f1: false };
        setup({ tree: [{ id: "f1", name: "Work", type: "folder", children: [{ id: "a", name: "A", type: "note" }] }] });
        win.NP.state.getFolderOpenState = (id) => !!state[id];
        win.NP.state.setFolderOpenState = (id, open) => { state[id] = open; };
        win.NP.tree.render();
        return state;
    }
    const row = () => win.document.querySelector('.tree-item[data-id="f1"]');

    it("a click anywhere on the row opens and selects the folder; the next one closes it", () => {
        const state = setupFolders();
        row().querySelector("span:last-child").click();      // the name
        expect(state.f1).toBe(true);
        expect(win.NP.state.selectedId).toBe("f1");
        expect(win.document.querySelector('.tree-item[data-id="a"]')).not.toBeNull();
        row().click();                                        // the row itself
        expect(state.f1).toBe(false);
        expect(win.NP.state.selectedId).toBe("f1");
    });

    it("the arrow still only toggles", () => {
        const state = setupFolders();
        // the chevron is an SVG icon (G2): no .click() on SVG in jsdom
        row().querySelector(".tree-arrow").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
        expect(state.f1).toBe(true);
        expect(win.NP.state.selectedId).toBeNull();
    });
});

describe("drag and drop targets (C3, C4)", () => {
    const tree = () => [
        { id: "f1", name: "Work", type: "folder", children: [
            { id: "sub", name: "Sub", type: "folder", children: [] },
            { id: "a", name: "A", type: "note" },
        ] },
        { id: "f2", name: "Home", type: "folder", children: [] },
        { id: "n1", name: "N1", type: "note" },
        { id: "n2", name: "N2", type: "note" },
    ];

    it("a folder never goes into itself or its own subfolder", () => {
        setup({ tree: tree() });
        const pos = win.NP.tree._dropPosition;
        expect(pos("f1", "sub", "inside")).toBeNull();
        expect(pos("f1", "sub", "before")).toBeNull();
        expect(pos("f1", "f1", "inside")).toBeNull();
        expect(pos("f1", "f2", "inside")).toBe("inside");
    });

    it("before/after only within the same group; across groups a folder takes it inside", () => {
        setup({ tree: tree(), favorites: ["n2"] });
        const pos = win.NP.tree._dropPosition;
        expect(pos("n1", "a", "after")).toBe("after");          // note next to a note
        expect(pos("n1", "f2", "before")).toBe("inside");       // note dropped at a folder's edge
        expect(pos("n1", "n2", "before")).toBeNull();           // plain note before a favorite
        expect(pos("f2", "sub", "after")).toBe("after");        // folder next to a folder
        expect(pos("f2", "n1", "before")).toBeNull();           // folder among the notes
        expect(pos("n1", "a", "inside")).toBeNull();            // nothing goes into a note
    });

    it("a refused move tells the user", async () => {
        setup({ tree: tree() });
        win.NP.api.move = vi.fn(() => Promise.reject(new Error("A folder cannot be moved into itself.")));
        win.NP.dialog.failed = vi.fn();
        const target = win.document.querySelector('.tree-item[data-id="f2"]');
        target.setAttribute("data-drop-pos", "inside");
        const ev = new win.Event("drop", { bubbles: true, cancelable: true });
        ev.dataTransfer = { getData: () => "f1" };
        target.dispatchEvent(ev);
        await new Promise((r) => setTimeout(r, 0));
        expect(win.NP.dialog.failed).toHaveBeenCalledTimes(1);
    });
});

describe("G2: tree rows, TAGS section and the tag filter", () => {
    const tree = () => [
        { id: "f1", name: "Projects", type: "folder", children: [
            { id: "a", name: "Ingest", type: "note", tags: ["python", "Work"] },
            { id: "b", name: "Checklist", type: "note", tags: ["work"] },
        ] },
        { id: "c", name: "Journal", type: "note", tags: ["personal"] },
    ];
    const names = () => [...win.document.querySelectorAll("#tree-container .tree-name")].map((e) => e.textContent);
    const tagRows = () => [...win.document.querySelectorAll("#tag-list .tag-row")];

    it("no ◆ markers; a favourite has its ★ at the end of the row; folders get a mark", () => {
        setup({ tree: tree(), favorites: ["a"] });
        const a = win.document.querySelector(".tree-item[data-id='a']");
        expect(a.textContent).not.toContain("◆");
        expect(a.lastElementChild.className).toBe("tree-star");
        expect(win.document.querySelector(".tree-item[data-id='f1'] .tree-folder-mark")).not.toBeNull();
        expect(win.document.querySelector(".tree-item[data-id='c'] .tree-star")).toBeNull();
    });

    it("lists every tag once (case ignored) with its note count", () => {
        setup({ tree: tree() });
        expect(tagRows().map((b) => b.textContent)).toEqual(["#personal1", "#python1", "#Work2"]);
        expect(win.document.getElementById("side-tags-head").hidden).toBe(false);
    });

    it("click on a tag = filter; click again = all notes", () => {
        setup({ tree: tree() });
        tagRows()[2].click();                                   // #Work
        expect(names()).toEqual(["Projects", "Ingest", "Checklist"]);
        expect(tagRows()[2].getAttribute("aria-pressed")).toBe("true");
        tagRows()[0].click();                                   // #personal
        expect(names()).toEqual(["Journal"]);
        tagRows()[0].click();                                   // off again
        expect(names()).toEqual(["Projects", "Ingest", "Checklist", "Journal"]);
        expect(tagRows().every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    });

    it("the filter opens collapsed folders that hold a match", () => {
        setup({ tree: tree() }, { f1: false });
        expect(names()).toEqual(["Projects", "Journal"]);
        win.NP.tree.setTagFilter("python");
        expect(names()).toEqual(["Projects", "Ingest"]);
    });

    it("no tags: the TAGS heading is hidden", () => {
        setup({ tree: [{ id: "x", name: "X", type: "note" }] });
        expect(win.document.getElementById("side-tags-head").hidden).toBe(true);
    });

    it("right-click: rename, move, favourite, delete — and Move to… moves", async () => {
        setup({ tree: tree() });
        win.NP.menu.open = vi.fn();
        win.NP.api.move = vi.fn(() => Promise.resolve({}));
        const row = win.document.querySelector(".tree-item[data-id='c']");
        row.dispatchEvent(new win.MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 }));
        const items = win.NP.menu.open.mock.calls[0][1].filter((i) => i !== "-");
        expect(items.map((i) => i.id)).toEqual(["rename", "move", "favorite", "delete"]);
        items.find((i) => i.id === "move").run();
        const targets = win.NP.menu.open.mock.calls[1][1];
        expect(targets.map((i) => [i.id, !!i.disabled])).toEqual([["root", true], ["f1", false]]);
        targets[1].run();
        await flush();
        expect(win.NP.api.move).toHaveBeenCalledWith("c", "f1", "inside");
    });
});

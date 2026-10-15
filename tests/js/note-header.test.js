// G3: "> Name" renamed in place, tags under it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

const BODY = `
  <div id="note-header">
    <div id="note-title-row"><span id="note-prefix">&gt;</span><input id="note-title-input"></div>
    <div id="tag-bar"><input id="tag-input"></div>
  </div>
  <button id="other">x</button>`;

let win, title, renamed, item;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    win = loadApp(["js/utils.js", "js/tags.js", "js/app.js"], { body: BODY });
    item = { id: "n1", name: "Ingest service", type: "note", tags: ["python", "work"] };
    renamed = [];
    win.NP.state = { currentNoteId: "n1", data: { tree: [item] }, openTabs: [{ id: "n1", name: "Ingest service" }] };
    win.NP.api = {
        rename: vi.fn((id, name) => { renamed.push([id, name]); return Promise.resolve({}); }),
        setTags: vi.fn(() => Promise.resolve({})),
    };
    win.NP.editor = { _findItemInTree: (tree, id) => tree.find((i) => i.id === id) };
    win.NP.tree = { render: vi.fn(), renderTags: vi.fn(), setTagFilter: vi.fn() };
    win.NP.tabs = { render: vi.fn() };
    win.NP.dialog = { failed: vi.fn() };
    win.NP.app.bindButtons();
    title = win.document.getElementById("note-title-input");
    title.value = item.name;
    title.readOnly = false;          // editor.loadNote does this for an open note
});

const key = (k) => title.dispatchEvent(new win.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

describe("G3: rename by clicking the name", () => {
    it("click, type, Enter → renamed; tree and tab follow", async () => {
        title.focus();
        title.value = "Ingest pipeline ";
        key("Enter");
        await flush();
        expect(win.document.activeElement).not.toBe(title);
        expect(renamed).toEqual([["n1", "Ingest pipeline"]]);
        expect(item.name).toBe("Ingest pipeline");
        expect(win.NP.state.openTabs[0].name).toBe("Ingest pipeline");
        expect(win.NP.tree.render).toHaveBeenCalled();
        expect(win.NP.tabs.render).toHaveBeenCalled();
    });

    it("leaving the field keeps the new name too", async () => {
        title.focus();
        title.value = "Nový název";
        win.document.getElementById("other").focus();
        await flush();
        expect(renamed).toEqual([["n1", "Nový název"]]);
    });

    it("Escape goes back to the old name, nothing is saved", async () => {
        title.focus();
        title.value = "Překlep";
        key("Escape");
        await flush();
        expect(title.value).toBe("Ingest service");
        expect(renamed).toEqual([]);
    });

    it("an empty or unchanged name is not saved", async () => {
        title.focus();
        title.value = "   ";
        key("Enter");
        await flush();
        expect(title.value).toBe("Ingest service");
        title.focus();
        key("Enter");
        await flush();
        expect(renamed).toEqual([]);
    });

    it("a failed rename puts the old name back and says why", async () => {
        win.NP.api.rename = vi.fn(() => Promise.reject(new Error("nope")));
        title.focus();
        title.value = "X";
        key("Enter");
        await flush();
        await flush();
        expect(title.value).toBe("Ingest service");
        expect(win.NP.dialog.failed).toHaveBeenCalled();
    });

    it("read-only (no note open) never renames", async () => {
        title.readOnly = true;
        title.focus();
        title.value = "X";
        key("Enter");
        await flush();
        expect(renamed).toEqual([]);
    });
});

describe("G3: tags under the name", () => {
    it("#tag buttons before the + tag field; × removes, a click filters the tree", async () => {
        win.NP.tags.render();
        const pills = [...win.document.querySelectorAll("#tag-bar .np-tag-pill")];
        expect(pills.map((p) => p.querySelector(".np-tag-name").textContent)).toEqual(["#python", "#work"]);
        expect(win.document.getElementById("tag-bar").lastElementChild.id).toBe("tag-input");
        pills[0].querySelector(".np-tag-name").click();
        expect(win.NP.tree.setTagFilter).toHaveBeenCalledWith("python");
        pills[1].querySelector(".np-tag-remove").click();
        await flush();
        expect(win.NP.api.setTags).toHaveBeenCalledWith("n1", ["python"]);
        expect(pills[1].querySelector(".np-tag-remove").getAttribute("aria-label")).toBe("Remove the tag work");
    });
});

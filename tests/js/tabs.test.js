// Tabs in the top bar (G1) with the keyboard (review fix).
import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

describe("tabs: ARIA + keyboard", () => {
    it("← → move, Enter opens, Delete closes the focused tab; × is not a nested button", async () => {
        const win = loadApp(["js/utils.js", "js/tabs.js"], { body: '<div id="tab-bar"></div>' });
        win.NP.state = {
            openTabs: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }],
            activeTabId: "a", currentNoteId: "a",
        };
        win.NP.editor = { loadNote: vi.fn(() => Promise.resolve()), save: vi.fn(), showWelcome: vi.fn() };
        win.NP.tabs.render();
        const pills = () => [...win.document.querySelectorAll(".tab-pill")];
        const key = (k) => win.document.activeElement.dispatchEvent(
            new win.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
        expect(pills().map((p) => [p.getAttribute("role"), p.getAttribute("aria-selected"), p.tabIndex]))
            .toEqual([["tab", "true", 0], ["tab", "false", -1]]);
        expect(win.document.querySelector(".tab-pill button")).toBeNull();
        pills()[0].focus();
        key("ArrowRight");
        expect(win.document.activeElement.textContent).toContain("Beta");
        key("Enter");
        await new Promise((r) => setTimeout(r, 0));     // the open note is saved first (E2)
        expect(win.NP.state.activeTabId).toBe("b");
        key("Delete");
        await new Promise((r) => setTimeout(r, 0));
        expect(win.NP.state.openTabs.map((t) => t.id)).toEqual(["a"]);
    });
});

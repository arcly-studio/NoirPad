// C5: a tag that differs only in letter case is not added twice.
import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

describe("tags (C5)", () => {
    it("Work and work are the same tag", () => {
        const win = loadApp(["js/utils.js", "js/tags.js"]);
        win.NP.state = { currentNoteId: "n1", data: { tree: [{ id: "n1", name: "N", type: "note", tags: ["Work"] }] } };
        win.NP.api = { setTags: vi.fn(() => Promise.resolve()) };
        win.NP.tags.addTag("work");
        win.NP.tags.addTag("   ");
        expect(win.NP.api.setTags).not.toHaveBeenCalled();
        win.NP.tags.addTag("Home");
        expect(win.NP.api.setTags).toHaveBeenCalledWith("n1", ["Work", "Home"]);
    });
});

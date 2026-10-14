// D13: F11 / :fullscreen toggle full screen (was a no-op: NP.fullscreen missing).
import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

describe("NP.fullscreen", () => {
    it("in a browser uses the Fullscreen API, both ways", async () => {
        const win = loadApp(["js/utils.js"]);
        win.document.documentElement.requestFullscreen = vi.fn(() => Promise.resolve());
        win.document.exitFullscreen = vi.fn(() => Promise.resolve());
        await win.NP.fullscreen.toggle();
        expect(win.document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
        Object.defineProperty(win.document, "fullscreenElement", { value: win.document.body, configurable: true });
        await win.NP.fullscreen.toggle();
        expect(win.document.exitFullscreen).toHaveBeenCalledTimes(1);
    });

    it("in the desktop app asks the backend to switch the window", async () => {
        const win = loadApp(["js/utils.js"]);
        win.NP.api = { hasToken: () => true, fetch: vi.fn(() => Promise.resolve({ ok: true })) };
        await win.NP.fullscreen.toggle();
        expect(win.NP.api.fetch).toHaveBeenCalledWith("/api/desktop/fullscreen", { method: "POST" });
    });
});

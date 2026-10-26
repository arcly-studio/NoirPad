// Review 2, UI: U8 (glitch needs Glow), U11 (default keys the browser takes).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadApp } from "./harness.js";

const INDEX = fs.readFileSync(path.resolve(import.meta.dirname, "../../static/index.html"), "utf8");
const SETTINGS = INDEX.match(/<div id="settings-overlay">[\s\S]*?<!-- ============ Context Menu/)[0];

describe("the glitch effect without Glow (U8)", () => {
    function boot(glow) {
        const win = loadApp(["js/utils.js", "js/effects.js", "js/matrix-rain.js", "js/settings.js"],
            { body: '<div id="editor"></div>' + SETTINGS });
        win.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {} });
        win.requestAnimationFrame = () => 0;
        win.NP.api = { saveSettings: () => Promise.resolve({}) };
        win.NP.state = { data: { theme: "matrix", glow_enabled: glow, glitch_effect: true } };
        win.NP.settings.init();
        win.NP.settings.applyRuntimeState();
        return win;
    }

    it("Glow off: the switch is off-limits and says it needs Glow", () => {
        const win = boot(false);
        const sw = win.document.getElementById("setting-glitch-effect");
        expect(sw.disabled).toBe(true);
        expect(win.document.getElementById("setting-glitch-hint").hidden).toBe(false);
        expect(win.document.getElementById(sw.getAttribute("aria-describedby")).textContent)
            .toBe(win.NP.t("ui.settings.glitchNeedsGlow"));
    });

    it("Glow on: the switch works", () => {
        const win = boot(true);
        expect(win.document.getElementById("setting-glitch-effect").disabled).toBe(false);
        expect(win.document.getElementById("setting-glitch-hint").hidden).toBe(true);
    });
});

describe("default keys the browser takes (U11)", () => {
    function boot(desktop) {
        const win = loadApp(["js/utils.js", "js/shortcuts.js"]);
        win.NP.api = { hasToken: () => desktop, saveSettings: () => Promise.resolve({}) };
        win.NP.state = { data: {} };
        win.NP.shortcuts.init();
        return win;
    }

    it("in the browser NoirPad uses Alt+Shift keys the page actually gets", () => {
        const win = boot(false);
        const sc = win.NP.shortcuts;
        expect(sc.getCurrent("new-note")).toBe("Alt+Shift+N");
        expect(sc.getCurrent("open-font-picker")).toBe("Alt+Shift+T");
        expect(sc.getCurrent("insert-image")).toBe("Alt+Shift+I");
        for (const [id, info] of Object.entries(sc.getAll())) {
            if (!info.current || info.current === "F11") continue;   // F11: the browser's full screen is the same
            expect(sc.validate(info.current).ok, `${id}: ${info.current}`).toBe(true);
        }
    });

    it("the desktop window keeps Ctrl+Shift+N & co. and lets the user set them again", () => {
        const win = boot(true);
        const sc = win.NP.shortcuts;
        expect(sc.getCurrent("new-note")).toBe("Ctrl+Shift+N");
        for (const [id, info] of Object.entries(sc.getAll())) {
            if (!info.current) continue;
            expect(sc.validate(info.current).ok, `${id}: ${info.current}`).toBe(true);
        }
        expect(sc.validate("Ctrl+R").ok).toBe(false);          // still reserved
    });

    it("a custom key stays custom in the browser too", () => {
        const win = loadApp(["js/utils.js", "js/shortcuts.js"]);
        win.NP.api = { hasToken: () => false, saveSettings: () => Promise.resolve({}) };
        win.NP.state = { data: { custom_shortcuts: { "new-note": "Ctrl+Alt+J" } } };
        win.NP.shortcuts.init();
        expect(win.NP.shortcuts.getCurrent("new-note")).toBe("Ctrl+Alt+J");
    });
});

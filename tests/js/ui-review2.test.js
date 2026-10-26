// Review 2, UI and traffic: U8 (glitch needs Glow), U11 (default keys the browser takes), R9.
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

describe("no needless traffic (R9)", () => {
    function api(before, after) {
        const win = loadApp(["js/utils.js", "js/api.js"]);
        const headers = new Map([["ETag", after], ["X-NoirPad-ETag-Before", before], ["content-type", "application/json"]]);
        win.fetch = () => Promise.resolve({ ok: true, status: 200,
            headers: { get: (k) => headers.get(k) ?? null }, json: () => Promise.resolve({ ok: true }) });
        win.NP.state = { etag: "E0", data: { notes: { n: "old" }, note_modes: {} } };
        return win;
    }

    it("a save right after our last poll moves our copy along (next poll: 304)", async () => {
        const win = api("E0", "E1");
        await win.NP.api.saveNote("n", "new", [], { mode: "markdown" });
        expect(win.NP.state.etag).toBe("E1");
        expect(win.NP.state.data.notes.n).toBe("new");
        expect(win.NP.state.data.note_modes.n).toBe("markdown");
    });

    it("someone else wrote in between: our copy stays, the poll fetches it all", async () => {
        const win = api("E7", "E8");
        await win.NP.api.saveNote("n", "new", []);
        expect(win.NP.state.etag).toBe("E0");
        expect(win.NP.state.data.notes.n).toBe("old");
    });

    it("the start writes no settings (theme and orientation are what is stored)", () => {
        const win = loadApp(["js/utils.js", "js/themes.js", "js/effects.js", "js/matrix-rain.js", "js/settings.js"],
            { body: '<div id="editor"></div>' + SETTINGS });
        win.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {} });
        win.requestAnimationFrame = () => 0;
        const saved = [];
        win.NP.api = { saveSettings: (s) => { saved.push(s); return Promise.resolve({}); } };
        win.NP.state = { data: { theme: "nord", page_orientation: "landscape", glow_enabled: false,
            matrix_rain_enabled: false, crt_enabled: false } };
        win.NP.themes.apply(win.NP.state.data.theme);
        win.NP.settings.init();
        win.NP.settings.applyRuntimeState();
        expect(saved).toEqual([]);
        win.NP.themes.apply("dracula");           // a real change is still saved
        expect(saved).toEqual([{ theme: "dracula" }]);
    });
});

describe("locked in another window with unsaved text (R11)", () => {
    function boot(answer) {
        const win = loadApp(["js/utils.js", "js/api.js"]);
        const calls = [];
        win.fetch = (url, opts) => {
            calls.push(url);
            const ok = url.includes("/api/app-lock/unlock");
            return Promise.resolve({ ok, status: ok ? 200 : 423,
                headers: { get: (k) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
                json: () => Promise.resolve({ ok: true }),
                text: () => Promise.resolve('{"detail": {"code": "app_locked"}}') });
        };
        const saves = [];
        win.NP.editor = { _saveState: "dirty", _currentNoteId: "n", save: (s) => { saves.push(s); return Promise.resolve(true); } };
        win.NP.passwordDialog = { ask: () => Promise.resolve(answer) };
        return { win, calls, saves };
    }
    const settle = () => new Promise((r) => setTimeout(r, 0));

    it("asks for the password with the notes hidden, then saves here instead of reloading", async () => {
        const { win, calls, saves } = boot("heslo");
        const seen = [];
        win.NP.passwordDialog.ask = () => { seen.push(win.document.body.classList.contains("np-locked-elsewhere"));
            return Promise.resolve("heslo"); };
        await win.NP.api.saveNote("n", "text", []).catch(() => {});
        for (let i = 0; i < 5; i++) await settle();
        expect(seen).toEqual([true]);                        // nothing readable behind the dialog
        expect(calls).toContain("/api/app-lock/unlock");
        expect(saves).toEqual([true]);
        expect(win.document.body.classList.contains("np-locked-elsewhere")).toBe(false);
    });
});

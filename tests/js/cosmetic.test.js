// C2, C7, C13: shortcuts under open windows, :matrix, Ctrl+Shift+E.
import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

describe("app shortcuts under an open window (C2)", () => {
    function app(bodyExtra = "") {
        const win = loadApp(["js/utils.js", "js/shortcuts.js"], {
            body: `<div id="settings-overlay"></div><div id="editor" contenteditable="true"></div>${bodyExtra}`,
        });
        win.NP.state = { data: { custom_shortcuts: {} } };
        const fired = [];
        win.NP.shortcuts.register("delete", () => fired.push("delete"));
        win.NP.shortcuts.register("open-help", () => fired.push("help"));
        win.NP.shortcuts.init();
        const press = (key) => win.document.body.dispatchEvent(
            new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        return { win, fired, press };
    }

    it("Delete does nothing while Settings is open; F1 still opens help", () => {
        const { win, fired, press } = app();
        win.document.getElementById("settings-overlay").classList.add("visible");
        press("Delete");
        press("F1");
        expect(fired).toEqual(["help"]);
        win.document.getElementById("settings-overlay").classList.remove("visible");
        press("Delete");
        expect(fired).toEqual(["help", "delete"]);
    });

    it("the same under a NoirPad dialog or the help window", () => {
        const { win, fired, press } = app('<div class="np-modal"></div>');
        press("Delete");
        expect(fired).toEqual([]);
        win.document.querySelector(".np-modal").remove();
        win.document.body.insertAdjacentHTML("beforeend", '<div class="np-dialog"></div>');
        press("Delete");
        expect(fired).toEqual([]);
    });
});

describe(":matrix (C7)", () => {
    it("switches the rain on even when Settings had it off, and remembers it", () => {
        const win = loadApp(["js/utils.js", "js/matrix-rain.js"]);
        win.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {} });
        win.requestAnimationFrame = () => 0;
        const saved = [];
        win.NP.state = { data: { matrix_rain_enabled: false } };
        win.NP.api = { saveSettings: (s) => { saved.push(s); return Promise.resolve(); } };
        expect(win.NP.matrixRain.toggle()).toBe(true);
        expect(win.NP.matrixRain.running).toBe(true);
        expect(win.NP.state.data.matrix_rain_enabled).toBe(true);
        expect(win.NP.matrixRain.toggle()).toBe(false);
        expect(saved).toEqual([{ matrix_rain_enabled: true }, { matrix_rain_enabled: false }]);
    });
});

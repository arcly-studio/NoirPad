// G6: Noir effects (glow, matrix rain, CRT) — off for new data, kept for old data.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadApp } from "./harness.js";

const INDEX = fs.readFileSync(path.resolve(import.meta.dirname, "../../static/index.html"), "utf8");
const SETTINGS = INDEX.match(/<div id="settings-overlay">[\s\S]*?<!-- ============ Context Menu/)[0];

function boot(data, { localCrt } = {}) {
    const win = loadApp(["js/utils.js", "js/effects.js", "js/matrix-rain.js", "js/settings.js"],
        { body: '<canvas id="matrix-canvas"></canvas><div id="editor"></div>' + SETTINGS });
    win.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {} });
    win.requestAnimationFrame = () => 0;
    if (localCrt) win.localStorage.setItem("noirpad_crt", "1");
    const saved = [];
    win.NP.api = { saveSettings: (s) => { saved.push(s); return Promise.resolve({}); } };
    win.NP.state = { data: { theme: "matrix", ...data } };
    win.NP.settings.init();
    win.NP.settings.applyRuntimeState();
    const fx = () => saved.filter((x) => !("page_orientation" in x));   // live
    return { win, saved: fx, $: (id) => win.document.getElementById(id) };
}

const glowPx = (win) => win.document.documentElement.style.getPropertyValue("--glow-blur");

describe("G6: Noir effects", () => {
    it("a new install (all effects off): no glow, no rain, no CRT", () => {
        const { win, $ } = boot({ glow_enabled: false, matrix_rain_enabled: false, crt_enabled: false });
        expect(win.document.body.classList.contains("np-glow")).toBe(false);
        expect(glowPx(win)).toBe("0px");
        expect(win.NP.matrixRain.running).toBeFalsy();
        expect(win.document.body.classList.contains("crt-on")).toBe(false);
        expect($("setting-noir-effects").getAttribute("aria-checked")).toBe("false");
        expect($("setting-glow-intensity-row").hidden).toBe(true);
    });

    it("old data keeps what it had (glow + rain on, intensity kept)", () => {
        const { win, $ } = boot({ glow_enabled: true, matrix_rain_enabled: true, glow_intensity: 50 });
        expect(win.document.body.classList.contains("np-glow")).toBe(true);
        expect(glowPx(win)).toBe("11px");               // 22px × 50 %
        expect(win.NP.matrixRain.running).toBe(true);
        expect($("setting-glow").getAttribute("aria-checked")).toBe("true");
        expect($("setting-glow-intensity-row").hidden).toBe(false);
    });

    it("CRT from the old browser-only setting is carried over once", () => {
        const { win, saved } = boot({ glow_enabled: true }, { localCrt: true });
        expect(win.document.body.classList.contains("crt-on")).toBe(true);
        expect(saved()).toEqual([{ crt_enabled: true }]);
        expect(win.localStorage.getItem("noirpad_crt")).toBeNull();
    });

    it("the master switch turns all three on and off", () => {
        const { win, saved, $ } = boot({ glow_enabled: false, matrix_rain_enabled: false, crt_enabled: false });
        $("setting-noir-effects").click();
        expect(saved().at(-1)).toEqual({ glow_enabled: true, matrix_rain_enabled: true, crt_enabled: true });
        expect(win.document.body.classList.contains("crt-on")).toBe(true);
        expect(win.NP.matrixRain.running).toBe(true);
        $("setting-noir-effects").click();
        expect(saved().at(-1)).toEqual({ glow_enabled: false, matrix_rain_enabled: false, crt_enabled: false });
        expect(win.document.body.classList.contains("np-glow")).toBe(false);
        expect(win.NP.matrixRain.running).toBe(false);
    });

    it("one effect alone; the master switch shows 'on' while any is on", () => {
        const { $, saved } = boot({ glow_enabled: false, matrix_rain_enabled: false, crt_enabled: false });
        $("setting-crt").click();
        expect(saved().at(-1)).toEqual({ crt_enabled: true });
        expect($("setting-noir-effects").getAttribute("aria-checked")).toBe("true");
        expect($("setting-glow").getAttribute("aria-checked")).toBe("false");
    });
});

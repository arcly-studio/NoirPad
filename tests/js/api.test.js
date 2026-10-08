// api.js: desktop token handling + headers on every API call (D4, D5).
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

const API_JS = fs.readFileSync(path.resolve(import.meta.dirname, "../../static/js/api.js"), "utf8");

function boot(url) {
    const dom = new JSDOM("<!DOCTYPE html><body></body>", { url, runScripts: "outside-only" });
    const win = dom.window;
    win.fetch = vi.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: () => Promise.resolve({ ok: true }),
    }));
    win.eval(API_JS);
    return win;
}

describe("api.js", () => {
    it("web mode: sends the CSRF header and no token", async () => {
        const win = boot("http://127.0.0.1:8000/");
        await win.NP.api.getData();
        const [, opts] = win.fetch.mock.calls[0];
        expect(opts.headers["X-NoirPad-Request"]).toBe("1");
        expect(opts.headers["X-NoirPad-Token"]).toBeUndefined();
        expect(win.NP.api.hasToken()).toBe(false);
    });

    it("desktop: takes the token from #token=, hides it, sends it", async () => {
        const win = boot("http://127.0.0.1:5555/#token=abc-123");
        expect(win.location.hash).toBe("");
        expect(win.sessionStorage.getItem("noirpad_token")).toBe("abc-123");
        await win.NP.api.saveNote("n1", "x", []);
        const [url, opts] = win.fetch.mock.calls[0];
        expect(url).toBe("/api/note/n1");
        expect(opts.headers["X-NoirPad-Token"]).toBe("abc-123");
        expect(opts.headers["Content-Type"]).toBe("application/json");
    });

    it("NP.api.fetch adds the headers for ad-hoc calls", async () => {
        const win = boot("http://127.0.0.1:5555/#token=t");
        await win.NP.api.fetch("/api/storage");
        expect(win.fetch.mock.calls[0][1].headers["X-NoirPad-Token"]).toBe("t");
    });
});

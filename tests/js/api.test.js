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

    it("desktop export: native save, toast with 'Open folder', no blob download (N6)", async () => {
        const win = boot("http://127.0.0.1:5555/#token=t");
        const headers = new Map([["content-type", "application/json"], ["x-noirpad-skipped", "2"]]);
        win.fetch = vi.fn(() => Promise.resolve({
            ok: true, status: 200,
            headers: { get: (k) => headers.get(k.toLowerCase()) || null },
            json: () => Promise.resolve({ saved: true, name: "x.zip", token: "s1" }),
        }));
        win.NP.t = (key, p) => key + (p && p.name ? ":" + p.name : "");
        win.NP.toast = vi.fn();
        win.URL.createObjectURL = vi.fn();
        const res = await win.NP.api.download("/api/notes/export-md");
        expect(win.fetch.mock.calls[0][1].headers["X-NoirPad-Save-As"]).toBe("1");
        expect(res.get("x-noirpad-skipped")).toBe("2");
        expect(win.URL.createObjectURL).not.toHaveBeenCalled();
        const [msg, opts] = win.NP.toast.mock.calls[0];
        expect(msg).toBe("api.saved:x.zip");
        expect(opts.actionLabel).toBe("api.openFolder");
        opts.action();
        const [url, req] = win.fetch.mock.calls[1];
        expect(url).toBe("/api/desktop/reveal");
        expect(JSON.parse(req.body)).toEqual({ token: "s1" });
    });

    it("desktop export cancelled: no toast, resolves undefined", async () => {
        const win = boot("http://127.0.0.1:5555/#token=t");
        win.fetch = vi.fn(() => Promise.resolve({
            ok: true, status: 200,
            headers: { get: () => "application/json" },
            json: () => Promise.resolve({ saved: false }),
        }));
        win.NP.toast = vi.fn();
        expect(await win.NP.api.download("/api/backup")).toBeUndefined();
        expect(win.NP.toast).not.toHaveBeenCalled();
    });

    it("web mode export stays a browser download", async () => {
        const win = boot("http://127.0.0.1:8000/");
        win.fetch = vi.fn(() => Promise.resolve({
            ok: true, status: 200,
            headers: { get: (k) => (k === "content-disposition" ? 'attachment; filename="a.zip"' : "application/zip") },
            blob: () => Promise.resolve(new win.Blob(["x"])),
        }));
        win.URL.createObjectURL = vi.fn(() => "blob:x");
        win.URL.revokeObjectURL = vi.fn();
        win.NP.toast = vi.fn();
        await win.NP.api.download("/api/backup");
        expect(win.fetch.mock.calls[0][1].headers["X-NoirPad-Save-As"]).toBeUndefined();
        expect(win.URL.createObjectURL).toHaveBeenCalled();
        expect(win.NP.toast).not.toHaveBeenCalled();
    });
});

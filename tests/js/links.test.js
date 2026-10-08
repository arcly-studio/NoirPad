import { beforeEach, describe, expect, it, vi } from "vitest";
import { click, loadApp } from "./harness.js";

const IMG = "0f8e1c2a-1111-4222-8333-444455556666.png";

let win, preview, opened;

// Puts a raw <a> into the preview, bypassing the renderer, so the click
// guard is tested on its own (defence in depth).
function anchor(href) {
    preview.innerHTML = "";
    const a = win.document.createElement("a");
    a.setAttribute("href", href);
    a.textContent = "odkaz";
    preview.appendChild(a);
    return a;
}

beforeEach(() => {
    win = loadApp(["js/utils.js", "js/markdown.js", "js/images.js"]);
    preview = win.document.getElementById("md-preview");
    opened = vi.fn();
    win.open = opened;
    win.NP.images._setupClick();
});

describe("link clicks", () => {
    it("opens external links in a new tab with noopener", () => {
        const ev = click(win, anchor("https://example.com/"));
        expect(ev.defaultPrevented).toBe(true);
        expect(opened).toHaveBeenCalledWith("https://example.com/", "_blank", expect.stringContaining("noopener"));
    });

    it("opens /images/ links in the in-app viewer", () => {
        const ev = click(win, anchor(`/images/${IMG}`));
        expect(ev.defaultPrevented).toBe(true);
        expect(win.document.getElementById("image-viewer-overlay")).not.toBeNull();
        expect(opened).not.toHaveBeenCalled();
    });
});

describe("audit regressions", () => {
    // K4 – klik na javascript:/relativní/data:/file: odkaz nesmí nic spustit ani navigovat
    it.fails.each([
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "file:///C:/Windows/win.ini",
        "notes/relative.html",
        "//evil.example/x",
    ])("K4: click on %s is blocked", (href) => {
        const ev = click(win, anchor(href));
        expect(ev.defaultPrevented).toBe(true);
        expect(opened).not.toHaveBeenCalled();
    });

    // K4 – Ctrl/Shift-klik přenaviguje celé okno appky
    it.fails.each([
        ["Ctrl", { ctrlKey: true }],
        ["Shift", { shiftKey: true }],
        ["Meta", { metaKey: true }],
    ])("K4: %s+click on an external link is still intercepted", (_name, mods) => {
        const ev = click(win, anchor("https://example.com/"), mods);
        expect(ev.defaultPrevented).toBe(true);
        expect(opened).toHaveBeenCalledWith("https://example.com/", "_blank", expect.stringContaining("noopener"));
    });

    // K4 – prostřední tlačítko
    it.fails("K4: middle-click on an external link is intercepted", () => {
        const ev = click(win, anchor("https://example.com/"), { button: 1 });
        expect(ev.defaultPrevented).toBe(true);
        expect(opened).toHaveBeenCalledWith("https://example.com/", "_blank", expect.stringContaining("noopener"));
    });

    // K4 – odkaz mimo náhled (kdekoli v dokumentu) taky nesmí odnavigovat okno
    it.fails("K4: links outside the editor are guarded too", () => {
        const a = win.document.createElement("a");
        a.setAttribute("href", "https://example.com/");
        win.document.body.appendChild(a);
        const ev = click(win, a);
        expect(ev.defaultPrevented).toBe(true);
    });
});

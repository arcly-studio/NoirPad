import { beforeEach, describe, expect, it } from "vitest";
import { dangers, loadApp } from "./harness.js";

let win, preview;

function render(src) {
    win.NP.markdown.renderInto(preview, src);
    return preview;
}

beforeEach(() => {
    win = loadApp(["vendor/markdown-it/markdown-it.min.js", "vendor/dompurify/purify.min.js", "js/utils.js", "js/markdown.js"]);
    preview = win.document.getElementById("md-preview");
});

describe("markdown preview", () => {
    it("renders headings, emphasis and lists", () => {
        render("# Nadpis\n\n**tučně** a *kurzíva*\n\n- jedna\n- dvě");
        expect(preview.querySelector("h1, .md-h1").textContent).toContain("Nadpis");
        expect(preview.querySelector("strong, .md-bold").textContent).toContain("tučně");
        expect(preview.querySelector("em, .md-italic").textContent).toContain("kurzíva");
        expect(preview.textContent).toContain("jedna");
        expect(preview.textContent).toContain("dvě");
    });

    it("keeps the code-block contract used by syntax-highlight.js", () => {
        render("```python\nprint('<b>')\n```");
        const block = preview.querySelector(".md-codeblock");
        expect(block.getAttribute("data-lang")).toBe("python");
        expect(block.textContent).toContain("print('<b>')");
        expect(block.querySelector("b")).toBeNull();
    });

    it("renders safe links and images", () => {
        render("[web](https://example.com) ![obr](/images/0f8e1c2a-1111-4222-8333-444455556666.png)");
        expect(preview.querySelector("a").getAttribute("href")).toBe("https://example.com");
        expect(preview.querySelector("img").getAttribute("src"))
            .toBe("/images/0f8e1c2a-1111-4222-8333-444455556666.png");
    });

    it("shows remote images as text (the CSP would block them anyway)", () => {
        render("![logo](https://example.com/logo.png)");
        expect(preview.querySelector("img")).toBeNull();
        expect(preview.textContent).toContain("![logo](https://example.com/logo.png)");
    });

    it("escapes raw HTML", () => {
        render('<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n<svg onload=alert(1)>');
        expect(dangers(preview)).toEqual([]);
    });
});

describe("audit regressions", () => {
    // K3 – stored XSS v markdown náhledu: regexy běží nad hotovým HTML
    it("K3: nested image/link payload does not create event handlers", () => {
        render("![a]([z](onerror=onerror=alert;throw-1 x) y)");
        expect(dangers(preview)).toEqual([]);
        expect(preview.querySelectorAll("img").length).toBeLessThanOrEqual(1);
        for (const img of preview.querySelectorAll("img")) {
            expect(img.getAttribute("src")).not.toMatch(/[<>"]/);
        }
    });

    // K4 – javascript:/data:/file: odkazy se nesmí vykreslit jako odkaz
    it.each([
        "[x](javascript:alert(1))",
        "[x](JaVaScRiPt:alert(1))",
        "[x](data:text/html,<script>alert(1)</script>)",
        "[x](file:///C:/Windows/win.ini)",
        "[x](vbscript:msgbox)",
        "[x](notes/relative.html)",
        "![x](javascript:alert(1))",
    ])("K4: %s is not a live link", (src) => {
        render(src);
        expect(dangers(preview)).toEqual([]);
        for (const a of preview.querySelectorAll("a[href]")) {
            expect(a.getAttribute("href")).toMatch(/^(https?:|mailto:|\/images\/)/i);
        }
        for (const img of preview.querySelectorAll("img[src]")) {
            expect(img.getAttribute("src")).toMatch(/^(https?:|\/images\/|data:image\/)/i);
        }
    });
});

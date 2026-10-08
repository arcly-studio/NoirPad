import { beforeEach, describe, expect, it } from "vitest";
import { dangers, loadApp } from "./harness.js";

const IMG = "0f8e1c2a-1111-4222-8333-444455556666.png";

let win, editor;

function render(text, formats = []) {
    win.NP.editor.renderContent(editor, text, formats);
    return editor;
}

beforeEach(() => {
    win = loadApp(["js/utils.js", "js/editor.js"]);
    editor = win.document.getElementById("editor");
    win.NP.editor.el = editor;
});

describe("rich-text render", () => {
    it("renders plain text with line breaks", () => {
        render("řádek 1\nřádek <2>");
        expect(editor.querySelectorAll("br").length).toBe(1);
        expect(editor.textContent).toBe("řádek 1řádek <2>");
    });

    it("renders an image marker with persisted width", () => {
        render(`před <<IMG:${IMG}|w=300>> po`);
        const img = editor.querySelector("img");
        expect(img.getAttribute("src")).toBe(`/images/${IMG}`);
        expect(img.getAttribute("data-filename")).toBe(IMG);
        expect(img.style.width).toBe("300px");
    });

    it("applies italic / font / colour formats", () => {
        render("ahoj světe", [{ start: "1.0", end: "1.4", italic: true, font: "Inter", color: "#ff0000", size: 18 }]);
        const span = editor.querySelector("span");
        expect(span.style.fontFamily).toContain("Inter");
        expect(span.style.fontSize).toBe("18px");
        expect(editor.querySelector("em").textContent).toBe("ahoj");
    });

    it("renders code blocks as escaped, non-editable <pre>", () => {
        render("```js\nconst a = 1 < 2;\n```");
        const pre = editor.querySelector("pre.np-code");
        expect(pre.getAttribute("data-lang")).toBe("js");
        expect(pre.getAttribute("contenteditable")).toBe("false");
        expect(pre.textContent).toContain("const a = 1 < 2;");
    });

    // N2 (nový nález, není v auditu) – každé načtení + uložení přidá do bloku
    // kódu prázdný řádek před koncové ```.
    it("N2: code block round-trip is stable", () => {
        render("```js\nconst a = 1 < 2;\n```");
        expect(win.NP.editor._htmlToTextWithImages().text).toBe("```js\nconst a = 1 < 2;\n```");
    });

    // N1 (nový nález, není v auditu) – apostrof v bloku kódu ukončí atribut
    // data-code='…' (encodeURIComponent ho nekóduje), kód se při uložení ořízne.
    it("N1: round-trips code blocks containing quotes", () => {
        render("```js\nconst a = '<b>';\n```");
        const pre = editor.querySelector("pre.np-code");
        expect(pre.getAttribute("data-lang")).toBe("js");
        expect(pre.querySelector("b")).toBeNull();
        expect(win.NP.editor._htmlToTextWithImages().text).toBe("```js\nconst a = '<b>';\n```");
    });

});

describe("audit regressions", () => {
    // K2 / drobné – NP.escapeHtml neescapuje uvozovky
    it("K2: escapeHtml escapes quotes too", () => {
        expect(win.NP.escapeHtml(`<a href="x" title='y'>&`))
            .toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;");
    });

    // K2 – stored XSS přes marker <<IMG:…>> (uvozovka v názvu souboru)
    it("K2: quote in image marker cannot break out of the attribute", () => {
        render("<<IMG:x' onerror='alert(1)' a='>>");
        expect(dangers(editor)).toEqual([]);
        expect(editor.querySelector("img")).toBeNull();
        expect(editor.textContent).toContain("<<IMG:");  // shown as plain text
    });

    // K2 – jméno obrázku: jen UUID + povolená přípona
    it.each([
        "../notes_data.json",
        "evil.svg",
        "payload.html",
        "x.png?a=b",
    ])("K2: invalid image name %s is shown as text", (name) => {
        render(`<<IMG:${name}>>`);
        expect(editor.querySelector("img")).toBeNull();
        expect(editor.textContent).toContain(name);
    });

    // K2 – _applyFormats skládá style='…' z formats bez escapování
    it("K2: format values cannot inject attributes", () => {
        render("ahoj", [{
            start: "1.0", end: "1.4",
            font: "x' onmouseover='alert(1)",
            color: "red' onclick='alert(2)",
            size: "12px' onfocus='alert(3)",
        }]);
        expect(dangers(editor)).toEqual([]);
        expect(editor.textContent).toBe("ahoj");
    });

    it("K2: format values cannot smuggle CSS urls", () => {
        render("ahoj", [{ start: "1.0", end: "1.4", color: "red;background:url(javascript:alert(1))" }]);
        expect(dangers(editor)).toEqual([]);
    });
});

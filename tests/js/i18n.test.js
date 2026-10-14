// Step C: both locales have the same keys, every key the UI uses exists,
// and no user-visible text is hard-coded in the JS or in index.html.
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { loadApp, locale } from "./harness.js";

const STATIC = path.resolve(import.meta.dirname, "../../static");
const JS_DIR = path.join(STATIC, "js");
const PLURAL_FORMS = new Set(["zero", "one", "two", "few", "many", "other"]);

// Flatten {a: {b: "x"}} → {"a.b": "x"}; plural objects count as one key.
function flatten(obj, prefix = "", out = {}) {
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        const isPlural = v && typeof v === "object" && Object.keys(v).every((f) => PLURAL_FORMS.has(f));
        if (v && typeof v === "object" && !isPlural) flatten(v, key, out);
        else out[key] = v;
    }
    return out;
}

const en = flatten(locale("en"));
const cs = flatten(locale("cs"));
const jsFiles = fs.readdirSync(JS_DIR).filter((f) => f.endsWith(".js"));
const html = fs.readFileSync(path.join(STATIC, "index.html"), "utf8");

function usedKeys() {
    const keys = new Set();
    for (const f of jsFiles.filter((name) => name !== "i18n.js")) {   // its docs show examples
        const src = fs.readFileSync(path.join(JS_DIR, f), "utf8");
        for (const m of src.matchAll(/\bNP\.t\(\s*["']([\w.-]+)["']/g)) keys.add(m[1]);
        for (const m of src.matchAll(/data-i18n(?:-[\w-]+)?=\\?["']([\w.-]+)\\?["']/g)) keys.add(m[1]);
    }
    for (const m of html.matchAll(/data-i18n(?:-[\w-]+)?="([\w.-]+)"/g)) keys.add(m[1]);
    for (const k of keys) if (k.endsWith(".")) keys.delete(k);   // NP.t("errors." + code)
    return keys;
}

// ---- hard-coded text in JS ---------------------------------------------
//
// Heuristic scan, line by line. A line can opt out with `// i18n-ignore`
// (e.g. a brand name or a code sample).

const UI_SINKS = [
    /\b(?:alert|confirm|prompt)\(\s*(["'])(?=[^"']*[A-Za-z])/,
    /\.(?:textContent|innerText|title|placeholder|value)\s*\+?=\s*(["'])(?=\s*[A-Za-z]{2})/,
    /setAttribute\(\s*["'](?:title|placeholder|aria-label|data-placeholder)["']\s*,\s*(["'])(?=\s*[A-Za-z])/,
    /\b(?:title|label|message|warning|okLabel|text|description|placeholder|hint|name)\s*:\s*(["'])(?=[A-Z][a-z]+[\s'’]|[A-Z][a-z]{2,}["'])/,
];
const NOT_UI = /console\.|querySelector|getElementById|classList|addEventListener|createElement|matchMedia|setProperty|style\.|font-family|\.test\(|RegExp|new Error\(|throw |^\s*\*|^\s*\/\/|^\s*\/\*|i18n-ignore|NP\.t\(|className|\bclass:|"use strict"/;

// String literals on one line ("…", '…', `…`), honouring escapes; stops at //.
function literals(line) {
    const out = [];
    let quote = null;
    let buf = "";
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
            if (c === "\\") { buf += line[i + 1] || ""; i++; }
            else if (c === quote) { out.push(buf); quote = null; buf = ""; }
            else buf += c;
        } else if (c === "/" && line[i + 1] === "/") {
            break;
        } else if (c === '"' || c === "'" || c === "`") {
            quote = c;
        }
    }
    return out;
}

// Looks like words for people: two words separated by a space, or one
// capitalised word ending a sentence.
function isProse(s) {
    if (/^[#.\[\/]|[{}<>=;]|^\w+:\/\/|^data:|\dpx\b|monospace|sans-serif/.test(s)) return false;
    return /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(s) || /^[A-Z][a-z]+[.!?…]$/.test(s);
}

function hardcoded(file) {
    const found = [];
    const lines = fs.readFileSync(path.join(JS_DIR, file), "utf8").split("\n");
    let inComment = false;
    lines.forEach((line, i) => {
        if (inComment) { if (line.includes("*/")) inComment = false; return; }
        if (/^\s*\/\*/.test(line) && !line.includes("*/")) { inComment = true; return; }
        if (line.includes("i18n-ignore")) return;
        const where = `${file}:${i + 1}: ${line.trim().slice(0, 120)}`;
        if (UI_SINKS.some((re) => re.test(line))) { found.push(where); return; }
        if (NOT_UI.test(line)) return;
        // Text between tags in HTML strings: ">Some text<" or "> Text"
        if (/["'][^"']*>\s*[A-Za-z][a-z]+(?:\s+[a-z]+)+/.test(line)) { found.push(where); return; }
        if (literals(line).some(isProse)) found.push(where);
    });
    return found;
}

describe("locales", () => {
    it("en and cs have exactly the same keys", () => {
        const onlyEn = Object.keys(en).filter((k) => !(k in cs));
        const onlyCs = Object.keys(cs).filter((k) => !(k in en));
        expect({ onlyEn, onlyCs }).toEqual({ onlyEn: [], onlyCs: [] });
    });

    it("plural keys define the needed forms", () => {
        for (const [k, v] of Object.entries(cs)) {
            if (typeof v === "object") expect(Object.keys(v).sort(), k).toEqual(["few", "many", "one", "other"]);
        }
        for (const [k, v] of Object.entries(en)) {
            if (typeof v === "object") expect(Object.keys(v).sort(), k).toEqual(["one", "other"]);
        }
    });

    it("placeholders match between languages", () => {
        const names = (v) => [...new Set([...JSON.stringify(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(",");
        const diff = Object.keys(en).filter((k) => k in cs && names(en[k]) !== names(cs[k]));
        expect(diff).toEqual([]);
    });

    it("every key used by the UI exists", () => {
        const missing = [...usedKeys()].filter((k) => !(k in en)).sort();
        expect(missing).toEqual([]);
        console.log(`i18n: ${Object.keys(en).length} keys, ${usedKeys().size} referenced, missing: ${missing.length}`);
    });
});

describe("no hard-coded UI text", () => {
    it("in static/js", () => {
        const found = jsFiles.filter((f) => f !== "i18n.js").flatMap(hardcoded);
        expect(found).toEqual([]);
    });

    it("in index.html (text → data-i18n, title/placeholder/aria-label → data-i18n-*)", () => {
        const doc = new JSDOM(html).window.document;
        const exempt = (el) => el.closest("[translate=no], script, style");
        const problems = [];
        for (const el of doc.body.querySelectorAll("*")) {
            if (exempt(el)) continue;
            const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("");
            if (/[A-Za-z]{2}/.test(own) && !el.hasAttribute("data-i18n")) {
                problems.push(`<${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}> ${own.trim().slice(0, 50)}`);
            }
            for (const attr of ["title", "placeholder", "aria-label", "data-placeholder"]) {
                const v = el.getAttribute(attr);
                if (v && /[A-Za-z]{2}/.test(v) && !el.hasAttribute(`data-i18n-${attr}`)) {
                    problems.push(`<${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} ${attr}="${v.slice(0, 40)}">`);
                }
            }
        }
        expect(problems).toEqual([]);
    });
});

describe("language choice", () => {
    it("a picked language wins; \"auto\" uses the installer's, then the browser's", () => {
        const win = loadApp([]);
        const nav = win.navigator.language.startsWith("cs") ? "cs" : "en";
        expect(win.NP.i18n.resolve("auto")).toBe(nav);
        win.NP.i18n.setDefault("cs");
        expect(win.NP.i18n.resolve("auto")).toBe("cs");
        expect(win.NP.i18n.resolve("en")).toBe("en");
        win.NP.i18n.setDefault("en");
        expect(win.NP.i18n.resolve("auto")).toBe("en");
        expect(win.NP.i18n.resolve("cs")).toBe("cs");
        win.NP.i18n.setDefault(null);
        expect(win.NP.i18n.resolve("auto")).toBe(nav);
    });
});

describe("NP.t", () => {
    it("fills params, picks Czech plural forms, falls back to English", () => {
        const win = loadApp([]);
        win.NP.i18n.use("cs", locale("cs"));
        expect(win.NP.t("common.notes", { n: 1 })).toBe("1 poznámka");
        expect(win.NP.t("common.notes", { n: 3 })).toBe("3 poznámky");
        expect(win.NP.t("common.notes", { n: 7 })).toBe("7 poznámek");
        expect(win.NP.t("errors.password_too_short", { min: 4 })).toBe("Heslo je příliš krátké (minimální délka: 4).");
        expect(win.NP.t("passwordDialog.errorTooShort", { n: 4 })).toBe("Použijte alespoň 4 znaky.");
        expect(win.NP.t("encryption.lockMessage", { n: 4 })).toBe("Zvolte heslo dlouhé alespoň 4 znaky.");
        expect(win.NP.t("no.such.key")).toBe("no.such.key");
    });

    it("translates data-i18n attributes", () => {
        const win = loadApp([], { body: '<p data-i18n="common.cancel">Cancel</p><input data-i18n-placeholder="common.password">' });
        win.NP.i18n.use("cs", locale("cs"));
        win.NP.i18n.apply(win.document);
        expect(win.document.querySelector("p").textContent).toBe("Zrušit");
        expect(win.document.querySelector("input").placeholder).toBe("Heslo");
    });
});

// Loads NoirPad's plain <script> files into a fresh jsdom window, the same
// way the browser does (no bundler, no modules).
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const STATIC = path.resolve(import.meta.dirname, "../../static");

function deepMerge(into, from) {
    for (const [k, v] of Object.entries(from)) {
        if (v && typeof v === "object" && into[k] && typeof into[k] === "object") deepMerge(into[k], v);
        else into[k] = v;
    }
    return into;
}

// static/locales/<lang>.json plus any not-yet-merged
// static/locales/parts/*.<lang>.json (work in progress).
export function locale(lang) {
    const dir = path.join(STATIC, "locales");
    const dict = JSON.parse(fs.readFileSync(path.join(dir, `${lang}.json`), "utf8"));
    const parts = path.join(dir, "parts");
    if (fs.existsSync(parts)) {
        for (const f of fs.readdirSync(parts).filter((n) => n.endsWith(`.${lang}.json`)).sort()) {
            deepMerge(dict, JSON.parse(fs.readFileSync(path.join(parts, f), "utf8")));
        }
    }
    return dict;
}

const BODY = `
  <div id="editor" contenteditable="true"></div>
  <div id="md-stack"><textarea id="editor-md"></textarea><div id="md-preview"></div></div>
  <input id="note-title-input">`;

export function loadApp(scripts, { body = BODY } = {}) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${body}</body></html>`, {
        url: "http://127.0.0.1:8000/",
        runScripts: "outside-only",
        pretendToBeVisual: true,
    });
    const win = dom.window;
    // Every page has i18n.js first; tests read English texts.
    win.eval(fs.readFileSync(path.join(STATIC, "js/i18n.js"), "utf8"));
    win.NP.i18n.use("en", locale("en"));
    for (const rel of scripts) {
        if (rel === "js/i18n.js") continue;
        win.eval(fs.readFileSync(path.join(STATIC, rel), "utf8"));
    }
    return win;
}

const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href", "data"];

// Everything in *root* that could run script or navigate somewhere unsafe.
export function dangers(root) {
    const found = [];
    for (const el of root.querySelectorAll("*")) {
        const tag = el.tagName.toLowerCase();
        if (["script", "iframe", "object", "embed", "frame", "base", "meta", "form"].includes(tag)) {
            found.push(`<${tag}>`);
        }
        for (const attr of el.attributes) {
            const name = attr.name.toLowerCase();
            if (name.startsWith("on")) found.push(`${tag}[${name}]`);
            if (URL_ATTRS.includes(name) && /^\s*(javascript|vbscript|data:text)/i.test(attr.value)) {
                found.push(`${tag}[${name}=${attr.value}]`);
            }
            if (name === "style" && /url\s*\(|expression\s*\(/i.test(attr.value)) {
                found.push(`${tag}[style=${attr.value}]`);
            }
        }
    }
    return found;
}

export function click(win, el, init = {}) {
    const type = init.button === 1 ? "auxclick" : "click";
    const ev = new win.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(ev);
    return ev;
}

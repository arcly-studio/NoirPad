// Loads NoirPad's plain <script> files into a fresh jsdom window, the same
// way the browser does (no bundler, no modules).
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const STATIC = path.resolve(import.meta.dirname, "../../static");

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
    for (const rel of scripts) {
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

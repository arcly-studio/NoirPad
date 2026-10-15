import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadApp } from "./harness.js";

// The real top bar from index.html, so the test follows the markup.
const INDEX = fs.readFileSync(path.resolve(import.meta.dirname, "../../static/index.html"), "utf8");
const TOP_BAR = INDEX.match(/<div id="top-bar">[\s\S]*?<\/div>\s*<\/div>/)[0];

let win, calls;

beforeEach(() => {
    win = loadApp(["js/utils.js", "js/shortcuts.js", "js/topbar.js"], { body: TOP_BAR });
    win.NP.i18n.apply(win.document);
    calls = [];
    win.NP.state = { currentNoteId: "n1", data: { favorites: ["n1"], md_split: true } };
    win.NP.editor = { _loadedNoteId: "n1", _currentNoteId: "n1" };
    win.NP.export = { txt: () => calls.push("txt"), html: () => calls.push("html"), md: () => calls.push("md") };
    win.NP.print = { exportCurrentNote: () => calls.push("pdf") };
    win.NP.settings = { open: () => calls.push("settings") };
    win.NP.help = { show: () => calls.push("help") };
    win.NP.backup = { download: () => calls.push("backup") };
    win.NP.favorites = { isFavorite: (id) => win.NP.state.data.favorites.includes(id) };
    win.NP.topbar.init();
});

const $ = (sel) => win.document.querySelector(sel);
const menuItems = () => [...win.document.querySelectorAll(".np-menu .np-menu-item")];

describe("G1: top bar", () => {
    it("export menu offers TXT, HTML, PDF and Markdown and runs the chosen one", () => {
        $("#btn-export").click();
        expect($(".np-menu").getAttribute("role")).toBe("menu");
        expect($("#btn-export").getAttribute("aria-expanded")).toBe("true");
        expect(menuItems().map((b) => b.getAttribute("data-id"))).toEqual(["txt", "html", "pdf", "md"]);
        expect(menuItems().map((b) => b.textContent)).toEqual(
            ["Text (.txt)", "Web page (.html)", "PDF (print dialog)", "Markdown (.md)"]);
        menuItems()[3].click();
        expect(calls).toEqual(["md"]);
        expect($(".np-menu")).toBeNull();
        expect($("#btn-export").getAttribute("aria-expanded")).toBe("false");
    });

    it("export menu: keyboard moves, Enter runs, Escape closes and returns focus", () => {
        $("#btn-export").click();
        expect(win.document.activeElement).toBe(menuItems()[0]);
        const key = (k) => win.document.activeElement.dispatchEvent(
            new win.KeyboardEvent("keydown", { key: k, bubbles: true }));
        key("ArrowDown");
        key("ArrowDown");
        expect(win.document.activeElement.getAttribute("data-id")).toBe("pdf");
        key("ArrowUp");
        key("ArrowUp");
        key("ArrowUp");                                  // wraps to the end
        expect(win.document.activeElement.getAttribute("data-id")).toBe("md");
        key("Escape");
        expect($(".np-menu")).toBeNull();
        expect(win.document.activeElement).toBe($("#btn-export"));
    });

    it("export items are disabled when no note is open", () => {
        win.NP.state.currentNoteId = null;
        $("#btn-export").click();
        expect(menuItems().every((b) => b.disabled)).toBe(true);
    });

    it("⋯ holds help, settings, backup …", () => {
        $("#btn-more").click();
        const ids = menuItems().map((b) => b.getAttribute("data-id"));
        expect(ids).toEqual(expect.arrayContaining(["help", "settings", "backup", "font", "fullscreen", "focus"]));
        menuItems().find((b) => b.getAttribute("data-id") === "settings").click();
        expect(calls).toEqual(["settings"]);
    });

    it("tooltips name the action and its current shortcut; aria-label stays plain", () => {
        const md = $("#btn-md-toggle");
        md.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
        expect(md.title).toBe("Markdown (Ctrl+M)");
        expect(md.getAttribute("aria-label")).toBe("Markdown");
        win.NP.shortcuts.setCurrent = function () {};   // no backend here
        win.NP.shortcuts.getAll()["toggle-markdown"].current = "Ctrl+Alt+M";
        md.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
        expect(md.title).toBe("Markdown (Ctrl+Alt+M)");
    });

    it("favorite and lock show the note's state", () => {
        win.NP.topbar.refresh();
        expect($("#btn-favorite").getAttribute("aria-pressed")).toBe("true");
        expect($("#btn-lock").getAttribute("aria-pressed")).toBe("false");
        Object.assign(win.NP.editor, { _currentNoteEncrypted: true, _unlockToken: "t" });
        win.NP.topbar.refresh();
        expect($("#btn-lock").getAttribute("aria-pressed")).toBe("true");
        expect($("#btn-lock use").getAttribute("href")).toMatch(/#i-lock-open$/);
        expect($("#btn-lock").getAttribute("aria-label")).toBe("Remove the lock");
    });

    it("preview-next-to-source works only in Markdown and is remembered", () => {
        const saved = [];
        win.NP.api = { saveSettings: (s) => saved.push(s) };
        win.NP.topbar.refresh();
        expect($("#btn-split").disabled).toBe(true);
        win.NP.markdown = { isActive: () => true };
        win.NP.topbar.refresh();
        $("#btn-split").click();
        expect(win.document.body.classList.contains("md-no-preview")).toBe(true);
        expect(saved).toEqual([{ md_split: false }]);
        expect($("#btn-split").getAttribute("aria-pressed")).toBe("false");
    });
});

describe("review fixes (G1–G4)", () => {
    it("Escape closes a menu even when no item can take focus", async () => {
        win.NP.state.currentNoteId = null;                 // every export item disabled
        $("#btn-export").click();
        expect($(".np-menu")).not.toBeNull();
        await new Promise((r) => setTimeout(r, 0));
        win.document.body.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect($(".np-menu")).toBeNull();
    });
});

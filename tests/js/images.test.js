// N4: only pictures in a note react to the image viewer / Ctrl+wheel zoom —
// never the logo on the welcome screen (rendered into #editor as well).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

const NOTE_IMG = "0f8e1c2a-1111-4222-8333-444455556666.png";
let win;

function body() {
    return `
      <div id="editor">
        <div class="welcome-wrap">
          <img class="welcome-icon np-decorative" src="/static/img/noirpad-icon.svg" alt="" aria-hidden="true" draggable="false">
          <h1 class="welcome-logo">NoirPad</h1>
        </div>
        <p>text <img id="note-img" src="/images/${NOTE_IMG}" data-filename="${NOTE_IMG}"></p>
      </div>
      <div id="md-preview">
        <img id="md-img" class="md-image" src="/images/${NOTE_IMG}">
        <img id="ui-img" class="np-decorative" src="/static/img/noirpad-icon.svg">
      </div>
      <textarea id="editor-md"></textarea>`;
}

beforeEach(() => {
    win = loadApp(["js/utils.js", "js/images.js"], { body: body() });
    win.NP.editor = { save: vi.fn() };
    win.NP.images._setupClick();
    win.NP.images._setupZoom();
});

const viewer = () => win.document.getElementById("image-viewer-overlay");
const click = (id, sel) => (sel ? win.document.querySelector(sel) : win.document.getElementById(id))
    .dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));

describe("image viewer", () => {
    it("clicking the logo on the welcome screen does nothing", () => {
        click(null, ".welcome-icon");
        expect(viewer()).toBeNull();
        click(null, ".welcome-logo");
        expect(viewer()).toBeNull();
    });

    it("clicking a picture in the note opens the viewer", () => {
        click("note-img");
        expect(viewer()).not.toBeNull();
        expect(viewer().querySelector(".image-viewer-img").getAttribute("src")).toMatch(new RegExp(`/images/${NOTE_IMG}$`));
    });

    it("Markdown preview: note pictures yes, UI pictures no", () => {
        click("ui-img");
        expect(viewer()).toBeNull();
        click("md-img");
        expect(viewer()).not.toBeNull();
    });

    it("Ctrl+wheel resizes note pictures only", () => {
        const wheel = (el) => el.dispatchEvent(new win.WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -1 }));
        const logo = win.document.querySelector(".welcome-icon");
        const note = win.document.getElementById("note-img");
        wheel(logo);
        expect(logo.style.width).toBe("");
        wheel(note);
        expect(note.style.width).toMatch(/px$/);
    });

    it("isNoteImage", () => {
        const ed = win.document.getElementById("editor");
        expect(win.NP.images.isNoteImage(win.document.getElementById("note-img"), ed)).toBe(true);
        expect(win.NP.images.isNoteImage(win.document.querySelector(".welcome-icon"), ed)).toBe(false);
    });
});

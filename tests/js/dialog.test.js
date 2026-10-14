// N3: NoirPad's own dialogs replace the browser's prompt/confirm/alert.
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadApp } from "./harness.js";

const STATIC = path.resolve(import.meta.dirname, "../../static");

let win;
const dialog = () => win.document.querySelector(".np-dialog");
const input = () => win.document.querySelector("#np-dialog-input");
const key = (k, target = win.document.activeElement || win.document.body) =>
    target.dispatchEvent(new win.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const button = (cls) => dialog().querySelector(`.dialog-btn.${cls}`);
const cancelButton = () => dialog().querySelector("button[type=button]");

beforeEach(() => {
    win = loadApp(["js/dialog.js"]);
});

describe("NP.dialog.prompt", () => {
    it("focuses the field, Enter = OK, returns the trimmed text", async () => {
        const p = win.NP.dialog.prompt("Folder name:", { title: "New folder" });
        expect(dialog().getAttribute("role")).toBe("dialog");
        expect(dialog().textContent).toContain("New folder");
        expect(win.document.activeElement).toBe(input());
        input().value = "  Projekty  ";
        key("Enter");
        expect(await p).toBe("Projekty");
        expect(dialog()).toBeNull();
    });

    it("Escape cancels with null", async () => {
        const p = win.NP.dialog.prompt("Note name:");
        input().value = "x";
        key("Escape");
        expect(await p).toBeNull();
        expect(dialog()).toBeNull();
    });

    it("rejects empty names and forbidden characters inline", async () => {
        const p = win.NP.dialog.prompt("Note name:");
        key("Enter");
        expect(dialog()).not.toBeNull();
        expect(dialog().querySelector(".np-dialog-error").textContent).toBe("Enter a name.");
        input().value = "a/b";
        key("Enter");
        expect(dialog().querySelector(".np-dialog-error").textContent).toContain("cannot contain");
        expect(input().getAttribute("aria-invalid")).toBe("true");
        input().value = "Nákup: mléko";
        key("Enter");
        expect(dialog()).not.toBeNull();
        input().value = "Nákup – mléko";
        button("primary").click();
        expect(await p).toBe("Nákup – mléko");
    });

    it("pre-fills the current value (rename) and selects it", async () => {
        const p = win.NP.dialog.prompt("New name:", { value: "Starý název" });
        expect(input().value).toBe("Starý název");
        expect(input().selectionStart).toBe(0);
        expect(input().selectionEnd).toBe("Starý název".length);
        cancelButton().click();
        expect(await p).toBeNull();
    });

    it("validateName", () => {
        const v = win.NP.dialog.validateName;
        expect(v("Poznámka 1")).toBeNull();
        expect(v("   ")).not.toBeNull();
        for (const c of ['\\', "/", ":", "*", "?", '"', "<", ">", "|", "\u0007"]) expect(v(`a${c}b`), c).not.toBeNull();
        expect(v("x".repeat(301))).not.toBeNull();
    });
});

describe("NP.dialog.confirm / alert", () => {
    it("confirm: Enter = OK → true, Escape → false", async () => {
        let p = win.NP.dialog.confirm("Move 'x' to trash?");
        expect(win.document.activeElement).toBe(button("primary"));
        key("Enter");
        expect(await p).toBe(true);
        p = win.NP.dialog.confirm("Move 'x' to trash?");
        key("Escape");
        expect(await p).toBe(false);
    });

    it("danger variant: red OK button and a red frame; Enter on Cancel cancels", async () => {
        const p = win.NP.dialog.confirm("Delete for good?", { danger: true, okLabel: "Delete permanently" });
        expect(dialog().classList.contains("np-dialog--danger")).toBe(true);
        expect(button("danger").textContent).toBe("Delete permanently");
        cancelButton().focus();
        key("Enter");
        expect(await p).toBe(false);
    });

    it("alert has one button and resolves when closed", async () => {
        const p = win.NP.dialog.alert("Saved.");
        expect(dialog().getAttribute("role")).toBe("alertdialog");
        expect(dialog().querySelectorAll("button")).toHaveLength(1);
        key("Escape");
        await expect(p).resolves.toBeUndefined();
    });

    it("keys do not reach the app's shortcuts while a dialog is open", async () => {
        let reached = 0;
        win.document.addEventListener("keydown", () => { reached += 1; }, true);
        const p = win.NP.dialog.confirm("?");
        key("n");
        key("Enter");
        await p;
        expect(reached).toBe(0);
        key("n");
        expect(reached).toBe(1);
    });

    it("message text is never parsed as HTML", async () => {
        const p = win.NP.dialog.alert("<img src=x onerror=alert(1)>");
        expect(dialog().querySelector("img")).toBeNull();
        key("Enter");
        await p;
    });

    it("translated buttons", async () => {
        win.NP.i18n.use("cs", JSON.parse(fs.readFileSync(path.join(STATIC, "locales/cs.json"), "utf8")));
        const p = win.NP.dialog.confirm("?");
        expect(cancelButton().textContent).toBe("Zrušit");
        key("Escape");
        await p;
    });
});

describe("no browser dialogs left in the app", () => {
    it("static/js and index.html never call prompt(, confirm( or alert(", () => {
        const found = [];
        const files = fs.readdirSync(path.join(STATIC, "js")).filter((f) => f.endsWith(".js"))
            .map((f) => path.join(STATIC, "js", f)).concat(path.join(STATIC, "index.html"));
        for (const file of files) {
            const code = fs.readFileSync(file, "utf8")
                .replace(/\/\*[\s\S]*?\*\//g, "")        // block comments
                .replace(/^\s*\/\/.*$/gm, "");           // line comments
            const re = /(?<![\w.$])(?:alert|confirm|prompt)\s*\(|\b(?:window|self|globalThis)\s*\.\s*(?:alert|confirm|prompt)\b/g;
            for (const m of code.matchAll(re)) found.push(`${path.basename(file)}: ${m[0]}`);
        }
        expect(found).toEqual([]);
    });
});

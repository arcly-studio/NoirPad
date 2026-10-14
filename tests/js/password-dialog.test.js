// D2 – heslo v modálním okně (type=password), ne v prompt()
import { beforeEach, describe, expect, it } from "vitest";
import { loadApp } from "./harness.js";

let win;

function dialog() {
    return win.document.querySelector(".np-password-dialog");
}

function submit(first, second) {
    const d = dialog();
    d.querySelector("#np-pw-1").value = first;
    if (second !== undefined) d.querySelector("#np-pw-2").value = second;
    d.querySelector("form").dispatchEvent(new win.Event("submit", { cancelable: true }));
}

beforeEach(() => {
    win = loadApp(["js/utils.js", "js/password-dialog.js"]);
});

describe("password dialog", () => {
    it("uses password inputs and resolves with the value", async () => {
        const p = win.NP.passwordDialog.ask({ title: "Unlock" });
        expect(dialog().querySelector("#np-pw-1").type).toBe("password");
        submit("tajne-heslo");
        expect(await p).toBe("tajne-heslo");
        expect(dialog()).toBeNull();
    });

    it("rejects empty and too short passwords inline", async () => {
        const p = win.NP.passwordDialog.ask({ minLength: 8 });
        submit("");
        expect(dialog()).not.toBeNull();
        submit("short");
        expect(dialog().querySelector(".np-password-error").textContent).toContain("8");
        submit("long-enough");
        expect(await p).toBe("long-enough");
    });

    it("a weak-password hint shows while short but never blocks (N5)", async () => {
        const p = win.NP.passwordDialog.ask({ minLength: 4, weakBelow: 8, weakHint: "Short = weak" });
        const input = dialog().querySelector("#np-pw-1");
        const hint = dialog().querySelector(".np-password-hint");
        const type = (v) => { input.value = v; input.dispatchEvent(new win.Event("input")); };
        expect(hint.hidden).toBe(true);
        type("abc");
        expect(hint.hidden).toBe(true);         // too short: the error says so on submit
        type("abcd");
        expect(hint.hidden).toBe(false);
        expect(hint.textContent).toBe("Short = weak");
        type("abcdefgh");
        expect(hint.hidden).toBe(true);
        submit("abcd");
        expect(await p).toBe("abcd");
    });

    it("asks twice when setting a password and needs a match", async () => {
        const p = win.NP.passwordDialog.ask({ confirm: true, minLength: 8 });
        expect(dialog().querySelector("#np-pw-2").type).toBe("password");
        submit("aaaaaaaa", "bbbbbbbb");
        expect(dialog().querySelector(".np-password-error").textContent).toContain("match");
        submit("aaaaaaaa", "aaaaaaaa");
        expect(await p).toBe("aaaaaaaa");
    });

    it("shows the warning and resolves null on cancel", async () => {
        const p = win.NP.passwordDialog.ask({ warning: "Forgotten password = gone" });
        expect(dialog().textContent).toContain("Forgotten password = gone");
        dialog().querySelector("button[type=button]").click();
        expect(await p).toBeNull();
    });

    it("Escape cancels", async () => {
        const p = win.NP.passwordDialog.ask({});
        win.document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(await p).toBeNull();
    });
});

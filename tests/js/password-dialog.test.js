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

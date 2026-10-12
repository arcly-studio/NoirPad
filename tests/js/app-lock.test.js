// App lock: the start gate asks for the password before the app boots.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

let win;
let session;
let booted;

function fakeApi(overrides = {}) {
    return {
        hasToken: () => false,
        session: vi.fn(() => Promise.resolve(session)),
        appLockUnlock: vi.fn(() => {
            session = { ...session, app_lock: { enabled: true, unlocked: true } };
            return Promise.resolve({ ok: true });
        }),
        login: vi.fn(() => Promise.resolve({ ok: true })),
        dismissNotice: () => Promise.resolve(),
        ...overrides,
    };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    win = loadApp(["js/utils.js", "js/auth.js", "js/app-lock.js"]);
    booted = 0;
    win.NP.app = { init: () => { booted += 1; return Promise.resolve(); } };
});

describe("app lock gate", () => {
    it("boots straight away when the lock is off", async () => {
        session = { password_required: false, app_lock: { enabled: false, unlocked: true } };
        win.NP.api = fakeApi();
        await win.NP.auth.start();
        expect(booted).toBe(1);
        expect(win.document.querySelector(".auth-visible")).toBeNull();
    });

    it("shows the lock screen first and boots after the right password", async () => {
        session = { password_required: false, app_lock: { enabled: true, unlocked: false } };
        win.NP.api = fakeApi();
        await win.NP.auth.start();
        expect(booted).toBe(0);
        const overlay = win.document.querySelector(".auth-visible");
        expect(overlay.querySelector("#auth-subtitle").textContent).toMatch(/locked/i);
        expect(overlay.querySelector("#auth-remember-row").style.display).toBe("none");
        expect(win.NP.appLock.enabled).toBe(true);

        overlay.querySelector("#auth-password").value = "zamek-heslo";
        overlay.querySelector("form").dispatchEvent(new win.Event("submit", { cancelable: true }));
        await tick(); await tick(); await tick();

        expect(win.NP.api.appLockUnlock).toHaveBeenCalledWith("zamek-heslo");
        expect(win.NP.api.login).not.toHaveBeenCalled();
        expect(booted).toBe(1);
        expect(overlay.querySelector("#auth-password").value).toBe("");
    });

    it("keeps the app closed on a wrong password", async () => {
        session = { password_required: false, app_lock: { enabled: true, unlocked: false } };
        win.NP.api = fakeApi({
            appLockUnlock: vi.fn(() => Promise.reject(new Error("Wrong password"))),
        });
        await win.NP.auth.start();
        const overlay = win.document.querySelector(".auth-visible");
        overlay.querySelector("#auth-password").value = "spatne";
        overlay.querySelector("form").dispatchEvent(new win.Event("submit", { cancelable: true }));
        await tick(); await tick();
        expect(booted).toBe(0);
        expect(overlay.querySelector("#auth-error").textContent).toMatch(/wrong/i);
    });
});

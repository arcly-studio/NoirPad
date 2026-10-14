// D10: searching ignores letter case and diacritics ("cestina" finds "Čeština").
import { beforeEach, describe, expect, it } from "vitest";
import { loadApp } from "./harness.js";

let win;

beforeEach(() => {
    win = loadApp(["js/utils.js", "js/search.js", "js/find-all.js"]);
    win.NP.state = {
        data: {
            tree: [{ id: "n1", name: "Jazyk", type: "note" }, { id: "n2", name: "Jiná", type: "note" }],
            notes: { n1: "Čeština je krásná. ČEŠTINA, čeština!", n2: "nic tu není" },
        },
    };
});

describe("NP.searchFold", () => {
    it("folds case and diacritics without changing the length", () => {
        const fold = win.NP.searchFold;
        expect(fold("Čeština ŽLUŤOUČKÝ kůň")).toBe("cestina zlutoucky kun");
        for (const s of ["Čeština", "İstanbul", "Straße", "emoji 😀 ok", "ǅ"]) {
            expect(fold(s).length, s).toBe(s.length);
        }
    });
});

describe("search across notes (:findall)", () => {
    it("finds every spelling, with or without háčky and čárky", () => {
        for (const q of ["cestina", "ČEŠTINA", "Čeština", "krasna"]) {
            const hits = win.NP.findAll.search(q);
            expect(hits.length, q).toBe(q === "krasna" ? 1 : 3);
            expect(hits.every((h) => h.noteId === "n1")).toBe(true);
        }
        const [first] = win.NP.findAll.search("cestina");
        expect(first.snippet).toContain("<mark>Čeština</mark>");   // the original text is highlighted
    });
});

describe("find in the note (Ctrl+F)", () => {
    it("highlights matches regardless of diacritics", () => {
        win.document.getElementById("editor").textContent = "Čeština je krásná. ČEŠTINA, čeština!";
        win.NP.search._highlight("cestina");
        expect(win.NP.search.matches.map((m) => m.textContent)).toEqual(["Čeština", "ČEŠTINA", "čeština"]);
    });
});

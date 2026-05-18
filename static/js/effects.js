/* effects.js - Visual effects: CRT overlay, glitch typing */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var CRT_KEY = "noirpad_crt";
    var GLITCH_WINDOW_MS = 1000;
    var GLITCH_THRESHOLD = 5;       /* keys/sec required to trigger */
    var GLITCH_COOLDOWN_MS = 200;
    var GLITCH_DURATION_MS = 80;

    var inputTimes = [];
    var lastGlitchAt = 0;

    NP.effects = {

        /* ---- CRT scanlines ---- */

        crtApply: function (on) {
            document.body.classList.toggle("crt-on", !!on);
            try { localStorage.setItem(CRT_KEY, on ? "1" : "0"); } catch (e) { /* ignore */ }
        },

        crtToggle: function () {
            var on = !document.body.classList.contains("crt-on");
            NP.effects.crtApply(on);
        },

        crtIsOn: function () {
            return document.body.classList.contains("crt-on");
        },

        crtRestore: function () {
            try {
                if (localStorage.getItem(CRT_KEY) === "1") {
                    document.body.classList.add("crt-on");
                }
            } catch (e) { /* ignore */ }
        },

        /* ---- Glitch typing ---- */

        onEditorInput: function () {
            var now = performance.now();
            inputTimes.push(now);
            /* Drop entries older than the rolling window */
            var cutoff = now - GLITCH_WINDOW_MS;
            while (inputTimes.length && inputTimes[0] < cutoff) {
                inputTimes.shift();
            }
            if (inputTimes.length < GLITCH_THRESHOLD) return;
            if (now - lastGlitchAt < GLITCH_COOLDOWN_MS) return;
            lastGlitchAt = now;

            var editor = document.getElementById("editor");
            if (!editor) return;
            editor.classList.remove("glitching");
            void editor.offsetWidth;          /* restart animation */
            editor.classList.add("glitching");
            setTimeout(function () {
                editor.classList.remove("glitching");
            }, GLITCH_DURATION_MS + 20);
        }
    };

})(window.NP);

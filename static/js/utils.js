/* utils.js - NoirPad utility functions */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* ---- UUID v4 ---- */
    NP.uuid = function () {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            var r = (Math.random() * 16) | 0;
            var v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    };

    /* ---- Debounce ---- */
    NP.debounce = function (fn, ms) {
        var timer = null;
        return function () {
            var ctx = this;
            var args = arguments;
            clearTimeout(timer);
            timer = setTimeout(function () {
                fn.apply(ctx, args);
            }, ms);
        };
    };

    /* ---- DOM shortcuts ---- */
    NP.$ = function (sel) {
        return document.querySelector(sel);
    };

    NP.$$ = function (sel) {
        return document.querySelectorAll(sel);
    };

    /* ---- Escape HTML ---- */
    NP.escapeHtml = function (str) {
        var div = document.createElement("div");
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    };

    /* ---- Color helpers ---- */

    function hexToRgb(hex) {
        hex = hex.replace(/^#/, "");
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        var n = parseInt(hex, 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }

    function rgbToHex(r, g, b) {
        return (
            "#" +
            ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b))
                .toString(16)
                .slice(1)
        );
    }

    function clamp(v, lo, hi) {
        return v < lo ? lo : v > hi ? hi : v;
    }

    NP.darkenColor = function (hex, factor) {
        var c = hexToRgb(hex);
        return rgbToHex(
            clamp(c.r * factor, 0, 255),
            clamp(c.g * factor, 0, 255),
            clamp(c.b * factor, 0, 255)
        );
    };

    NP.brightenColor = function (hex, factor) {
        var c = hexToRgb(hex);
        return rgbToHex(
            clamp(c.r + (255 - c.r) * factor, 0, 255),
            clamp(c.g + (255 - c.g) * factor, 0, 255),
            clamp(c.b + (255 - c.b) * factor, 0, 255)
        );
    };

    NP.interpolateColor = function (hex1, hex2, t) {
        var a = hexToRgb(hex1);
        var b = hexToRgb(hex2);
        return rgbToHex(
            a.r + (b.r - a.r) * t,
            a.g + (b.g - a.g) * t,
            a.b + (b.b - a.b) * t
        );
    };

    NP.computeColors = function (baseHex) {
        var base = baseHex || "#00ff41";
        return {
            BG: "#0a0a0a",
            BG_LIGHT: "#111111",
            BG_ENTRY: "#0d0d0d",
            FG: base,
            FG_DIM: NP.darkenColor(base, 0.75),
            FG_BRIGHT: NP.brightenColor(base, 0.3),
            ACCENT: base,
            BORDER: NP.interpolateColor(base, "#0a0a0a", 0.7),
            HOVER_BG: NP.interpolateColor(base, "#0a0a0a", 0.85),
            SELECT_BG: NP.interpolateColor(base, "#0a0a0a", 0.8),
            CURSOR_COLOR: base,
            GLOW: base
        };
    };

    /* ---- Theme color map ---- */
    NP.THEMES = {
        matrix: "#00ff41",
        amber: "#ffb000",
        cyan: "#00e5ff",
        red: "#ff3333",
        purple: "#bf40ff",
        blue: "#4488ff",
        pink: "#ff69b4",
        white: "#cccccc",
        gold: "#ffd700",
        lime: "#bfff00",
        orange: "#ff6600",
        ice: "#88ddff",
        dracula: "#bd93f9",
        synthwave: "#ff7edb",
        nord: "#88c0d0",
        gruvbox: "#fabd2f",
        "tokyo-night": "#7aa2f7"
    };

    /* ---- Tkinter-style line.col <-> offset conversion ---- */

    NP.lineColToOffset = function (text, lineCol) {
        var parts = lineCol.split(".");
        var line = parseInt(parts[0], 10); // 1-based
        var col = parseInt(parts[1], 10);  // 0-based
        var lines = text.split("\n");
        var offset = 0;
        for (var i = 0; i < line - 1 && i < lines.length; i++) {
            offset += lines[i].length + 1; // +1 for newline
        }
        offset += col;
        return offset;
    };

    NP.offsetToLineCol = function (text, offset) {
        var line = 1;
        var col = 0;
        for (var i = 0; i < offset && i < text.length; i++) {
            if (text[i] === "\n") {
                line++;
                col = 0;
            } else {
                col++;
            }
        }
        return line + "." + col;
    };

})(window.NP);

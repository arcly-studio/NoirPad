/* font-picker.js - Font selection dialog */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var MONOSPACE_FONTS = [
        "Cascadia Code",
        "Fira Code",
        "JetBrains Mono",
        "Consolas",
        "Source Code Pro",
        "IBM Plex Mono",
        "Roboto Mono",
        "Ubuntu Mono",
        "Inconsolata",
        "Hack",
        "Droid Sans Mono",
        "PT Mono",
        "Anonymous Pro",
        "Courier New",
        "Courier",
        "Lucida Console",
        "Monaco",
        "Menlo",
        "DejaVu Sans Mono",
        "Liberation Mono",
        "monospace"
    ];

    var MIN_SIZE = 6;
    var MAX_SIZE = 72;
    var overlayEl = null;
    /* Editor selection captured when the picker opens — opening the modal
       moves focus, so we must remember the range to style only that text. */
    var savedRange = null;

    function saveEditorSelection() {
        savedRange = null;
        var editor = document.getElementById("editor");
        if (!editor) return;
        var sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        var range = sel.getRangeAt(0);
        if (range.collapsed) return;                  /* nothing selected */
        if (!editor.contains(range.commonAncestorContainer)) return;
        savedRange = range.cloneRange();
    }

    /* Wrap the saved selection in a <span> carrying font-family + size.
       _extractFormats() (editor.js) picks the span up as a
       {font,size,start,end} range, so it persists in the note and is
       re-emitted by _applyFormats() on reload — full round-trip. */
    function applyFontToSelection(fontFamily, sizePx) {
        var editor = document.getElementById("editor");
        if (!editor || !savedRange || savedRange.collapsed) return false;
        if (!editor.contains(savedRange.commonAncestorContainer)) return false;
        try {
            var span = document.createElement("span");
            span.style.fontFamily = fontFamily;
            span.style.fontSize = sizePx;
            span.appendChild(savedRange.extractContents());
            savedRange.insertNode(span);
            try {
                /* Re-select the styled text so the change is visible. */
                var sel = window.getSelection();
                var r = document.createRange();
                r.selectNodeContents(span);
                sel.removeAllRanges();
                sel.addRange(r);
                savedRange = r.cloneRange();
            } catch (e2) { /* reselect is cosmetic — ignore */ }
            return true;
        } catch (e) {
            console.warn("Font apply to selection failed:", e);
            return false;
        }
    }

    function isFontAvailable(fontName) {
        if (fontName === "monospace") return true;
        var testStr = "mmmmmmmmmmlli";
        var baseFonts = ["monospace", "sans-serif", "serif"];
        var canvas = document.createElement("canvas");
        var ctx = canvas.getContext("2d");
        ctx.font = "72px monospace";
        var defaultWidth = ctx.measureText(testStr).width;

        ctx.font = "72px '" + fontName + "', monospace";
        var testWidth = ctx.measureText(testStr).width;
        if (testWidth !== defaultWidth) return true;

        for (var i = 0; i < baseFonts.length; i++) {
            ctx.font = "72px " + baseFonts[i];
            var baseW = ctx.measureText(testStr).width;
            ctx.font = "72px '" + fontName + "', " + baseFonts[i];
            var fontW = ctx.measureText(testStr).width;
            if (fontW !== baseW) return true;
        }
        return false;
    }

    function getAvailableFonts() {
        var available = [];
        for (var i = 0; i < MONOSPACE_FONTS.length; i++) {
            if (isFontAvailable(MONOSPACE_FONTS[i])) {
                available.push(MONOSPACE_FONTS[i]);
            }
        }
        if (available.length === 0) {
            available.push("monospace");
        }
        return available;
    }

    function escapeHTML(str) {
        var div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    NP.fontPicker = {

        show: function () {
            if (overlayEl) return;

            /* Capture the editor selection BEFORE the modal steals focus. */
            saveEditorSelection();

            var fonts = getAvailableFonts();
            var currentFont = (NP.state && NP.state.data && NP.state.data.font_family) || "Consolas";
            var currentSize = (NP.state && NP.state.data && NP.state.data.font_size) || 14;

            /* Build overlay */
            var overlay = document.createElement("div");
            overlay.id = "font-picker-overlay";
            overlay.style.cssText =
                "position:fixed;top:0;left:0;width:100%;height:100%;" +
                "z-index:5000;background:rgba(0,0,0,0.85);" +
                "display:flex;align-items:center;justify-content:center;";

            var modal = document.createElement("div");
            modal.style.cssText =
                "background:var(--bg, #0a0a0a);border:1px solid var(--border, #1a2e1a);" +
                "border-radius:8px;width:520px;max-width:90vw;max-height:85vh;" +
                "display:flex;flex-direction:column;overflow:hidden;";

            /* Header */
            var header = document.createElement("div");
            header.style.cssText =
                "display:flex;align-items:center;justify-content:space-between;" +
                "padding:10px 16px;border-bottom:1px solid var(--border, #1a2e1a);flex-shrink:0;";
            header.innerHTML =
                '<span style="font-size:14px;font-weight:bold;color:var(--fg-bright, #4cff7a);' +
                'text-shadow:0 0 6px var(--glow, #00ff41);">V\u00ddB\u011aR FONTU</span>' +
                '<button id="font-picker-close" style="font-size:18px;color:var(--fg-dim, #00bf30);' +
                'cursor:pointer;background:none;border:none;padding:2px 8px;" title="Zav\u0159\u00edt">&times;</button>';
            modal.appendChild(header);

            /* Scrollable body — header stays fixed above, footer fixed
               below. flex:1 + min-height:0 + overflow-y:auto makes large
               previews scroll instead of pushing the buttons off-screen. */
            var body = document.createElement("div");
            body.style.cssText = "flex:1 1 auto;min-height:0;overflow-y:auto;";
            modal.appendChild(body);

            /* Filter input */
            var filterRow = document.createElement("div");
            filterRow.style.cssText = "padding:8px 16px;border-bottom:1px solid var(--border, #1a2e1a);flex-shrink:0;";
            var filterInput = document.createElement("input");
            filterInput.type = "text";
            filterInput.placeholder = "Filtrovat fonty...";
            filterInput.style.cssText =
                "width:100%;padding:4px 8px;font-size:12px;background:var(--bg-entry, #0d0d0d);" +
                "border:1px solid var(--border, #1a2e1a);border-radius:4px;color:var(--fg, #00ff41);";
            filterRow.appendChild(filterInput);
            body.appendChild(filterRow);

            /* Font list */
            var listContainer = document.createElement("div");
            listContainer.style.cssText =
                "flex:1;overflow-y:auto;padding:4px 0;min-height:120px;max-height:200px;";

            var selectedFont = currentFont;

            function renderList(filter) {
                listContainer.innerHTML = "";
                var lowerFilter = (filter || "").toLowerCase();
                for (var i = 0; i < fonts.length; i++) {
                    if (lowerFilter && fonts[i].toLowerCase().indexOf(lowerFilter) === -1) continue;
                    var item = document.createElement("div");
                    item.textContent = fonts[i];
                    item.dataset.font = fonts[i];
                    item.style.cssText =
                        "padding:5px 16px;cursor:pointer;font-size:12px;" +
                        "font-family:'" + fonts[i] + "',monospace;" +
                        "color:var(--fg, #00ff41);transition:background 0.1s ease;";
                    if (fonts[i] === selectedFont) {
                        item.style.background = "var(--hover-bg, #0f2314)";
                        item.style.color = "var(--fg-bright, #4cff7a)";
                    }
                    (function (fontName, el) {
                        el.addEventListener("click", function () {
                            selectedFont = fontName;
                            renderList(filterInput.value);
                            updatePreview();
                        });
                        el.addEventListener("mouseenter", function () {
                            el.style.background = "var(--hover-bg, #0f2314)";
                        });
                        el.addEventListener("mouseleave", function () {
                            if (fontName !== selectedFont) {
                                el.style.background = "transparent";
                            }
                        });
                    })(fonts[i], item);
                    listContainer.appendChild(item);
                }
            }

            renderList("");
            body.appendChild(listContainer);

            /* Size input row */
            var sizeRow = document.createElement("div");
            sizeRow.style.cssText =
                "display:flex;align-items:center;gap:10px;padding:8px 16px;" +
                "border-top:1px solid var(--border, #1a2e1a);flex-shrink:0;";
            sizeRow.innerHTML =
                '<label style="font-size:12px;color:var(--fg-dim, #00bf30);">Velikost:</label>';
            var sizeInput = document.createElement("input");
            sizeInput.type = "number";
            sizeInput.min = MIN_SIZE;
            sizeInput.max = MAX_SIZE;
            sizeInput.value = currentSize;
            sizeInput.style.cssText =
                "width:60px;padding:3px 6px;font-size:12px;text-align:center;" +
                "background:var(--bg-entry, #0d0d0d);border:1px solid var(--border, #1a2e1a);" +
                "border-radius:4px;color:var(--fg, #00ff41);";
            sizeRow.appendChild(sizeInput);
            sizeRow.innerHTML += '<span style="font-size:11px;color:var(--fg-dim, #00bf30);">px (' + MIN_SIZE + '-' + MAX_SIZE + ')</span>';
            /* Re-get sizeInput after innerHTML concat */
            body.appendChild(sizeRow);
            sizeInput = sizeRow.querySelector("input");

            /* Preview area */
            var previewBox = document.createElement("div");
            previewBox.style.cssText =
                "padding:12px 16px;border-top:1px solid var(--border, #1a2e1a);flex-shrink:0;";
            var previewLabel = document.createElement("div");
            previewLabel.style.cssText = "font-size:11px;color:var(--fg-dim, #00bf30);margin-bottom:6px;";
            previewLabel.textContent = "N\u00e1hled:";
            previewBox.appendChild(previewLabel);

            var previewArea = document.createElement("div");
            previewArea.style.cssText =
                "padding:10px;background:var(--bg-entry, #0d0d0d);border:1px solid var(--border, #1a2e1a);" +
                "border-radius:4px;color:var(--fg, #00ff41);min-height:48px;max-height:180px;" +
                "overflow:auto;white-space:pre-wrap;";
            previewArea.textContent = "The quick brown fox jumps over the lazy dog.\nABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789\n!@#$%^&*() {}<>[] =+-_";
            previewBox.appendChild(previewArea);
            body.appendChild(previewBox);

            function updatePreview() {
                var size = parseInt(sizeInput.value, 10) || currentSize;
                if (size < MIN_SIZE) size = MIN_SIZE;
                if (size > MAX_SIZE) size = MAX_SIZE;
                previewArea.style.fontFamily = "'" + selectedFont + "', monospace";
                previewArea.style.fontSize = size + "px";
            }

            updatePreview();

            /* Button row */
            var btnRow = document.createElement("div");
            btnRow.style.cssText =
                "display:flex;justify-content:flex-end;gap:8px;padding:10px 16px;" +
                "border-top:1px solid var(--border, #1a2e1a);flex-shrink:0;";

            var cancelBtn = document.createElement("button");
            cancelBtn.textContent = "Zru\u0161it";
            cancelBtn.style.cssText =
                "padding:5px 16px;font-size:12px;border-radius:4px;" +
                "border:1px solid var(--border, #1a2e1a);color:var(--fg-dim, #00bf30);" +
                "background:transparent;cursor:pointer;";
            btnRow.appendChild(cancelBtn);

            var applyBtn = document.createElement("button");
            applyBtn.textContent = "Pou\u017e\u00edt";
            applyBtn.style.cssText =
                "padding:5px 16px;font-size:12px;border-radius:4px;" +
                "border:1px solid var(--accent, #00ff41);color:var(--fg-bright, #4cff7a);" +
                "background:var(--hover-bg, #0f2314);cursor:pointer;";
            btnRow.appendChild(applyBtn);
            modal.appendChild(btnRow);

            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            overlayEl = overlay;

            /* Event handlers */
            filterInput.addEventListener("input", function () {
                renderList(filterInput.value);
            });

            sizeInput.addEventListener("input", function () {
                updatePreview();
            });

            cancelBtn.addEventListener("click", function () {
                close();
            });

            applyBtn.addEventListener("click", function () {
                var size = parseInt(sizeInput.value, 10) || currentSize;
                if (size < MIN_SIZE) size = MIN_SIZE;
                if (size > MAX_SIZE) size = MAX_SIZE;

                var fontFamily = "'" + selectedFont + "', monospace";
                var sizePx = size + "px";

                if (savedRange && !savedRange.collapsed &&
                    applyFontToSelection(fontFamily, sizePx)) {
                    /* Per-text styling: lives in the note's content/formats,
                       NOT the global app default — so do NOT touch
                       editor.style or saveSettings. Persist the note now so
                       it survives reload (via _extractFormats). */
                    if (NP.editor && NP.editor.save) NP.editor.save(true);
                } else {
                    /* No selection → editor-wide default (existing
                       behaviour, persisted as a global app setting). */
                    var editor = document.getElementById("editor");
                    if (editor) {
                        editor.style.fontFamily = fontFamily;
                        editor.style.fontSize = sizePx;
                    }
                    if (NP.state && NP.state.data) {
                        NP.state.data.font_family = selectedFont;
                        NP.state.data.font_size = size;
                    }
                    if (NP.api && NP.api.saveSettings) {
                        NP.api.saveSettings({ font_family: selectedFont, font_size: size });
                    }
                }

                close();
            });

            header.querySelector("#font-picker-close").addEventListener("click", function () {
                close();
            });

            overlay.addEventListener("click", function (e) {
                if (e.target === overlay) close();
            });

            var escHandler = function (e) {
                if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    close();
                }
            };
            document.addEventListener("keydown", escHandler, true);

            function close() {
                document.removeEventListener("keydown", escHandler, true);
                if (overlayEl && overlayEl.parentNode) {
                    overlayEl.parentNode.removeChild(overlayEl);
                }
                overlayEl = null;
            }

            /* Focus filter */
            filterInput.focus();
        }
    };

})(window.NP);

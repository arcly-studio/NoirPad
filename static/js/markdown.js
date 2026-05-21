/* markdown.js — Phase 4b: split-pane preview

   In MD mode the editor area splits into two panes:
     #md-source   — textarea, plain markdown source (no rendering)
     #md-preview  — rendered HTML with real block-level styling
                    (big H1 32px, blockquote bars, code blocks, etc.)

   No DOM is mutated inside contentEditable. No alignment constraint
   between source and preview, so the preview can use arbitrary
   font-sizes / line-heights — classic markdown render. The textarea
   is the source of truth; the preview is read-only output rebuilt
   on input (debounced). */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var renderTimer = null;
    var lastRendered = null;

    function escapeHtml(s) {
        return s.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    /* Inline markdown — code → image → link → bold → italic →
       strikethrough. Order matters: code claims its content first,
       image precedes link so `!` is part of the image match, bold
       precedes italic so `*` inside `**…**` is consumed by bold.
       Syntax markers (#, **, etc.) are wrapped in .md-syntax which
       the preview hides via CSS. */
    function processInline(text) {
        var html = escapeHtml(text);

        html = html.replace(/`([^`\n]+)`/g, function (_m, code) {
            return '<span class="md-inline-code">' +
                '<span class="md-syntax">`</span>' + code +
                '<span class="md-syntax">`</span></span>';
        });

        /* Image MUST be processed before the link regex below — without
           that order, `![alt](url)` would match the link pattern (the `!`
           prefix is not part of the link grammar) and render as text.
           Emit a real <img> so the preview actually displays the image
           instead of a styled "source view" with the URL hidden by CSS.
           escapeHtml already escaped &/</>, but not quotes — guard the
           attributes against URL/alt containing a literal ". */
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
            function (_m, alt, url) {
                var safeUrl = url.replace(/"/g, "&quot;");
                var safeAlt = alt.replace(/"/g, "&quot;");
                return '<img class="md-image" src="' + safeUrl +
                    '" alt="' + safeAlt + '" draggable="false">';
            });

        /* Real <a href> so the global click handler in images.js can
           read the URL — /images/* opens the in-app viewer, external
           URLs open in a new tab. The inner .md-syntax / .md-link-url
           spans are kept (and hidden by CSS) so the preview still
           collapses to just the visible link text. */
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
            function (_m, txt, url) {
                var safeUrl = url.replace(/"/g, "&quot;");
                return '<a href="' + safeUrl + '" class="md-link">' +
                    '<span class="md-syntax">[</span>' + txt +
                    '<span class="md-syntax">](</span>' +
                    '<span class="md-link-url">' + url + '</span>' +
                    '<span class="md-syntax">)</span></a>';
            });

        html = html.replace(/\*\*([^*\n]+)\*\*/g, function (_m, txt) {
            return '<span class="md-bold">' +
                '<span class="md-syntax">**</span>' + txt +
                '<span class="md-syntax">**</span></span>';
        });

        html = html.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,!?;:])/g,
            function (_m, before, txt) {
                return before + '<span class="md-italic">' +
                    '<span class="md-syntax">*</span>' + txt +
                    '<span class="md-syntax">*</span></span>';
            });

        html = html.replace(/~~([^~\n]+)~~/g, function (_m, txt) {
            return '<span class="md-strike">' +
                '<span class="md-syntax">~~</span>' + txt +
                '<span class="md-syntax">~~</span></span>';
        });

        return html;
    }

    /* Compose the preview HTML — real block-level elements (display:
       block via CSS) so headings can use arbitrary font sizes. */
    function renderPreview(rawText) {
        var lines = rawText.split("\n");
        var out = [];
        var inCode = false;
        var codeLines = [];

        function flushCode() {
            out.push('<div class="md-codeblock">' +
                escapeHtml(codeLines.join("\n")) + "</div>");
            codeLines = [];
        }

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var fence = line.match(/^```(.*)$/);
            if (fence) {
                if (inCode) {
                    flushCode();
                    inCode = false;
                } else {
                    inCode = true;
                }
                continue;
            }
            if (inCode) {
                codeLines.push(line);
                continue;
            }
            var m;
            m = line.match(/^(###)\s+(.*)$/);
            if (m) {
                out.push('<div class="md-h3">' + processInline(m[2]) + "</div>");
                continue;
            }
            m = line.match(/^(##)\s+(.*)$/);
            if (m) {
                out.push('<div class="md-h2">' + processInline(m[2]) + "</div>");
                continue;
            }
            m = line.match(/^(#)\s+(.*)$/);
            if (m) {
                out.push('<div class="md-h1">' + processInline(m[2]) + "</div>");
                continue;
            }
            m = line.match(/^(>)\s+(.*)$/);
            if (m) {
                out.push('<div class="md-quote">' + processInline(m[2]) + "</div>");
                continue;
            }
            m = line.match(/^([-*+])\s+(.*)$/);
            if (m) {
                out.push('<div class="md-list">• ' + processInline(m[2]) + "</div>");
                continue;
            }
            if (line === "") {
                out.push('<div class="md-empty"></div>');
                continue;
            }
            out.push('<div class="md-line">' + processInline(line) + "</div>");
        }
        if (inCode) flushCode();
        return out.join("");
    }

    /* ---- DOM helpers ---- */

    function getEls() {
        return {
            editor: document.getElementById("editor"),
            ta: document.getElementById("editor-md"),
            preview: document.getElementById("md-preview"),
            stack: document.getElementById("md-stack"),
            btn: document.getElementById("btn-md-toggle")
        };
    }

    function isMdMode() {
        return document.body.classList.contains("editor-md-active");
    }

    function scheduleRender() {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(function () {
            renderTimer = null;
            var els = getEls();
            if (!els.ta || !els.preview) return;
            var src = els.ta.value;
            if (src === lastRendered) return;
            els.preview.innerHTML = renderPreview(src);
            lastRendered = src;
        }, 60);
    }

    function updateMdButtonState() {
        var els = getEls();
        if (!els.btn) return;
        els.btn.classList.toggle("active", isMdMode());
    }

    /* ---- Public API ---- */

    NP.markdown = {

        /* Switch to MD mode for the currently open note. Copies the
           editor's plain text into the textarea, renders the preview,
           reveals the split-pane stack. */
        enableForEditor: function () {
            var els = getEls();
            if (!els.ta || !els.preview) return;
            /* innerText (not textContent) so the rich-text load
               path's <br>s become \n in the textarea. */
            var src = els.editor ? (els.editor.innerText || "") : "";
            els.ta.value = src;
            lastRendered = null;
            document.body.classList.add("editor-md-active");
            updateMdButtonState();
            els.preview.innerHTML = renderPreview(src);
            lastRendered = src;
        },

        /* Leave MD mode — write the textarea back into the editor
           with <br>s for line breaks, hide the stack. */
        disableForEditor: function () {
            var els = getEls();
            if (!els.editor) return;
            var src = els.ta ? (els.ta.value || "") : "";
            document.body.classList.remove("editor-md-active");
            updateMdButtonState();
            els.editor.innerHTML = "";
            var lines = src.split("\n");
            for (var i = 0; i < lines.length; i++) {
                if (i > 0) els.editor.appendChild(document.createElement("br"));
                els.editor.appendChild(document.createTextNode(lines[i]));
            }
        },

        /* MD button click + Ctrl+M shortcut. */
        toggleForCurrentNote: function () {
            var id = NP.state && NP.state.currentNoteId;
            if (!id) return;
            var data = NP.state.data;
            if (!data) return;
            var modes = data.note_modes = data.note_modes || {};
            var nextMode = modes[id] === "markdown" ? "rich-text" : "markdown";

            if (nextMode === "markdown") {
                modes[id] = "markdown";
                NP.markdown.enableForEditor();
            } else {
                delete modes[id];
                NP.markdown.disableForEditor();
            }

            var content;
            if (nextMode === "markdown") {
                var ta = document.getElementById("editor-md");
                content = ta ? ta.value : "";
            } else if (NP.editor && NP.editor._htmlToTextWithImages) {
                content = NP.editor._htmlToTextWithImages().text;
            } else {
                content = "";
            }
            var formats = (nextMode !== "markdown" &&
                NP.editor && NP.editor._extractFormats)
                ? NP.editor._extractFormats() : [];
            if (NP.api && NP.api.saveNote) {
                NP.api.saveNote(id, content, formats, { mode: nextMode });
            }
        },

        /* Called from editor.loadNote once content is in #editor.
           Flips to MD if the loaded note's mode is markdown. */
        applyForLoadedNote: function (noteId) {
            var modes = NP.state && NP.state.data && NP.state.data.note_modes;
            var wantMd = noteId && modes && modes[noteId] === "markdown";
            if (wantMd) {
                NP.markdown.enableForEditor();
            } else if (isMdMode()) {
                NP.markdown.disableForEditor();
            }
            updateMdButtonState();
        },

        /* Plain-text getter for the save path. */
        getRawText: function () {
            var ta = document.getElementById("editor-md");
            return ta ? ta.value : "";
        },

        isActive: isMdMode
    };

    /* ---- Wiring ---- */

    document.addEventListener("DOMContentLoaded", function () {
        var els = getEls();
        if (els.btn) {
            els.btn.addEventListener("click", NP.markdown.toggleForCurrentNote);
        }
        if (els.ta) {
            els.ta.addEventListener("input", scheduleRender);
        }
    });

})(window.NP);

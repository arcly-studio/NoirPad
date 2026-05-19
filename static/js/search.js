/* search.js - NoirPad in-note search (Ctrl+F) */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var HIGHLIGHT_CLASS = "np-search-hl";
    var CURRENT_CLASS = "np-search-hl-current";
    var bar = null;
    var inputEl = null;
    var countEl = null;

    function ensureDOM() {
        if (bar) return;

        bar = document.createElement("div");
        bar.className = "np-search-bar";
        bar.style.cssText =
            "display:none;position:absolute;top:0;right:0;z-index:800;" +
            "background:var(--bg-dark,#0a0a0a);border:1px solid var(--fg-dim,#006b1d);" +
            "border-top:none;border-radius:0 0 0 8px;padding:6px 10px;" +
            "font-family:var(--font-mono,'Consolas',monospace);font-size:13px;gap:6px;" +
            "display:none;align-items:center;";

        inputEl = document.createElement("input");
        inputEl.type = "text";
        inputEl.placeholder = "Find...";
        inputEl.style.cssText =
            "width:180px;padding:4px 8px;background:var(--bg,#000);color:var(--fg,#00ff41);" +
            "border:1px solid var(--fg-dim,#006b1d);border-radius:3px;" +
            "font-family:inherit;font-size:inherit;outline:none;";

        countEl = document.createElement("span");
        countEl.style.cssText = "color:var(--fg-dim,#006b1d);margin:0 6px;min-width:50px;";
        countEl.textContent = "";

        var prevBtn = document.createElement("button");
        prevBtn.textContent = "\u25B2";
        prevBtn.title = "Previous (Shift+F3)";
        styleBtn(prevBtn);
        prevBtn.addEventListener("click", function () { NP.search.prev(); });

        var nextBtn = document.createElement("button");
        nextBtn.textContent = "\u25BC";
        nextBtn.title = "Next (F3)";
        styleBtn(nextBtn);
        nextBtn.addEventListener("click", function () { NP.search.next(); });

        var closeBtn = document.createElement("button");
        closeBtn.textContent = "\u2715";
        closeBtn.title = "Close (Escape)";
        styleBtn(closeBtn);
        closeBtn.addEventListener("click", function () { NP.search.hide(); });

        bar.appendChild(inputEl);
        bar.appendChild(countEl);
        bar.appendChild(prevBtn);
        bar.appendChild(nextBtn);
        bar.appendChild(closeBtn);

        /* Insert into editor area */
        var editorWrap = document.getElementById("editor-wrapper")
            || document.getElementById("editor-container")
            || document.getElementById("editor-area");
        if (editorWrap) {
            editorWrap.style.position = "relative";
            editorWrap.appendChild(bar);
        } else {
            document.body.appendChild(bar);
        }

        inputEl.addEventListener("input", function () {
            NP.search.find(inputEl.value);
        });
        inputEl.addEventListener("keydown", function (e) {
            if (e.key === "Escape") {
                e.preventDefault();
                NP.search.hide();
            } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                NP.search.next();
            } else if (e.key === "Enter" && e.shiftKey) {
                e.preventDefault();
                NP.search.prev();
            } else if (e.key === "F3" && !e.shiftKey) {
                e.preventDefault();
                NP.search.next();
            } else if (e.key === "F3" && e.shiftKey) {
                e.preventDefault();
                NP.search.prev();
            }
        });

        /* Inject highlight styles */
        var style = document.createElement("style");
        style.textContent =
            "." + HIGHLIGHT_CLASS + "{background:var(--accent,#00ff41);color:var(--bg,#000);border-radius:2px;}" +
            "." + CURRENT_CLASS + "{background:var(--fg-bright,#33ff66);color:var(--bg,#000);border-radius:2px;}";
        document.head.appendChild(style);
    }

    function styleBtn(btn) {
        btn.style.cssText =
            "background:none;border:1px solid var(--fg-dim,#006b1d);color:var(--fg,#00ff41);" +
            "cursor:pointer;padding:2px 8px;border-radius:3px;font-size:12px;" +
            "font-family:var(--font-mono,'Consolas',monospace);";
    }

    function getEditor() {
        return document.getElementById("editor");
    }

    function walkText(node, callback) {
        if (node.nodeType === 3) {
            callback(node);
        } else if (node.nodeType === 1 && node.nodeName !== "SCRIPT" && node.nodeName !== "STYLE") {
            var children = Array.prototype.slice.call(node.childNodes);
            for (var i = 0; i < children.length; i++) {
                walkText(children[i], callback);
            }
        }
    }

    NP.search = {
        visible: false,
        matches: [],
        currentIndex: -1,

        toggle: function () {
            if (NP.search.visible) {
                NP.search.hide();
            } else {
                NP.search.show();
            }
        },

        show: function () {
            ensureDOM();
            bar.style.display = "flex";
            NP.search.visible = true;
            inputEl.value = "";
            countEl.textContent = "";
            inputEl.focus();
            inputEl.select();
        },

        hide: function () {
            if (!bar) return;
            NP.search.visible = false;
            bar.style.display = "none";
            NP.search._clearHighlights();
            NP.search.matches = [];
            NP.search.currentIndex = -1;
        },

        find: function (query) {
            ensureDOM();
            if (!NP.search.visible) NP.search.show();
            NP.search._clearHighlights();
            NP.search.matches = [];
            NP.search.currentIndex = -1;

            if (!query) {
                NP.search._updateCount();
                return;
            }

            NP.search._highlight(query);

            if (NP.search.matches.length > 0) {
                NP.search.currentIndex = 0;
                NP.search._markCurrent();
            }
            NP.search._updateCount();
        },

        next: function () {
            if (!NP.search.matches.length) return;
            NP.search.currentIndex = (NP.search.currentIndex + 1) % NP.search.matches.length;
            NP.search._markCurrent();
            NP.search._updateCount();
        },

        prev: function () {
            if (!NP.search.matches.length) return;
            NP.search.currentIndex = NP.search.currentIndex <= 0
                ? NP.search.matches.length - 1
                : NP.search.currentIndex - 1;
            NP.search._markCurrent();
            NP.search._updateCount();
        },

        _highlight: function (query) {
            var editor = getEditor();
            if (!editor) return;

            var lowerQuery = query.toLowerCase();
            var marks = [];

            walkText(editor, function (textNode) {
                var text = textNode.textContent;
                var lower = text.toLowerCase();
                var idx = lower.indexOf(lowerQuery);
                if (idx === -1) return;

                var frag = document.createDocumentFragment();
                var lastIdx = 0;

                while (idx !== -1) {
                    /* Text before match */
                    if (idx > lastIdx) {
                        frag.appendChild(document.createTextNode(text.substring(lastIdx, idx)));
                    }
                    /* Wrap match in mark */
                    var mark = document.createElement("mark");
                    mark.className = HIGHLIGHT_CLASS;
                    mark.textContent = text.substring(idx, idx + query.length);
                    frag.appendChild(mark);
                    marks.push(mark);

                    lastIdx = idx + query.length;
                    idx = lower.indexOf(lowerQuery, lastIdx);
                }

                /* Remaining text */
                if (lastIdx < text.length) {
                    frag.appendChild(document.createTextNode(text.substring(lastIdx)));
                }

                textNode.parentNode.replaceChild(frag, textNode);
            });

            NP.search.matches = marks;
        },

        _clearHighlights: function () {
            var editor = getEditor();
            if (!editor) return;

            var marks = editor.querySelectorAll("mark." + HIGHLIGHT_CLASS + ", mark." + CURRENT_CLASS);
            for (var i = 0; i < marks.length; i++) {
                var mark = marks[i];
                var parent = mark.parentNode;
                parent.replaceChild(document.createTextNode(mark.textContent), mark);
                parent.normalize();
            }
            NP.search.matches = [];
        },

        _markCurrent: function () {
            /* Reset all to normal highlight */
            for (var i = 0; i < NP.search.matches.length; i++) {
                NP.search.matches[i].className = HIGHLIGHT_CLASS;
            }
            /* Highlight current */
            var cur = NP.search.matches[NP.search.currentIndex];
            if (cur) {
                cur.className = CURRENT_CLASS;
                cur.scrollIntoView({ behavior: "smooth", block: "center" });
            }
        },

        _updateCount: function () {
            if (!countEl) return;
            if (!NP.search.matches.length) {
                countEl.textContent = inputEl && inputEl.value ? "0 of 0" : "";
            } else {
                countEl.textContent = (NP.search.currentIndex + 1) + " of " + NP.search.matches.length;
            }
        }
    };

    /* F3 / Shift+F3 are now handled centrally (NP.shortcuts:
       find-next / find-prev → NP.search.next/prev). */

})(window.NP);

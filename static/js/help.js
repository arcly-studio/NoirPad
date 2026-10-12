/* help.js - Built-in help window (F1) */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* The table holds i18n KEYS, not texts: dictionaries load after this
       script is parsed, so NP.t() is called when a section is rendered.
       Key caps, commands and "raw" bullets (theme names) stay as they are. */
    var HELP_SECTIONS = [
        {
            title: "help.overview.title",
            content: [
                { type: "text", value: "help.overview.p1" },
                { type: "text", value: "help.overview.p2" }
            ]
        },
        {
            title: "help.keys.title",
            content: [
                { type: "header", value: "help.keys.basic" },
                { type: "shortcuts", value: [
                    ["Ctrl+S", "help.keys.save"],
                    ["Ctrl+F", "help.keys.find"],
                    ["Ctrl+B", "help.keys.focus"],
                    ["Ctrl+L", "help.keys.orientation"],
                    ["Ctrl+I", "help.keys.italic"],
                    ["Ctrl+U", "help.keys.underline"],
                    ["Ctrl+Z", "help.keys.undo"],
                    ["Ctrl+Y", "help.keys.redo"],
                    ["Ctrl+V", "help.keys.paste"],
                    ["Ctrl+Shift+P", "help.keys.commandBar"],
                    ["Ctrl+M", "shortcuts.labels.toggleMarkdown"],
                    ["Ctrl+D", "shortcuts.labels.toggleFavorite"],
                    ["Ctrl+Shift+L", "shortcuts.labels.toggleLock"],
                    ["Ctrl+Shift+N", "shortcuts.labels.newNote"],
                    ["Ctrl+Shift+F", "shortcuts.labels.newFolder"],
                    ["Ctrl+Shift+I", "shortcuts.labels.insertImage"],
                    ["Ctrl+Shift+T", "shortcuts.labels.openFontPicker"],
                    ["Ctrl+,", "shortcuts.labels.openSettings"],
                    ["Ctrl+Tab", "help.keys.nextTab"],
                    ["Ctrl+Shift+Tab", "help.keys.prevTab"],
                    ["Ctrl+W", "help.keys.closeTab"]
                ]},
                { type: "header", value: "help.keys.function" },
                { type: "shortcuts", value: [
                    ["F1", "help.keys.help"],
                    ["F2", "help.keys.rename"],
                    ["F3", "help.keys.findNext"],
                    ["Shift+F3", "help.keys.findPrev"],
                    ["F11", "help.keys.fullscreen"],
                    ["Delete", "help.keys.delete"],
                    ["Escape", "help.keys.closeOverlay"]
                ]}
            ]
        },
        {
            title: "help.commands.title",
            content: [
                { type: "text", value: "help.commands.intro" },
                { type: "header", value: "help.commands.available" },
                { type: "commands", value: [
                    [":search", "help.commands.search"],
                    [":new note", "help.commands.newNote"],   // i18n-ignore (command)
                    [":new folder", "help.commands.newFolder"],   // i18n-ignore (command)
                    [":theme", "help.commands.theme"],
                    [":encrypt", "help.commands.encrypt"],
                    [":decrypt", "help.commands.decrypt"],
                    [":fullscreen", "help.commands.fullscreen"],
                    [":autosave", "help.commands.autosave"],
                    [":export", "help.commands.export"],
                    [":exportpdf", "help.commands.exportPdf"],
                    [":exporthtml", "help.commands.exportHtml"],
                    [":focus", "help.commands.focus"],
                    [":tag", "help.commands.tag"],
                    [":tags", "help.commands.tags"],
                    [":fontsize", "help.commands.fontSize"],
                    [":font", "help.commands.font"],
                    [":backup", "help.commands.backup"],
                    [":import", "help.commands.import"],
                    [":fav", "help.commands.fav"],
                    [":emptytrash", "help.commands.emptyTrash"],
                    [":orientation", "help.commands.orientation"],
                    [":matrix", "help.commands.matrix"],
                    [":help", "help.commands.help"],
                    [":findall", "commands.desc.findall"],
                    [":crt", "commands.desc.crt"],
                    [":settings", "commands.desc.settings"],
                    [":closetab", "commands.desc.closetab"],
                    [":closeall", "commands.desc.closeall"]
                ]}
            ]
        },
        {
            title: "help.notes.title",
            content: [
                { type: "bullets", value: [
                    "help.notes.tree",
                    "help.notes.drag",
                    "help.notes.contextMenu",
                    "help.notes.rename",
                    "help.notes.delete"
                ]}
            ]
        },
        {
            title: "help.editor.title",
            content: [
                { type: "bullets", value: [
                    "help.editor.monospace",
                    "help.editor.formatting",
                    "help.editor.undo",
                    "help.editor.orientation"
                ]}
            ]
        },
        {
            title: "help.encryption.title",
            content: [
                { type: "text", value: "help.encryption.intro" },
                { type: "bullets", value: [
                    "help.encryption.encrypt",
                    "help.encryption.decrypt",
                    "help.encryption.notEncrypted",
                    "help.encryption.password"
                ]}
            ]
        },
        {
            title: "help.images.title",
            content: [
                { type: "bullets", value: [
                    "help.images.paste",
                    "help.images.folder",
                    "help.images.zoom",
                    "help.images.viewer"
                ]}
            ]
        },
        {
            title: "help.export.title",
            content: [
                { type: "bullets", value: [
                    "help.export.text",
                    "help.export.pdf",
                    "help.export.html",
                    "help.export.all"
                ]}
            ]
        },
        {
            title: "help.tags.title",
            content: [
                { type: "bullets", value: [
                    "help.tags.tag",
                    "help.tags.tags",
                    "help.tags.fav",
                    "help.tags.sorting"
                ]}
            ]
        },
        {
            title: "help.themes.title",
            content: [
                { type: "text", value: "help.themes.intro" },
                { type: "bullets", raw: true, value: [
                    "matrix, amber, cyan, red, purple, blue",
                    "pink, white, gold, lime, orange, ice",
                    "dracula, synthwave, nord, gruvbox, tokyo-night"
                ]}
            ]
        },
        {
            title: "help.backup.title",
            content: [
                { type: "bullets", value: [
                    "help.backup.backup",
                    "help.backup.import"
                ]}
            ]
        },
        {
            title: "help.effects.title",
            content: [
                { type: "bullets", value: [
                    "help.effects.matrix",
                    "help.effects.splash",
                    "help.effects.crt",
                    "help.effects.focus"
                ]}
            ]
        },
        {
            title: "help.md.title",
            content: [
                { type: "md-intro", value: "help.md.intro" },
                /* Item id -> <id>.syntax, <id>.desc and, with snippet: true,
                   <id>.snippet (the text copied); otherwise snippet = syntax. */
                { type: "md-category", title: "help.md.headings", items: [
                    { id: "help.md.h1" },
                    { id: "help.md.h2" },
                    { id: "help.md.h3" }
                ]},
                { type: "md-category", title: "help.md.textFormatting", items: [
                    { id: "help.md.bold" },
                    { id: "help.md.italic" },
                    { id: "help.md.strike" }
                ]},
                { type: "md-category", title: "help.md.lists", items: [
                    { id: "help.md.ul", snippet: true },
                    { id: "help.md.ol", snippet: true },
                    { id: "help.md.task", snippet: true }
                ]},
                { type: "md-category", title: "help.md.code", items: [
                    { id: "help.md.inlineCode" },
                    { id: "help.md.codeBlock", snippet: true }
                ]},
                { type: "md-note", value: "help.md.tipBacktick" },
                { type: "md-category", title: "help.md.links", items: [
                    { id: "help.md.link", snippet: true }
                ]},
                { type: "md-category", title: "help.md.images", items: [
                    { id: "help.md.image", snippet: true }
                ]},
                { type: "md-note", value: "help.md.tipImages" },
                { type: "md-category", title: "help.md.other", items: [
                    { id: "help.md.quote", snippet: true }
                ]},
                /* Row: [key cap, key of the markdown sample shown in <code>] */
                { type: "md-shortcuts", title: "help.md.shortcuts", items: [
                    ["Ctrl+B", "help.md.wrap.bold"],
                    ["Ctrl+I", "help.md.wrap.italic"],
                    ["Ctrl+E", "help.md.wrap.code"],
                    ["Ctrl+K", "help.md.wrap.link"]
                ]}
            ]
        }
    ];

    var overlayEl = null;

    function buildHTML() {
        var html = "";

        /* Overlay container */
        html += '<div id="help-overlay" style="position:fixed;top:0;left:0;width:100%;height:100%;' +
            'z-index:5000;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;">';

        /* Modal box */
        html += '<div style="display:flex;width:80%;max-width:900px;height:75vh;' +
            'background:var(--bg, #0a0a0a);border:1px solid var(--border, #1a2e1a);border-radius:8px;overflow:hidden;">';

        /* Left nav */
        html += '<div id="help-nav" style="width:200px;min-width:160px;border-right:1px solid var(--border, #1a2e1a);' +
            'overflow-y:auto;padding:12px 0;flex-shrink:0;">';
        for (var i = 0; i < HELP_SECTIONS.length; i++) {
            html += '<div class="help-nav-item" data-idx="' + i + '" style="padding:6px 16px;cursor:pointer;' +
                'font-size:12px;color:var(--fg-dim, #00bf30);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
                'transition:background 0.15s ease, color 0.15s ease;">' +
                NP.escapeHtml(NP.t(HELP_SECTIONS[i].title)) + '</div>';
        }
        html += '</div>';

        /* Right content */
        html += '<div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">';

        /* Header bar with close button */
        html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;' +
            'border-bottom:1px solid var(--border, #1a2e1a);flex-shrink:0;">';
        html += '<span style="font-size:14px;font-weight:bold;color:var(--fg-bright, #4cff7a);' +
            'text-shadow:0 0 6px var(--glow, #00ff41);">' + NP.escapeHtml(NP.t("help.title")) + '</span>';
        html += '<button id="help-close-btn" style="font-size:18px;color:var(--fg-dim, #00bf30);' +
            'cursor:pointer;background:none;border:none;padding:2px 8px;" title="' +
            NP.escapeHtml(NP.t("help.close")) + '">&times;</button>';
        html += '</div>';

        /* Content area */
        html += '<div id="help-content" style="flex:1;overflow-y:auto;padding:16px 20px;font-size:13px;' +
            'line-height:1.7;color:var(--fg, #00ff41);">';
        html += '</div>';

        html += '</div>'; /* /right */
        html += '</div>'; /* /modal */
        html += '</div>'; /* /overlay */

        return html;
    }

    function renderSection(idx) {
        var section = HELP_SECTIONS[idx];
        if (!section) return "";

        var html = '<h2 style="margin:0 0 12px 0;font-size:16px;color:var(--fg-bright, #4cff7a);' +
            'text-shadow:0 0 4px var(--glow, #00ff41);">' + NP.escapeHtml(NP.t(section.title)) + '</h2>';

        for (var i = 0; i < section.content.length; i++) {
            var block = section.content[i];
            switch (block.type) {
                case "text":
                    html += '<p style="margin:0 0 10px 0;">' + NP.escapeHtml(NP.t(block.value)) + '</p>';
                    break;
                case "header":
                    html += '<h3 style="margin:16px 0 8px 0;font-size:13px;color:var(--fg-bright, #4cff7a);">' +
                        NP.escapeHtml(NP.t(block.value)) + '</h3>';
                    break;
                case "bullets":
                    html += '<ul style="margin:0 0 10px 0;padding-left:20px;">';
                    for (var b = 0; b < block.value.length; b++) {
                        html += '<li style="margin:2px 0;color:var(--fg, #00ff41);">' +
                            NP.escapeHtml(block.raw ? block.value[b] : NP.t(block.value[b])) + '</li>';
                    }
                    html += '</ul>';
                    break;
                case "shortcuts":
                case "commands":
                    html += '<table style="border-collapse:collapse;margin:0 0 12px 0;width:100%;">';
                    for (var r = 0; r < block.value.length; r++) {
                        var row = block.value[r];
                        html += '<tr>';
                        html += '<td style="padding:3px 12px 3px 0;white-space:nowrap;color:var(--fg-bright, #4cff7a);' +
                            'font-weight:bold;font-size:12px;border-bottom:1px solid var(--border, #1a2e1a);">' +
                            NP.escapeHtml(row[0]) + '</td>';
                        html += '<td style="padding:3px 0;color:var(--fg-dim, #00bf30);font-size:12px;' +
                            'border-bottom:1px solid var(--border, #1a2e1a);">' +
                            NP.escapeHtml(NP.t(row[1])) + '</td>';
                        html += '</tr>';
                    }
                    html += '</table>';
                    break;
                case "md-intro":
                    html += '<p class="help-section-intro">' + NP.escapeHtml(NP.t(block.value)) + '</p>';
                    break;
                case "md-category":
                    html += '<div class="md-help-category">';
                    html += '<h3 class="md-help-cat-title">' + NP.escapeHtml(NP.t(block.title)) + '</h3>';
                    html += '<div class="md-help-grid">';
                    for (var mi = 0; mi < block.items.length; mi++) {
                        var it = block.items[mi];
                        var syntax = NP.t(it.id + ".syntax");
                        var snippet = it.snippet ? NP.t(it.id + ".snippet") : syntax;
                        html += '<div class="md-help-item" data-snippet="' + NP.escapeHtml(snippet) + '">' +
                            '<code class="md-help-syntax">' + NP.escapeHtml(syntax) + '</code>' +
                            '<span class="md-help-desc">' + NP.escapeHtml(NP.t(it.id + ".desc")) + '</span>' +
                            '</div>';
                    }
                    html += '</div></div>';
                    break;
                case "md-note":
                    html += '<p class="md-help-note">' + NP.escapeHtml(NP.t(block.value)) + '</p>';
                    break;
                case "md-shortcuts":
                    html += '<div class="md-help-category">';
                    html += '<h3 class="md-help-cat-title">' + NP.escapeHtml(NP.t(block.title)) + '</h3>';
                    html += '<div class="md-help-shortcuts">';
                    for (var sr = 0; sr < block.items.length; sr++) {
                        var row2 = block.items[sr];
                        html += '<div class="md-help-shortcut-row">' +
                            '<kbd class="md-help-kbd">' + NP.escapeHtml(row2[0]) + '</kbd>' +
                            '<span>' + NP.escapeHtml(NP.t("help.md.wrapSelection")) +
                            ' <code>' + NP.escapeHtml(NP.t(row2[1])) + '</code></span>' +
                            '</div>';
                    }
                    html += '</div></div>';
                    break;
            }
        }

        return html;
    }

    function copySnippet(text, sourceEl) {
        function done(ok) {
            if (ok) showCopiedFeedback(sourceEl);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                done(true);
            }).catch(function () {
                done(fallbackCopy(text));
            });
            return;
        }
        done(fallbackCopy(text));
    }

    function fallbackCopy(text) {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try {
            ok = document.execCommand("copy");
        } catch (e) {
            console.error("Copy failed:", e);
        }
        document.body.removeChild(ta);
        return ok;
    }

    function showCopiedFeedback(el) {
        if (!el) return;
        var descEl = el.querySelector(".md-help-desc");
        if (!descEl) return;
        if (!el.dataset.origDesc) {
            el.dataset.origDesc = descEl.textContent;
        }
        el.classList.add("md-help-copied");
        descEl.textContent = NP.t("help.copied");

        /* Cancel any pending revert so rapid clicks restart the timer. */
        if (el._revertTimer) clearTimeout(el._revertTimer);
        el._revertTimer = setTimeout(function () {
            el.classList.remove("md-help-copied");
            if (el.dataset.origDesc) descEl.textContent = el.dataset.origDesc;
            el._revertTimer = null;
        }, 1200);
    }

    NP.help = {

        show: function () {
            /* If already open, just focus */
            if (overlayEl) {
                return;
            }

            var wrapper = document.createElement("div");
            wrapper.innerHTML = buildHTML();
            overlayEl = wrapper.firstChild;
            document.body.appendChild(overlayEl);

            var contentEl = document.getElementById("help-content");
            var navItems = overlayEl.querySelectorAll(".help-nav-item");
            var activeIdx = 0;

            function selectSection(idx) {
                activeIdx = idx;
                contentEl.innerHTML = renderSection(idx);
                for (var n = 0; n < navItems.length; n++) {
                    if (n === idx) {
                        navItems[n].style.background = "var(--hover-bg, #0f2314)";
                        navItems[n].style.color = "var(--fg-bright, #4cff7a)";
                    } else {
                        navItems[n].style.background = "transparent";
                        navItems[n].style.color = "var(--fg-dim, #00bf30)";
                    }
                }
            }

            /* Nav click handlers */
            for (var i = 0; i < navItems.length; i++) {
                (function (idx) {
                    navItems[idx].addEventListener("click", function () {
                        selectSection(idx);
                    });
                    navItems[idx].addEventListener("mouseenter", function () {
                        if (idx !== activeIdx) {
                            navItems[idx].style.background = "var(--hover-bg, #0f2314)";
                        }
                    });
                    navItems[idx].addEventListener("mouseleave", function () {
                        if (idx !== activeIdx) {
                            navItems[idx].style.background = "transparent";
                        }
                    });
                })(i);
            }

            /* Delegated click-to-copy for any .md-help-item rendered into
               the content pane. Attached once on contentEl (which is
               stable across selectSection calls). */
            contentEl.addEventListener("click", function (e) {
                var item = e.target.closest && e.target.closest(".md-help-item");
                if (!item) return;
                var snippet = item.getAttribute("data-snippet");
                if (snippet == null) return;
                copySnippet(snippet, item);
            });

            /* Show first section */
            selectSection(0);

            /* Close button */
            var closeBtn = document.getElementById("help-close-btn");
            if (closeBtn) {
                closeBtn.addEventListener("click", function () { NP.help.hide(); });
            }

            /* Click overlay backdrop to close */
            overlayEl.addEventListener("click", function (e) {
                if (e.target === overlayEl) {
                    NP.help.hide();
                }
            });

            /* Escape to close */
            var self = this;
            this._escHandler = function (e) {
                if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    self.hide();
                }
            };
            document.addEventListener("keydown", this._escHandler, true);
        },

        hide: function () {
            if (this._escHandler) {
                document.removeEventListener("keydown", this._escHandler, true);
                this._escHandler = null;
            }
            if (overlayEl && overlayEl.parentNode) {
                overlayEl.parentNode.removeChild(overlayEl);
            }
            overlayEl = null;
        }
    };

})(window.NP);

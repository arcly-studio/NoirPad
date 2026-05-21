/* help.js - Built-in help window (F1) */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var HELP_SECTIONS = [
        {
            title: "P\u0159ehled",
            content: [
                { type: "text", value: "NoirPad je pozn\u00e1mkov\u00e1 aplikace s hackerskou/termin\u00e1lovou estetikou. Zelen\u00fd text na \u010dern\u00e9m pozad\u00ed, monospace font, ASCII efekty." },
                { type: "text", value: "Aplikace podporuje stromovou strukturu slo\u017eek a pozn\u00e1mek, \u0161ifrov\u00e1n\u00ed, export, tagy, t\u00e9mata a dal\u0161\u00ed funkce." }
            ]
        },
        {
            title: "Kl\u00e1vesov\u00e9 zkratky",
            content: [
                { type: "header", value: "Z\u00e1kladn\u00ed zkratky" },
                { type: "shortcuts", value: [
                    ["Ctrl+S", "Ulo\u017eit pozn\u00e1mku"],
                    ["Ctrl+F", "Hled\u00e1n\u00ed v pozn\u00e1mce"],
                    ["Ctrl+B", "Focus mode"],
                    ["Ctrl+L", "P\u0159epnout orientaci str\u00e1nky"],
                    ["Ctrl+I", "Kurz\u00edva"],
                    ["Ctrl+U", "Podtr\u017een\u00ed"],
                    ["Ctrl+Z", "Zp\u011bt (undo)"],
                    ["Ctrl+Y", "Znovu (redo)"],
                    ["Ctrl+V", "Vlo\u017eit (v\u010detn\u011b obr\u00e1zk\u016f)"],
                    ["Ctrl+Shift+P", "Command bar"],
                    ["Ctrl+Tab", "Dal\u0161\u00ed z\u00e1lo\u017eka"],
                    ["Ctrl+Shift+Tab", "P\u0159edchoz\u00ed z\u00e1lo\u017eka"],
                    ["Ctrl+W", "Zav\u0159\u00edt z\u00e1lo\u017eku"]
                ]},
                { type: "header", value: "Funk\u010dn\u00ed kl\u00e1vesy" },
                { type: "shortcuts", value: [
                    ["F1", "N\u00e1pov\u011bda"],
                    ["F2", "P\u0159ejmenovat"],
                    ["F3", "Dal\u0161\u00ed v\u00fdsledek hled\u00e1n\u00ed"],
                    ["Shift+F3", "P\u0159edchoz\u00ed v\u00fdsledek hled\u00e1n\u00ed"],
                    ["F11", "Fullscreen"],
                    ["Delete", "Smazat polo\u017eku"],
                    ["Escape", "Zav\u0159\u00edt overlay"]
                ]}
            ]
        },
        {
            title: "Command bar",
            content: [
                { type: "text", value: "Otev\u0159ete p\u0159\u00edkazov\u00fd \u0159\u00e1dek pomoc\u00ed Ctrl+Shift+P. Zadejte p\u0159\u00edkaz za\u010d\u00ednaj\u00edc\u00ed dvojte\u010dkou." },
                { type: "header", value: "Dostupn\u00e9 p\u0159\u00edkazy" },
                { type: "commands", value: [
                    [":search", "Hledat v pozn\u00e1mk\u00e1ch"],
                    [":new note", "Nov\u00e1 pozn\u00e1mka"],
                    [":new folder", "Nov\u00e1 slo\u017eka"],
                    [":theme", "Zm\u011bnit t\u00e9ma"],
                    [":encrypt", "Za\u0161ifrovat pozn\u00e1mku"],
                    [":decrypt", "De\u0161ifrovat pozn\u00e1mku"],
                    [":fullscreen", "Cel\u00e1 obrazovka"],
                    [":autosave", "Auto ukl\u00e1d\u00e1n\u00ed"],
                    [":export", "Export jako text"],
                    [":exportpdf", "Export jako PDF"],
                    [":exporthtml", "Export jako HTML"],
                    [":focus", "Focus mode"],
                    [":tag", "P\u0159idat tag"],
                    [":tags", "Filtr dle tag\u016f"],
                    [":fontsize", "Velikost p\u00edsma"],
                    [":font", "V\u00fdb\u011br fontu"],
                    [":backup", "Z\u00e1loha dat"],
                    [":import", "Import z\u00e1lohy"],
                    [":fav", "P\u0159epnout obl\u00edben\u00e9"],
                    [":emptytrash", "Vypr\u00e1zdnit ko\u0161"],
                    [":orientation", "Orientace str\u00e1nky"],
                    [":matrix", "Matrix rain efekt"],
                    [":help", "Tato n\u00e1pov\u011bda"]
                ]}
            ]
        },
        {
            title: "Pozn\u00e1mky a slo\u017eky",
            content: [
                { type: "bullets", value: [
                    "Stromov\u00e1 struktura slo\u017eek a pozn\u00e1mek v lev\u00e9m panelu",
                    "P\u0159et\u00e1hn\u011bte polo\u017eky pro p\u0159esunut\u00ed (drag & drop)",
                    "Prav\u00fdm tla\u010d\u00edtkem otev\u0159ete kontextov\u00e9 menu",
                    "F2 pro p\u0159ejmenov\u00e1n\u00ed vybran\u00e9 polo\u017eky",
                    "Delete pro smaz\u00e1n\u00ed (p\u0159esun do ko\u0161e)"
                ]}
            ]
        },
        {
            title: "Editor",
            content: [
                { type: "bullets", value: [
                    "Monospace editor s podporou form\u00e1tov\u00e1n\u00ed",
                    "Kurz\u00edva (Ctrl+I) a podtr\u017een\u00ed (Ctrl+U)",
                    "Undo/Redo stack (Ctrl+Z / Ctrl+Y)",
                    "Ctrl+L p\u0159ep\u00edn\u00e1 orientaci str\u00e1nky (landscape/portrait)"
                ]}
            ]
        },
        {
            title: "\u0160ifrov\u00e1n\u00ed",
            content: [
                { type: "text", value: "Pozn\u00e1mky lze za\u0161ifrovat heslem pomoc\u00ed AES (Fernet). \u0160ifrovan\u00e9 pozn\u00e1mky jsou ozna\u010deny ikonou z\u00e1mku." },
                { type: "bullets", value: [
                    "P\u0159\u00edkaz :encrypt pro za\u0161ifrov\u00e1n\u00ed",
                    "P\u0159\u00edkaz :decrypt pro de\u0161ifrov\u00e1n\u00ed",
                    "Heslo nen\u00ed ukl\u00e1d\u00e1no \u2014 p\u0159i ztr\u00e1t\u011b nelze obnovit"
                ]}
            ]
        },
        {
            title: "Obr\u00e1zky",
            content: [
                { type: "bullets", value: [
                    "Vlo\u017ete obr\u00e1zek p\u0159es Ctrl+V ze schr\u00e1nky",
                    "Obr\u00e1zky se ukl\u00e1daj\u00ed do slo\u017eky images/",
                    "Zoom pomoc\u00ed Ctrl+kole\u010dko my\u0161i"
                ]}
            ]
        },
        {
            title: "Export",
            content: [
                { type: "bullets", value: [
                    ":export \u2014 Export jako prost\u00fd text (.txt)",
                    ":exportpdf \u2014 Export jako PDF (s volitelnou barvou)",
                    ":exporthtml \u2014 Export jako HTML"
                ]}
            ]
        },
        {
            title: "Tagy a obl\u00edben\u00e9",
            content: [
                { type: "bullets", value: [
                    ":tag \u2014 P\u0159idat/odebrat tag pozn\u00e1mce",
                    ":tags \u2014 Filtrovat pozn\u00e1mky dle tagu",
                    ":fav \u2014 P\u0159epnout obl\u00edbenou pozn\u00e1mku",
                    "Obl\u00edben\u00e9 se \u0159ad\u00ed na za\u010d\u00e1tek seznamu"
                ]}
            ]
        },
        {
            title: "T\u00e9mata",
            content: [
                { type: "text", value: "12 barevn\u00fdch t\u00e9mat. Zm\u011b\u0148te p\u0159\u00edkazem :theme." },
                { type: "bullets", value: [
                    "matrix, amber, cyan, red, purple, blue",
                    "pink, white, gold, lime, orange, ice"
                ]}
            ]
        },
        {
            title: "Z\u00e1loha",
            content: [
                { type: "bullets", value: [
                    ":backup \u2014 Exportovat celou datab\u00e1zi jako .zip",
                    ":import \u2014 Importovat z\u00e1lohu ze souboru .zip"
                ]}
            ]
        },
        {
            title: "Efekty",
            content: [
                { type: "bullets", value: [
                    ":matrix \u2014 Zapnout/vypnout Matrix rain animaci",
                    "Splash screen p\u0159i spu\u0161t\u011bn\u00ed s ASCII art logem",
                    "Vlastn\u00ed kruhov\u00fd kurzor s plynul\u00fdm blik\u00e1n\u00edm",
                    "Focus mode (Ctrl+B) \u2014 skryje bo\u010dn\u00ed panel"
                ]}
            ]
        },
        {
            title: "Markdown",
            content: [
                { type: "md-intro", value: "NoirPad supports Markdown formatting. Toggle Markdown mode using the MD button in the top bar (or Ctrl+M). Click any example below to copy it to clipboard." },
                { type: "md-category", title: "Headings", items: [
                    { syntax: "# Heading 1",   snippet: "# Heading 1",   desc: "Largest heading" },
                    { syntax: "## Heading 2",  snippet: "## Heading 2",  desc: "Medium heading" },
                    { syntax: "### Heading 3", snippet: "### Heading 3", desc: "Smallest heading" }
                ]},
                { type: "md-category", title: "Text formatting", items: [
                    { syntax: "**bold text**",     snippet: "**bold text**",     desc: "Bold" },
                    { syntax: "*italic text*",     snippet: "*italic text*",     desc: "Italic" },
                    { syntax: "~~strikethrough~~", snippet: "~~strikethrough~~", desc: "Strikethrough" }
                ]},
                { type: "md-category", title: "Lists", items: [
                    { syntax: "- Item",   snippet: "- Item one\n- Item two\n- Item three", desc: "Unordered list (- or * or +)" },
                    { syntax: "1. Item",  snippet: "1. First\n2. Second\n3. Third",        desc: "Numbered list" }
                ]},
                { type: "md-note", value: "Tip: Press Enter at the end of a list item to continue the list automatically." },
                { type: "md-category", title: "Code", items: [
                    { syntax: "`inline code`",     snippet: "`inline code`",                       desc: "Inline code" },
                    { syntax: "```code block```",  snippet: "```\ncode block\nmultiple lines\n```", desc: "Multi-line code block" }
                ]},
                { type: "md-note", value: "Tip: Backtick (`) on Czech keyboard = AltGr + \u00fd + space" },
                { type: "md-category", title: "Links", items: [
                    { syntax: "[text](url)", snippet: "[Link text](https://example.com)", desc: "Clickable link" }
                ]},
                { type: "md-category", title: "Images", items: [
                    { syntax: "![alt](url)", snippet: "![Image description](/images/example.png)", desc: "Embed image" }
                ]},
                { type: "md-note", value: "Tip: Use +Img button or Ctrl+V to paste images directly. Click any image to view fullscreen, Ctrl+wheel to resize." },
                { type: "md-category", title: "Other", items: [
                    { syntax: "> Quote", snippet: "> Quote text\n> Multiple lines", desc: "Blockquote" }
                ]},
                { type: "md-shortcuts", title: "Keyboard shortcuts (in markdown mode)", items: [
                    ["Ctrl+B", "Wrap selection in <code>**bold**</code>"],
                    ["Ctrl+I", "Wrap selection in <code>*italic*</code>"],
                    ["Ctrl+E", "Wrap selection in <code>`code`</code>"],
                    ["Ctrl+K", "Wrap selection in <code>[link](url)</code>"]
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
                escapeHTML(HELP_SECTIONS[i].title) + '</div>';
        }
        html += '</div>';

        /* Right content */
        html += '<div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">';

        /* Header bar with close button */
        html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;' +
            'border-bottom:1px solid var(--border, #1a2e1a);flex-shrink:0;">';
        html += '<span style="font-size:14px;font-weight:bold;color:var(--fg-bright, #4cff7a);' +
            'text-shadow:0 0 6px var(--glow, #00ff41);">N\u00c1POV\u011aDA</span>';
        html += '<button id="help-close-btn" style="font-size:18px;color:var(--fg-dim, #00bf30);' +
            'cursor:pointer;background:none;border:none;padding:2px 8px;" title="Zav\u0159\u00edt (Esc)">&times;</button>';
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
            'text-shadow:0 0 4px var(--glow, #00ff41);">' + escapeHTML(section.title) + '</h2>';

        for (var i = 0; i < section.content.length; i++) {
            var block = section.content[i];
            switch (block.type) {
                case "text":
                    html += '<p style="margin:0 0 10px 0;">' + escapeHTML(block.value) + '</p>';
                    break;
                case "header":
                    html += '<h3 style="margin:16px 0 8px 0;font-size:13px;color:var(--fg-bright, #4cff7a);">' +
                        escapeHTML(block.value) + '</h3>';
                    break;
                case "bullets":
                    html += '<ul style="margin:0 0 10px 0;padding-left:20px;">';
                    for (var b = 0; b < block.value.length; b++) {
                        html += '<li style="margin:2px 0;color:var(--fg, #00ff41);">' +
                            escapeHTML(block.value[b]) + '</li>';
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
                            escapeHTML(row[0]) + '</td>';
                        html += '<td style="padding:3px 0;color:var(--fg-dim, #00bf30);font-size:12px;' +
                            'border-bottom:1px solid var(--border, #1a2e1a);">' +
                            escapeHTML(row[1]) + '</td>';
                        html += '</tr>';
                    }
                    html += '</table>';
                    break;
                case "md-intro":
                    html += '<p class="help-section-intro">' + escapeHTML(block.value) + '</p>';
                    break;
                case "md-category":
                    html += '<div class="md-help-category">';
                    html += '<h3 class="md-help-cat-title">' + escapeHTML(block.title) + '</h3>';
                    html += '<div class="md-help-grid">';
                    for (var mi = 0; mi < block.items.length; mi++) {
                        var it = block.items[mi];
                        html += '<div class="md-help-item" data-snippet="' + escapeAttr(it.snippet) + '">' +
                            '<code class="md-help-syntax">' + escapeHTML(it.syntax) + '</code>' +
                            '<span class="md-help-desc">' + escapeHTML(it.desc) + '</span>' +
                            '</div>';
                    }
                    html += '</div></div>';
                    break;
                case "md-note":
                    html += '<p class="md-help-note">' + escapeHTML(block.value) + '</p>';
                    break;
                case "md-shortcuts":
                    html += '<div class="md-help-category">';
                    html += '<h3 class="md-help-cat-title">' + escapeHTML(block.title) + '</h3>';
                    html += '<div class="md-help-shortcuts">';
                    for (var sr = 0; sr < block.items.length; sr++) {
                        var row2 = block.items[sr];
                        /* row2[1] is trusted static HTML (contains <code>) so
                           it's inserted verbatim, unlike user-derived content. */
                        html += '<div class="md-help-shortcut-row">' +
                            '<kbd class="md-help-kbd">' + escapeHTML(row2[0]) + '</kbd>' +
                            '<span>' + row2[1] + '</span>' +
                            '</div>';
                    }
                    html += '</div></div>';
                    break;
            }
        }

        return html;
    }

    function escapeHTML(str) {
        var div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    /* HTML attribute escaping — escapeHTML leaves quotes intact, which is
       unsafe inside data-snippet="…". Also encodes newlines so multi-line
       snippets survive the attribute round-trip. */
    function escapeAttr(s) {
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\n/g, "&#10;");
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
        descEl.textContent = "Copied!";

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

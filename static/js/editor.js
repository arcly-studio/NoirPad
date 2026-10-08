/* editor.js - NoirPad rich text editor */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* Marker grammar:
         <<IMG:filename>>              — plain image
         <<IMG:filename|w=NNN>>        — image with persisted zoom width
       The width capture is optional (Ctrl+wheel zoom feature). */
    var IMG_MARKER_RE = /<<IMG:([^|>]+)(?:\|w=(\d+))?>>/g;

    function findItemById(tree, id) {
        for (var i = 0; i < tree.length; i++) {
            if (tree[i].id === id) return tree[i];
            if (tree[i].children) {
                var found = findItemById(tree[i].children, id);
                if (found) return found;
            }
        }
        return null;
    }

    function countAllItems(tree, type) {
        var count = 0;
        for (var i = 0; i < tree.length; i++) {
            if (!type || tree[i].type === type) count++;
            if (tree[i].children) count += countAllItems(tree[i].children, type);
        }
        return count;
    }

    NP.editor = {
        el: null,
        _autosaveTimer: null,
        _currentNoteId: null,
        /* Whether the note currently loaded in the editor is stored
           encrypted on the server. Derived from the FRESHLY fetched
           content in loadNote (NP.state.data is only refreshed by the
           5s poll, so it can't be trusted right after encrypt/decrypt).
           Combined with _encryptedNotePassword this gives the 3 lock
           states: plain / encrypted+unlocked / encrypted+locked. */
        _currentNoteEncrypted: false,

        /* Re-sync the #btn-lock label/title with the current note's
           lock state. Safe to call before encryption.js is wired. */
        _refreshLockButton: function () {
            if (NP.encryption && NP.encryption.updateLockButtonState) {
                NP.encryption.updateLockButtonState();
            }
        },

        init: function () {
            NP.editor.el = NP.$("#editor");
            if (!NP.editor.el) return;

            /* Input event for char count */
            NP.editor.el.addEventListener("input", NP.debounce(function () {
                NP.editor.updateCharCount();
            }, 300));

            /* Glitch typing — fires CSS RGB-shift on rapid input */
            NP.editor.el.addEventListener("input", function () {
                if (NP.effects && NP.effects.onEditorInput) NP.effects.onEditorInput();
            });

            /* MD textarea: dirty-flag + per-keystroke autosave debounce.
               The 30s interval autosave was the only safety net; if the
               user typed and closed the tab within that window, the
               textarea contents never reached the backend. */
            var ta = document.getElementById("editor-md");
            if (ta) {
                ta.addEventListener("input", NP.debounce(function () {
                    if (NP.markdown && NP.markdown.isActive &&
                        NP.markdown.isActive()) {
                        NP.editor.save(true);
                    }
                }, 800));
            }

            /* Flush the in-flight note on tab close / navigation.
               pagehide fires reliably on mobile + desktop; the
               sendBeacon path keeps the request alive after unload. */
            window.addEventListener("pagehide", function () {
                NP.editor._flushBeacon();
            });
            /* visibilitychange → hidden also catches mobile background
               switches where pagehide may be delayed. */
            document.addEventListener("visibilitychange", function () {
                if (document.visibilityState === "hidden") {
                    NP.editor._flushBeacon();
                }
            });

            /* Keyboard shortcuts (Ctrl+S/I/U) are handled globally in app.js;
               attaching them here too caused double-fire (save twice, format toggled twice). */

            /* Paste-to-upload is handled in images.js. */
        },

        /* Best-effort persist on unload. Skips encrypted notes — the
           re-encryption path requires async crypto + a password we may
           not have, and a botched save would corrupt the file.

           Uses fetch(..., {keepalive:true}) instead of sendBeacon
           because the backend's save endpoint is PUT /api/note/{id};
           sendBeacon is hardcoded to POST in the spec and would 405.
           keepalive is the modern equivalent (Chrome 66+, FF 116+,
           Safari 13+) — same ~64KB body limit, but any HTTP method. */
        _flushBeacon: function () {
            var id = NP.editor._currentNoteId;
            if (!id) return;
            if (NP.editor._encryptedNotePassword) return;
            var mdActive = NP.markdown && NP.markdown.isActive &&
                NP.markdown.isActive();
            var text;
            var formats;
            if (mdActive) {
                text = NP.markdown.getRawText();
                formats = [];
            } else {
                if (!NP.editor.el || NP.editor.el.contentEditable !== "true") {
                    return;
                }
                text = NP.editor._htmlToTextWithImages().text;
                formats = NP.editor._extractFormats();
            }
            try {
                var body = JSON.stringify({
                    content: text, formats: formats
                });
                fetch("/api/note/" + encodeURIComponent(id), {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: body,
                    keepalive: true
                }).catch(function () {
                    /* unload — request may or may not have left;
                       nothing to do either way. */
                });
            } catch (e) { /* unload — nothing we can do */ }
        },

        /* ---- Note loading ---- */

        loadNote: function (id) {
            /* Stop the previous note's autosave FIRST. Without this,
               a timer fire after _currentNoteId is reassigned but
               before the fetch resolves would save the previous
               note's textarea content under the NEW note's id. */
            NP.editor.stopAutosave();

            NP.editor._currentNoteId = id;
            NP.state.currentNoteId = id;

            /* Sidebar highlight follows whichever note is open,
               regardless of how it was opened (tree click, tab,
               +Note, command bar). Single funnel here keeps the
               selection in sync without sprinkling calls into
               every caller. */
            if (NP.tree && NP.tree.setSelected) {
                NP.tree.setSelected(id);
            }

            /* Set title from tree data */
            var titleInput = NP.$("#note-title-input");
            if (titleInput) {
                var item = NP.editor._findItemInTree(NP.state.data.tree, id);
                titleInput.value = item ? item.name : "";
                titleInput.readOnly = false;
            }

            return NP.api.getNote(id).then(function (data) {
                if (!NP.editor.el) return;

                var content = data.content || "";
                var formats = data.formats || [];

                /* Mirror the server's mode into state so toggles + the MD
                   button stay in sync without a separate fetch. */
                if (data.mode !== undefined &&
                    NP.state && NP.state.data) {
                    NP.state.data.note_modes = NP.state.data.note_modes || {};
                    if (data.mode === "markdown") {
                        NP.state.data.note_modes[id] = "markdown";
                    } else {
                        delete NP.state.data.note_modes[id];
                    }
                }

                /* Check if note is encrypted */
                var isEncrypted = false;
                try {
                    var parsed = JSON.parse(content);
                    if (parsed && parsed.encrypted && parsed.data) {
                        isEncrypted = true;
                    }
                } catch (e) { /* not JSON, not encrypted */ }

                NP.editor._currentNoteEncrypted = isEncrypted;

                if (isEncrypted) {
                    NP.editor.stopAutosave();
                    NP.editor._encryptedNotePassword = null;
                    /* Prompt for password immediately */
                    var password = prompt("🔒 Enter password to unlock this note:");
                    if (!password) {
                        /* User cancelled — show lock screen (STATE C) */
                        NP.editor._showLockScreen();
                        NP.editor._refreshLockButton();
                        return;
                    }
                    /* Decrypt for viewing only (file stays encrypted) */
                    return NP.api.decryptView(id, password).then(function (decData) {
                        if (!NP.editor.el) return;
                        /* Store password for re-encryption on save */
                        NP.editor._encryptedNotePassword = password;

                        var decContent = decData.content || "";
                        var decFormats = decData.formats || [];

                        NP.editor.el.contentEditable = "true";
                        NP.editor.el.style.opacity = "1";
                        NP.editor.renderContent(NP.editor.el, decContent, decFormats);
                        NP.editor.el.focus();
                        NP.editor.updateCharCount();
                        NP.editor.startAutosave();
                        if (NP.tags && NP.tags.render) NP.tags.render();
                        /* STATE B: encrypted + unlocked */
                        NP.editor._refreshLockButton();
                        if (NP.markdown && NP.markdown.applyForLoadedNote) {
                            NP.markdown.applyForLoadedNote(id, decContent);
                        }
                    }).catch(function (err) {
                        alert("Wrong password.");
                        NP.editor._showLockScreen();
                        /* STATE C: encrypted + locked */
                        NP.editor._refreshLockButton();
                    });
                }

                NP.editor._encryptedNotePassword = null;
                NP.editor.el.contentEditable = "true";
                NP.editor.el.style.opacity = "1";

                NP.editor.renderContent(NP.editor.el, content, formats);
                NP.editor.el.focus();
                NP.editor.updateCharCount();
                NP.editor.startAutosave();

                /* Update tags if available */
                if (NP.tags && NP.tags.render) NP.tags.render();

                /* STATE A: plain note */
                NP.editor._refreshLockButton();
                if (NP.markdown && NP.markdown.applyForLoadedNote) {
                    NP.markdown.applyForLoadedNote(id, content);
                }
            }).catch(function (err) {
                console.error("loadNote error:", err);
                if (NP.editor.el) {
                    NP.editor.el.innerHTML =
                        "<p style='color:var(--fg-dim);'>Error loading note: " +
                        NP.escapeHtml(err.message) + "</p>";
                }
            });
        },

        _showLockScreen: function () {
            if (!NP.editor.el) return;
            NP.editor.el.contentEditable = "false";
            NP.editor.el.innerHTML =
                "<div style='text-align:center;padding:80px 20px;'>" +
                "<div style='font-size:48px;margin-bottom:16px;'>&#x1F512;</div>" +
                "<div style='font-size:16px;color:var(--fg);margin-bottom:8px;'>This note is encrypted</div>" +
                "<div style='font-size:12px;color:var(--fg-dim);'>Click on the note again to enter password</div>" +
                "</div>";
            NP.editor.updateCharCount();
        },

        _findItemInTree: function (tree, id) {
            if (!tree) return null;
            for (var i = 0; i < tree.length; i++) {
                if (tree[i].id === id) return tree[i];
                if (tree[i].children) {
                    var found = NP.editor._findItemInTree(tree[i].children, id);
                    if (found) return found;
                }
            }
            return null;
        },

        showWelcome: function () {
            if (!NP.editor.el) return;

            NP.editor.stopAutosave();
            NP.editor._currentNoteId = null;
            NP.editor._encryptedNotePassword = null;
            NP.editor._currentNoteEncrypted = false;
            NP.editor.el.contentEditable = "false";
            NP.editor._refreshLockButton();

            var html = "";
            html += "<style>";
            html += "@keyframes welcome-fade-in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }";
            html += "@keyframes welcome-line-grow { from { width: 0; } to { width: 60px; } }";
            html += "@keyframes welcome-dot-pulse { 0%, 100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 1; transform: scale(1.5); } }";
            html += "@keyframes welcome-hint-fade { from { opacity: 0; } to { opacity: 0.4; } }";
            html += ".welcome-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; width: 100%; max-width: 100%; box-sizing: border-box; overflow: hidden; padding: clamp(12px, 4vw, 20px); user-select: none; position: absolute; top: 0; left: 0; right: 0; bottom: 0; }";
            html += ".welcome-logo { font-family: var(--font-display); font-size: clamp(40px, 18vw, 140px); font-weight: 900; letter-spacing: 0px; color: var(--accent); text-shadow: none; filter: none; -webkit-text-stroke: 0; animation: welcome-fade-in 0.8s ease-out; margin: 0; max-width: 100%; box-sizing: border-box; padding: 0 clamp(8px, 3vw, 16px); line-height: 1.1; text-align: center; word-break: break-word; overflow-wrap: break-word; }";
            html += ".welcome-divider { display: flex; align-items: center; gap: 12px; margin: 16px 0 20px 0; max-width: 100%; animation: welcome-fade-in 1s ease-out 0.3s both; }";
            html += ".welcome-line { height: 1px; background: linear-gradient(90deg, transparent, var(--fg-dim), transparent); animation: welcome-line-grow 1s ease-out 0.5s both; }";
            html += ".welcome-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: welcome-dot-pulse 3s ease-in-out infinite; box-shadow: 0 0 8px var(--glow); }";
            html += ".welcome-sub { font-family: var(--font-display); font-weight: 500; font-size: clamp(11px, 3.5vw, 13px); letter-spacing: clamp(2px, 1.2vw, 6px); text-transform: uppercase; color: var(--fg-dim); margin: 0; max-width: 100%; box-sizing: border-box; padding: 0 clamp(8px, 3vw, 16px); text-align: center; word-break: break-word; overflow-wrap: break-word; animation: welcome-fade-in 1s ease-out 0.5s both; }";
            html += ".welcome-version { font-family: var(--font-mono); font-size: clamp(10px, 2.5vw, 11px); color: var(--border); margin-top: 40px; letter-spacing: clamp(1px, 0.6vw, 2px); max-width: 100%; text-align: center; animation: welcome-fade-in 1s ease-out 0.8s both; }";
            html += ".welcome-hint { font-size: clamp(10px, 3vw, 12px); color: var(--fg-dim); margin-top: 12px; opacity: 0; max-width: 100%; box-sizing: border-box; padding: 0 clamp(8px, 3vw, 16px); text-align: center; line-height: 1.5; word-break: break-word; overflow-wrap: break-word; animation: welcome-hint-fade 1s ease-out 1.5s forwards; }";
            html += ".welcome-hint kbd { display: inline-block; padding: 2px 7px; border: 1px solid var(--border); border-radius: 3px; font-size: 10px; color: var(--fg); background: var(--bg-light); margin: 0 2px; }";
            html += "</style>";

            html += "<div class='welcome-wrap'>";

            /* Logo */
            html += "<h1 class='welcome-logo'>NoirPad</h1>";

            /* Decorative divider */
            html += "<div class='welcome-divider'>";
            html += "<div class='welcome-line'></div>";
            html += "<div class='welcome-line'></div>";
            html += "</div>";

            /* Subtitle */
            html += "<p class='welcome-sub'>Your dark notebook</p>";

            /* Version */
            html += "<p class='welcome-version'>v2.0 — web edition</p>";

            /* Hint */
            html += "<p class='welcome-hint'>Select a note to begin or press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> for commands</p>";

            html += "</div>";

            NP.editor.el.innerHTML = html;
            NP.editor.updateCharCount();
        },

        showOverview: function (item) {
            if (!NP.editor.el) return;

            NP.editor.stopAutosave();
            NP.editor._currentNoteId = null;
            NP.editor._encryptedNotePassword = null;
            NP.editor._currentNoteEncrypted = false;
            NP.editor.el.contentEditable = "false";
            NP.editor._refreshLockButton();

            var childCount = item.children ? item.children.length : 0;
            var totalCount = countAllItems(item.children || [], null);

            var html = "";
            html += "<div style='padding:40px;max-width:600px;margin:0 auto;'>";
            html += "<h2 style='color:var(--fg-bright);margin:0 0 8px 0;'>&#128193; " + NP.escapeHtml(item.name) + "</h2>";
            html += "<p style='color:var(--fg-dim);margin:0 0 24px 0;'>" + childCount + " direct items, " + totalCount + " total</p>";

            if (item.children && item.children.length > 0) {
                html += "<div>";
                for (var i = 0; i < item.children.length; i++) {
                    var child = item.children[i];
                    var icon = child.type === "folder" ? "&#128193;" : "\u25c6";
                    var color = child.type === "folder" ? "var(--fg-bright)" : "var(--fg-dim)";
                    html += "<div style='padding:4px 0;color:" + color + ";'>" + icon + " " + NP.escapeHtml(child.name) + "</div>";
                }
                html += "</div>";
            }

            html += "</div>";
            NP.editor.el.innerHTML = html;
        },

        /* ---- Content conversion ---- */

        /* Render stored note content (rich-text mode) into *el*. */
        renderContent: function (el, text, formats) {
            el.innerHTML = NP.editor._textToHtmlWithImages(text, formats);
        },

        contentToHtml: function (text, formats) {
            if (!text) return "";
            var html = NP.editor._applyFormats(text, formats);
            return html;
        },

        htmlToContent: function () {
            if (!NP.editor.el) return { text: "", formats: [] };

            var result = NP.editor._htmlToTextWithImages();
            var text = result.text;
            var formats = NP.editor._extractFormats();

            return { text: text, formats: formats };
        },

        _applyFormats: function (text, formats) {
            if (!formats || formats.length === 0) {
                return NP.escapeHtml(text).replace(/\n/g, "<br>");
            }

            /* Convert format ranges to offset-based marks */
            var marks = [];
            for (var i = 0; i < formats.length; i++) {
                var fmt = formats[i];
                var start, end;
                if (typeof fmt.start === "string" && fmt.start.indexOf(".") !== -1) {
                    start = NP.lineColToOffset(text, fmt.start);
                    end = NP.lineColToOffset(text, fmt.end);
                } else {
                    start = fmt.start;
                    end = fmt.end;
                }
                marks.push({ start: start, end: end, fmt: fmt });
            }

            /* Sort by start position */
            marks.sort(function (a, b) { return a.start - b.start; });

            /* Build HTML by walking through text */
            var html = "";
            var pos = 0;

            for (var m = 0; m < marks.length; m++) {
                var mark = marks[m];
                /* Text before this mark */
                if (mark.start > pos) {
                    html += NP.escapeHtml(text.substring(pos, mark.start)).replace(/\n/g, "<br>");
                }

                /* Formatted text */
                var styledText = NP.escapeHtml(text.substring(mark.start, mark.end)).replace(/\n/g, "<br>");
                var styleAttr = "";
                var tags = { open: "", close: "" };

                if (mark.fmt.style === "italic" || mark.fmt.italic) {
                    tags.open += "<em>";
                    tags.close = "</em>" + tags.close;
                }
                if (mark.fmt.style === "underline" || mark.fmt.underline) {
                    tags.open += "<u>";
                    tags.close = "</u>" + tags.close;
                }
                if (mark.fmt.font) {
                    styleAttr += "font-family:" + mark.fmt.font + ";";
                }
                if (mark.fmt.size) {
                    styleAttr += "font-size:" + mark.fmt.size + "px;";
                }
                if (mark.fmt.color) {
                    styleAttr += "color:" + mark.fmt.color + ";";
                }

                if (styleAttr) {
                    html += "<span style='" + styleAttr + "'>" + tags.open + styledText + tags.close + "</span>";
                } else if (tags.open) {
                    html += tags.open + styledText + tags.close;
                } else {
                    html += styledText;
                }

                pos = mark.end;
            }

            /* Remaining text */
            if (pos < text.length) {
                html += NP.escapeHtml(text.substring(pos)).replace(/\n/g, "<br>");
            }

            return html;
        },

        _extractFormats: function () {
            if (!NP.editor.el) return [];

            var formats = [];
            var offset = 0;
            var fullText = "";

            function walkNode(node) {
                if (node.nodeType === 3) {
                    /* Text node */
                    fullText += node.textContent;
                    offset += node.textContent.length;
                } else if (node.nodeName === "BR") {
                    fullText += "\n";
                    offset += 1;
                } else if (node.nodeName === "IMG") {
                    var fname = node.getAttribute("data-filename") || "";
                    if (!fname && node.src) {
                        var parts = node.src.split("/");
                        fname = parts[parts.length - 1];
                    }
                    var marker = "<<IMG:" + fname + NP.editor._imgWidthSuffix(node) + ">>";
                    fullText += marker;
                    offset += marker.length;
                } else if (node.nodeName === "PRE" && node.classList && node.classList.contains("np-code")) {
                    /* Code blocks contribute their raw ```lang\n...\n``` form to the
                       text stream but never produce format spans. */
                    var rawCode = node.getAttribute("data-code");
                    if (rawCode !== null && rawCode !== undefined) {
                        try { rawCode = decodeURIComponent(rawCode); }
                        catch (e) { rawCode = node.textContent || ""; }
                    } else {
                        rawCode = node.textContent || "";
                    }
                    var codeLang = node.getAttribute("data-lang") || "";
                    var codeMarker = "```" + codeLang + "\n" + rawCode + "\n```";
                    fullText += codeMarker;
                    offset += codeMarker.length;
                } else if (node.nodeType === 1) {
                    /* Element node */
                    var startOff = offset;
                    var children = node.childNodes;
                    for (var i = 0; i < children.length; i++) {
                        walkNode(children[i]);
                    }
                    var endOff = offset;

                    if (endOff > startOff) {
                        var fmt = {};
                        var hasFormat = false;

                        var tag = node.nodeName;
                        if (tag === "EM" || tag === "I") {
                            fmt.italic = true;
                            hasFormat = true;
                        }
                        if (tag === "U") {
                            fmt.underline = true;
                            hasFormat = true;
                        }
                        if (tag === "SPAN" || tag === "DIV" || tag === "P") {
                            var style = node.style;
                            if (style.fontFamily) {
                                fmt.font = style.fontFamily.replace(/['"]/g, "");
                                hasFormat = true;
                            }
                            if (style.fontSize) {
                                fmt.size = parseInt(style.fontSize, 10);
                                hasFormat = true;
                            }
                            if (style.color) {
                                fmt.color = style.color;
                                hasFormat = true;
                            }
                            if (style.fontStyle === "italic") {
                                fmt.italic = true;
                                hasFormat = true;
                            }
                            if (style.textDecoration && style.textDecoration.indexOf("underline") !== -1) {
                                fmt.underline = true;
                                hasFormat = true;
                            }
                        }

                        if (hasFormat) {
                            fmt.start = NP.offsetToLineCol(fullText, startOff);
                            fmt.end = NP.offsetToLineCol(fullText, endOff);
                            formats.push(fmt);
                        }
                    }

                    /* Handle block elements adding newlines */
                    if ((tag === "DIV" || tag === "P") && endOff > startOff) {
                        /* Check if the next sibling exists, add newline separation */
                        if (node.nextSibling) {
                            fullText += "\n";
                            offset += 1;
                        }
                    }
                }
            }

            var children = NP.editor.el.childNodes;
            for (var i = 0; i < children.length; i++) {
                walkNode(children[i]);
            }

            return formats;
        },

        /* ---- Images ---- */

        _imgWidthSuffix: function (node) {
            var w = node.getAttribute("data-w");
            if (!w && node.style && node.style.width) {
                var parsed = parseInt(node.style.width, 10);
                if (parsed) w = String(parsed);
            }
            return w ? "|w=" + w : "";
        },

        _textToHtmlWithImages: function (text, formats) {
            if (!text) return "";

            /*
             * Step 1: Extract triple-backtick code blocks to placeholders so
             * format/image rendering can't touch their content.
             */
            var codeBlocks = [];
            var codeRe = /```([^\n`]*)\n([\s\S]*?)```/g;
            var processed = text.replace(codeRe, function (full, lang, code) {
                var idx = codeBlocks.length;
                codeBlocks.push({ lang: lang.trim(), code: code });
                return "\u0000CODE" + idx + "\u0000";
            });

            /* Step 2: IMG split + format application on processed text.
               Regex has 2 capture groups (filename, optional width), so
               split yields tuples of (text, fname, width, text, fname, …). */
            var parts = processed.split(IMG_MARKER_RE);
            var html;
            if (parts.length === 1) {
                html = NP.editor._applyFormats(processed, formats);
            } else {
                html = "";
                for (var i = 0; i < parts.length; i += 3) {
                    if (parts[i]) html += NP.editor._applyFormats(parts[i], formats);
                    if (i + 1 < parts.length) {
                        var filename = parts[i + 1];
                        var width = parts[i + 2];
                        var widthStyle = "";
                        var widthAttr = "";
                        if (width) {
                            widthStyle = "width:" + width + "px;max-width:" + width + "px;";
                            widthAttr = " data-w='" + NP.escapeHtml(width) + "'";
                        } else {
                            widthStyle = "max-width:100%;";
                        }
                        html += "<img src='/images/" + NP.escapeHtml(filename) +
                            "' data-filename='" + NP.escapeHtml(filename) + "'" +
                            widthAttr +
                            " style='" + widthStyle + "display:block;margin:8px 0;'>";
                    }
                }
            }

            /* Step 3: swap placeholders for code-block HTML */
            html = html.replace(/\u0000CODE(\d+)\u0000/g, function (_, idx) {
                var blk = codeBlocks[parseInt(idx, 10)];
                return NP.editor._renderCodeBlock(blk.code, blk.lang);
            });

            return html;
        },

        _renderCodeBlock: function (code, lang) {
            var langSafe = (lang || "").replace(/[^a-zA-Z0-9_+\-]/g, "");
            var dataCode = encodeURIComponent(code);
            var inner = "";
            if (langSafe) {
                inner += "<span class='tok-lang'>" + NP.escapeHtml(langSafe) + "</span>";
            }
            inner += NP.editor._highlightCode(code);
            return "<pre class='np-code' contenteditable='false'" +
                " data-code='" + dataCode + "'" +
                " data-lang='" + NP.escapeHtml(langSafe) + "'>" +
                inner + "</pre>";
        },

        _highlightCode: function (code) {
            var KW = {
                "function": 1, "def": 1, "return": 1, "if": 1, "else": 1, "elif": 1,
                "for": 1, "while": 1, "do": 1, "switch": 1, "case": 1, "break": 1,
                "continue": 1, "default": 1, "var": 1, "let": 1, "const": 1,
                "class": 1, "import": 1, "from": 1, "as": 1, "export": 1, "new": 1,
                "null": 1, "None": 1, "true": 1, "false": 1, "True": 1, "False": 1,
                "async": 1, "await": 1, "yield": 1, "try": 1, "catch": 1, "except": 1,
                "finally": 1, "throw": 1, "raise": 1, "in": 1, "of": 1, "is": 1,
                "not": 1, "and": 1, "or": 1, "with": 1, "this": 1, "self": 1,
                "struct": 1, "func": 1, "package": 1, "interface": 1, "type": 1,
                "public": 1, "private": 1, "protected": 1, "static": 1, "void": 1,
                "int": 1, "float": 1, "string": 1, "bool": 1, "lambda": 1,
                "pass": 1, "global": 1, "nonlocal": 1
            };

            var n = code.length;
            var i = 0;
            var out = "";
            var IDENT = /[A-Za-z0-9_]/;
            var IDENT_START = /[A-Za-z_]/;

            function tok(type, text) {
                return "<span class='tok-" + type + "'>" + NP.escapeHtml(text) + "</span>";
            }

            while (i < n) {
                var ch = code.charAt(i);
                var ch2 = code.substr(i, 2);

                /* Block comment */
                if (ch2 === "/*") {
                    var end = code.indexOf("*/", i + 2);
                    if (end === -1) end = n; else end += 2;
                    out += tok("com", code.substring(i, end));
                    i = end;
                    continue;
                }
                /* Line comment (// or #) */
                if (ch2 === "//" || ch === "#") {
                    var nl = code.indexOf("\n", i);
                    if (nl === -1) nl = n;
                    out += tok("com", code.substring(i, nl));
                    i = nl;
                    continue;
                }
                /* String literals */
                if (ch === '"' || ch === "'" || ch === "`") {
                    var quote = ch;
                    var j = i + 1;
                    while (j < n && code.charAt(j) !== quote) {
                        if (code.charAt(j) === "\\") j += 2;
                        else j++;
                    }
                    if (j < n) j++;
                    out += tok("str", code.substring(i, j));
                    i = j;
                    continue;
                }
                /* Numbers */
                if (ch >= "0" && ch <= "9") {
                    var k = i;
                    while (k < n && /[0-9.]/.test(code.charAt(k))) k++;
                    out += tok("num", code.substring(i, k));
                    i = k;
                    continue;
                }
                /* Identifier / keyword */
                if (IDENT_START.test(ch)) {
                    var w = i;
                    while (w < n && IDENT.test(code.charAt(w))) w++;
                    var word = code.substring(i, w);
                    if (KW[word]) out += tok("kw", word);
                    else out += NP.escapeHtml(word);
                    i = w;
                    continue;
                }
                /* Anything else: plain */
                out += NP.escapeHtml(ch);
                i++;
            }
            return out;
        },

        _htmlToTextWithImages: function () {
            if (!NP.editor.el) return { text: "" };

            var text = "";

            function walkNode(node) {
                if (node.nodeType === 3) {
                    text += node.textContent;
                } else if (node.nodeName === "BR") {
                    text += "\n";
                } else if (node.nodeName === "IMG") {
                    var fname = node.getAttribute("data-filename") || "";
                    if (!fname && node.src) {
                        var parts = node.src.split("/");
                        fname = parts[parts.length - 1];
                    }
                    text += "<<IMG:" + fname + NP.editor._imgWidthSuffix(node) + ">>";
                } else if (node.nodeName === "PRE" && node.classList && node.classList.contains("np-code")) {
                    /* Round-trip code block back to ```lang\n...\n``` form */
                    var raw = node.getAttribute("data-code");
                    if (raw !== null && raw !== undefined) {
                        try { raw = decodeURIComponent(raw); }
                        catch (e) { raw = node.textContent || ""; }
                    } else {
                        raw = node.textContent || "";
                    }
                    var lang = node.getAttribute("data-lang") || "";
                    text += "```" + lang + "\n" + raw + "\n```";
                } else if (node.nodeType === 1) {
                    var children = node.childNodes;
                    for (var i = 0; i < children.length; i++) {
                        walkNode(children[i]);
                    }
                    var tag = node.nodeName;
                    if ((tag === "DIV" || tag === "P") && node.nextSibling) {
                        text += "\n";
                    }
                }
            }

            var children = NP.editor.el.childNodes;
            for (var i = 0; i < children.length; i++) {
                walkNode(children[i]);
            }

            return { text: text };
        },

        /* ---- Formatting commands ---- */

        toggleItalic: function () {
            document.execCommand("italic", false, null);
        },

        toggleUnderline: function () {
            document.execCommand("underline", false, null);
        },

        /* ---- Save ---- */

        save: function (silent) {
            var id = NP.editor._currentNoteId;
            if (!id || !NP.editor.el) {
                return Promise.resolve();
            }

            /* Markdown mode: textarea is the source of truth. Skip
               the rich-text walker entirely — its output would be
               whatever HTML the hidden #editor still holds (stale or
               empty), not the user's actual markdown. */
            var mdActive = NP.markdown && NP.markdown.isActive &&
                NP.markdown.isActive();
            var text;
            var formats;
            if (mdActive) {
                text = NP.markdown.getRawText();
                formats = [];
            } else {
                if (NP.editor.el.contentEditable !== "true") {
                    return Promise.resolve();
                }
                text = NP.editor._htmlToTextWithImages().text;
                formats = NP.editor._extractFormats();
            }

            var savePromise;
            if (NP.editor._encryptedNotePassword) {
                /* Note is encrypted — re-encrypt on save */
                savePromise = NP.api.saveEncrypted(id, NP.editor._encryptedNotePassword, text, formats);
            } else {
                savePromise = NP.api.saveNote(id, text, formats);
            }

            return savePromise.then(function () {
                if (!silent) {
                    NP.editor._showSaveFlash();
                }
            }).catch(function (err) {
                console.error("Save failed:", err);
            });
        },

        _showSaveFlash: function () {
            var wrap = document.getElementById("editor-wrapper");
            if (!wrap) return;
            wrap.classList.remove("saved-pulse");
            /* Force reflow so the animation restarts on rapid saves */
            void wrap.offsetWidth;
            wrap.classList.add("saved-pulse");
            setTimeout(function () {
                wrap.classList.remove("saved-pulse");
            }, 650);
        },

        /* ---- Character count ---- */

        updateCharCount: function () {
            var charEl = NP.$("#char-count");
            var wordEl = NP.$("#word-count");
            var lineEl = NP.$("#line-count");

            if (!NP.editor.el || NP.editor.el.contentEditable !== "true") {
                if (charEl) charEl.textContent = "0 chars";
                if (wordEl) wordEl.textContent = "0 words";
                if (lineEl) lineEl.textContent = "0 lines";
                return;
            }

            var result = NP.editor._htmlToTextWithImages();
            var text = result.text;
            var chars = text.length;
            var words = text.trim() ? text.trim().split(/\s+/).length : 0;
            var lines = text.split("\n").length;

            if (charEl) charEl.textContent = chars + " chars";
            if (wordEl) wordEl.textContent = words + " words";
            if (lineEl) lineEl.textContent = lines + " lines";
        },

        /* ---- Auto-save ---- */

        startAutosave: function () {
            NP.editor.stopAutosave();
            NP.editor._autosaveTimer = setInterval(function () {
                NP.editor.save(true);
            }, 30000);
        },

        stopAutosave: function () {
            if (NP.editor._autosaveTimer) {
                clearInterval(NP.editor._autosaveTimer);
                NP.editor._autosaveTimer = null;
            }
        }
    };

})(window.NP);

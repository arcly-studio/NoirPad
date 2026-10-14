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
        /* id + text + formats of the last successful save: a silent save
           of an unchanged note is skipped (no file write, no new data
           version for other windows to reload). */
        _lastSavedKey: null,
        _currentNoteId: null,
        /* Whether the note currently loaded in the editor is stored
           encrypted on the server. Derived from the FRESHLY fetched
           content in loadNote (NP.state.data is only refreshed by the
           5s poll, so it can't be trusted right after encrypt/decrypt).
           Combined with _unlockToken this gives the 3 lock
           states: plain / encrypted+unlocked / encrypted+locked. */
        _currentNoteEncrypted: false,

        /* Unlock token of the open encrypted note (see encryption.js).
           The password itself is never kept in the page. */
        _unlockToken: null,
        _lastSave: null,

        /* Leaving an unlocked note: tell the server to forget its key —
           after the last save, so the save doesn't race the lock. */
        _forgetUnlock: function () {
            var token = NP.editor._unlockToken;
            if (!token) return;
            NP.editor._unlockToken = null;
            Promise.resolve(NP.editor._lastSave).catch(function () {}).then(function () {
                return NP.api.lock(token);
            }).catch(function () { /* key expires on its own */ });
        },

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

            /* Save shortly after typing stops, like the Markdown textarea
               below. The unload flush (keepalive) cannot carry more than
               64 kB, so a long note must not wait for it (K5). */
            NP.editor.el.addEventListener("input", NP.debounce(function () {
                NP.editor.save(true);
            }, 1000));

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
               pagehide fires reliably on mobile + desktop; keepalive
               keeps the request alive after unload. Leaving the page
               also makes the server forget an unlocked note's key. */
            window.addEventListener("pagehide", function () {
                NP.editor._flushBeacon(true);
            });
            /* visibilitychange → hidden also catches mobile background
               switches where pagehide may be delayed. */
            document.addEventListener("visibilitychange", function () {
                if (document.visibilityState === "hidden") {
                    NP.editor._flushBeacon(false);
                }
            });

            /* Keyboard shortcuts (Ctrl+S/I/U) are handled globally in app.js;
               attaching them here too caused double-fire (save twice, format toggled twice). */

            /* Paste-to-upload is handled in images.js. */
        },

        /* Best-effort persist on unload. An unlocked encrypted note is
           saved with its unlock token (lock_after when the page is going
           away); a locked one is never written.

           Uses fetch(..., {keepalive:true}) instead of sendBeacon
           because sendBeacon can't send the API headers and is POST-only.
           keepalive has the same ~64KB body limit. */
        _flushBeacon: function (leaving) {
            var id = NP.editor._currentNoteId;
            if (!id || NP.editor._loadedNoteId !== id) return;
            var token = NP.editor._unlockToken;
            if (NP.editor._currentNoteEncrypted && !token) return;
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
                var url = "/api/note/" + encodeURIComponent(id);
                var method = "PUT";
                var payload = { content: text, formats: formats };
                if (NP.editor._currentNoteEncrypted) {
                    url = "/api/save-encrypted";
                    method = "POST";
                    payload = { id: id, unlock_token: token, content: text,
                        formats: formats, lock_after: !!leaving };
                    if (leaving) NP.editor._unlockToken = null;
                }
                NP.api.fetch(url, {
                    method: method,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                    keepalive: true
                }).catch(function () {
                    /* unload — request may or may not have left;
                       nothing to do either way. */
                });
            } catch (e) { /* unload — nothing we can do */ }
        },

        /* Desktop app: desktop.py calls this when the window is closed and
           waits for it, so even a note above the 64 kB keepalive limit is
           stored (K5). Resolves when the save is done (or not needed). */
        flushForClose: function () {
            return NP.editor.save(true).then(function () { return "saved"; });
        },

        /* ---- Note loading ---- */

        loadNote: function (id) {
            /* Stop the previous note's autosave FIRST. Without this,
               a timer fire after _currentNoteId is reassigned but
               before the fetch resolves would save the previous
               note's textarea content under the NEW note's id. */
            NP.editor.stopAutosave();
            NP.editor._forgetUnlock();

            NP.editor._currentNoteId = id;
            NP.state.currentNoteId = id;
            /* Until this note's content is in the editor, the editor still
               shows the previous note: nothing may be saved (K1). */
            NP.editor._loadedNoteId = null;

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
                /* The user opened another note meanwhile: this answer is stale. */
                if (!NP.editor.el || NP.editor._currentNoteId !== id) return;

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
                    /* Show the lock screen while the password dialog is
                       up, so the previous note never stays visible. */
                    NP.editor._showLockScreen();
                    NP.editor._refreshLockButton();
                    /* Unlock for viewing (file stays encrypted). The page
                       keeps only the unlock token, never the password. */
                    return NP.encryption.askAndUnlock(id).then(function (decData) {
                        if (!decData) return;  /* cancelled — STATE C */
                        if (!NP.editor.el || NP.editor._currentNoteId !== id) {
                            /* User moved on meanwhile: don't keep the key. */
                            NP.api.lock(decData.unlock_token).catch(function () {});
                            return;
                        }
                        NP.editor._unlockToken = decData.unlock_token;

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
                        NP.editor._loadedNoteId = id;
                    }).catch(function (err) {
                        NP.dialog.alert(NP.t("editor.unlockFailed", {
                            error: err && err.message ? err.message : err }));
                        NP.editor._showLockScreen();
                        /* STATE C: encrypted + locked */
                        NP.editor._refreshLockButton();
                    });
                }

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
                NP.editor._loadedNoteId = id;
            }).catch(function (err) {
                console.error("loadNote error:", err);
                if (NP.editor.el) {
                    NP.editor.el.innerHTML =
                        "<p style='color:var(--fg-dim);'>" +
                        NP.escapeHtml(NP.t("editor.loadError", { error: err.message })) + "</p>";
                }
            });
        },

        _showLockScreen: function () {
            if (!NP.editor.el) return;
            /* In Markdown mode the source and the preview are what is on
               screen, not #editor: they must go too (K3). */
            if (NP.markdown && NP.markdown.leaveForLoad) NP.markdown.leaveForLoad();
            NP.editor._loadedNoteId = null;
            NP.editor.el.contentEditable = "false";
            NP.editor.el.innerHTML =
                "<div style='text-align:center;padding:80px 20px;'>" +
                "<div style='font-size:48px;margin-bottom:16px;'>&#x1F512;</div>" +
                "<div style='font-size:16px;color:var(--fg);margin-bottom:8px;'>" + NP.escapeHtml(NP.t("editor.lockScreen.title")) + "</div>" +
                "<div style='font-size:12px;color:var(--fg-dim);'>" + NP.escapeHtml(NP.t("editor.lockScreen.hint")) + "</div>" +
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
            NP.editor._forgetUnlock();
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

            /* Logo: the icon above the name */
            html += "<img class='welcome-icon np-decorative' src='/static/img/noirpad-icon.svg' " +
                "width='72' height='72' draggable='false' alt='' aria-hidden='true'>";
            html += "<h1 class='welcome-logo'>NoirPad</h1>";

            /* Decorative divider */
            html += "<div class='welcome-divider'>";
            html += "<div class='welcome-line'></div>";
            html += "<div class='welcome-line'></div>";
            html += "</div>";

            /* Subtitle */
            html += "<p class='welcome-sub'>" + NP.escapeHtml(NP.t("editor.welcome.subtitle")) + "</p>";

            /* Version */
            html += "<p class='welcome-version'>" + NP.escapeHtml(NP.t("editor.welcome.version", { version: (NP.appInfo && NP.appInfo.version) || "?" })) + "</p>";

            /* Hint */
            html += "<p class='welcome-hint'>" + NP.escapeHtml(NP.t("editor.welcome.hint")).replace("{keys}",
                "<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>") + "</p>";

            html += "</div>";

            NP.editor.el.innerHTML = html;
            NP.editor.updateCharCount();
        },

        showOverview: function (item) {
            if (!NP.editor.el) return;

            NP.editor.stopAutosave();
            NP.editor._currentNoteId = null;
            NP.editor._forgetUnlock();
            NP.editor._currentNoteEncrypted = false;
            NP.editor.el.contentEditable = "false";
            NP.editor._refreshLockButton();

            var childCount = item.children ? item.children.length : 0;
            var totalCount = countAllItems(item.children || [], null);

            var html = "";
            html += "<div style='padding:40px;max-width:600px;margin:0 auto;'>";
            html += "<h2 style='color:var(--fg-bright);margin:0 0 8px 0;'>&#128193; " + NP.escapeHtml(item.name) + "</h2>";
            html += "<p style='color:var(--fg-dim);margin:0 0 24px 0;'>" + NP.escapeHtml(NP.t("editor.overview.summary", {
                direct: NP.t("editor.overview.directItems", { n: childCount }),
                total: NP.t("editor.overview.totalItems", { n: totalCount })
            })) + "</p>";

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

        /* Render stored note content (rich-text mode) into *el*. Built
           with DOM APIs only — note text never goes through innerHTML. */
        renderContent: function (el, text, formats) {
            el.replaceChildren(NP.editor._buildRichContent(text || "", formats));
        },

        htmlToContent: function () {
            if (!NP.editor.el) return { text: "", formats: [] };

            var result = NP.editor._htmlToTextWithImages();
            var text = result.text;
            var formats = NP.editor._extractFormats();

            return { text: text, formats: formats };
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

        /* Stored rich-text content → DocumentFragment.
             ```lang\n…```           → <pre class="np-code"> (read-only)
             <<IMG:name|w=NNN>>      → <img>, only for valid uuid names;
                                       anything else stays visible text
             formats [{start,end,…}] → <span style> / <em> / <u>
           Format offsets are positions in the full stored text (that is
           how _extractFormats records them). */
        _buildRichContent: function (text, formats) {
            var frag = document.createDocumentFragment();
            var marks = NP.editor._formatMarks(text, formats);
            var re = /```([^\n`]*)\n([\s\S]*?)```|<<IMG:([^|>\n]*)(?:\|w=(\d+))?>>/g;
            var pos = 0;
            var m;
            while ((m = re.exec(text)) !== null) {
                NP.editor._appendFormatted(frag, text, pos, m.index, marks);
                if (m[2] !== undefined) {
                    /* The newline before the closing fence belongs to the
                       fence, not the code (N2: it used to pile up). */
                    frag.appendChild(NP.editor._renderCodeBlock(
                        m[2].replace(/\n$/, ""), m[1].trim()));
                } else if (NP.isImageName(m[3])) {
                    frag.appendChild(NP.editor._makeImage(m[3], m[4]));
                } else {
                    NP.editor._appendFormatted(frag, text, m.index, re.lastIndex, marks);
                }
                pos = re.lastIndex;
            }
            NP.editor._appendFormatted(frag, text, pos, text.length, marks);
            return frag;
        },

        /* formats → [{start, end, fmt}] in absolute offsets, sorted. */
        _formatMarks: function (text, formats) {
            var marks = [];
            (formats || []).forEach(function (fmt) {
                if (!fmt || typeof fmt !== "object") return;
                var start = fmt.start, end = fmt.end;
                if (typeof start === "string" && start.indexOf(".") !== -1) {
                    start = NP.lineColToOffset(text, start);
                    end = NP.lineColToOffset(text, String(end));
                }
                start = Number(start);
                end = Number(end);
                if (isFinite(start) && isFinite(end) && end > start) {
                    marks.push({ start: start, end: end, fmt: fmt });
                }
            });
            marks.sort(function (a, b) { return a.start - b.start; });
            return marks;
        },

        /* Append text[start:end) to *parent*, splitting at format
           boundaries and turning \n into <br>. */
        _appendFormatted: function (parent, text, start, end, marks) {
            if (end <= start) return;
            var cuts = [start, end];
            marks.forEach(function (mk) {
                if (mk.start > start && mk.start < end) cuts.push(mk.start);
                if (mk.end > start && mk.end < end) cuts.push(mk.end);
            });
            cuts.sort(function (a, b) { return a - b; });
            for (var i = 0; i < cuts.length - 1; i++) {
                var a = cuts[i], b = cuts[i + 1];
                if (b <= a) continue;
                var active = marks.filter(function (mk) { return mk.start <= a && mk.end >= b; });
                parent.appendChild(NP.editor._styledRun(text.substring(a, b), active));
            }
        },

        _styledRun: function (str, active) {
            var leaf = document.createDocumentFragment();
            str.split("\n").forEach(function (line, i) {
                if (i > 0) leaf.appendChild(document.createElement("br"));
                if (line) leaf.appendChild(document.createTextNode(line));
            });
            if (!active.length) return leaf;

            var italic = false, underline = false, font = null, size = null, color = null;
            active.forEach(function (mk) {
                var f = mk.fmt;
                if (f.style === "italic" || f.italic) italic = true;
                if (f.style === "underline" || f.underline) underline = true;
                if (typeof f.font === "string" && f.font) font = f.font;
                if (f.size !== undefined && f.size !== null) size = parseInt(f.size, 10);
                if (typeof f.color === "string" && f.color) color = f.color;
            });

            var node = leaf;
            if (underline) { var u = document.createElement("u"); u.appendChild(node); node = u; }
            if (italic) { var em = document.createElement("em"); em.appendChild(node); node = em; }
            if (font || size || color) {
                var span = document.createElement("span");
                /* setProperty drops values that aren't valid CSS for that
                   property, so nothing can leak into other declarations. */
                if (font) span.style.setProperty("font-family", font);
                if (size && size >= 6 && size <= 200) span.style.setProperty("font-size", size + "px");
                if (color) span.style.setProperty("color", color);
                span.appendChild(node);
                node = span;
            }
            return node;
        },

        _makeImage: function (filename, width) {
            var img = document.createElement("img");
            img.setAttribute("src", "/images/" + filename);
            img.setAttribute("data-filename", filename);
            var w = width ? parseInt(width, 10) : 0;
            if (w) {
                img.setAttribute("data-w", String(w));
                img.style.width = w + "px";
                img.style.maxWidth = w + "px";
            } else {
                img.style.maxWidth = "100%";
            }
            img.style.display = "block";
            img.style.margin = "8px 0";
            return img;
        },

        _renderCodeBlock: function (code, lang) {
            var langSafe = (lang || "").replace(/[^a-zA-Z0-9_+\-]/g, "");
            var pre = document.createElement("pre");
            pre.className = "np-code";
            pre.setAttribute("contenteditable", "false");
            pre.setAttribute("data-code", encodeURIComponent(code));
            pre.setAttribute("data-lang", langSafe);
            if (langSafe) {
                var tag = document.createElement("span");
                tag.className = "tok-lang";
                tag.textContent = langSafe;
                pre.appendChild(tag);
            }
            var body = document.createElement("code");
            if (NP.highlight) NP.highlight.into(body, code, langSafe);
            else body.textContent = code;
            pre.appendChild(body);
            return pre;
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
            if (!id || !NP.editor.el || NP.editor._loadedNoteId !== id) {
                /* Nothing open, or the editor still holds another note. */
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

            var key = id + "\u0000" + text + "\u0000" + JSON.stringify(formats);
            if (silent && key === NP.editor._lastSavedKey) {
                return Promise.resolve();
            }

            var savePromise;
            if (NP.editor._currentNoteEncrypted) {
                var token = NP.editor._unlockToken;
                if (!token) return Promise.resolve();  /* locked: nothing editable */
                /* Re-encrypt on the server with the remembered key. A 401
                   means the key expired: ask for the password and retry,
                   so the user's edits are not lost. */
                savePromise = NP.api.saveEncrypted(id, token, text, formats).catch(function (err) {
                    if (!(err && err.status === 401 && NP.encryption && NP.encryption.reunlock)) throw err;
                    return NP.encryption.reunlock(id).then(function (newToken) {
                        if (!newToken) throw new Error(NP.t("editor.lockedNotSaved"));
                        return NP.api.saveEncrypted(id, newToken, text, formats);
                    });
                });
            } else {
                savePromise = NP.api.saveNote(id, text, formats);
            }
            NP.editor._lastSave = savePromise;

            return savePromise.then(function () {
                NP.editor._lastSavedKey = key;
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
                if (charEl) charEl.textContent = NP.t("editor.count.chars", { n: 0 });
                if (wordEl) wordEl.textContent = NP.t("editor.count.words", { n: 0 });
                if (lineEl) lineEl.textContent = NP.t("editor.count.lines", { n: 0 });
                return;
            }

            var result = NP.editor._htmlToTextWithImages();
            var text = result.text;
            var chars = text.length;
            var words = text.trim() ? text.trim().split(/\s+/).length : 0;
            var lines = text.split("\n").length;

            if (charEl) charEl.textContent = NP.t("editor.count.chars", { n: chars });
            if (wordEl) wordEl.textContent = NP.t("editor.count.words", { n: words });
            if (lineEl) lineEl.textContent = NP.t("editor.count.lines", { n: lines });
        },

        /* ---- Auto-save ---- */

        /* Autosave on: every `autosave_interval` seconds (Settings).
           Off: a 30 s safety net, so a crash never costs more than half a
           minute of typing. Unchanged notes are not rewritten either way. */
        startAutosave: function () {
            NP.editor.stopAutosave();
            var data = (NP.state && NP.state.data) || {};
            var seconds = data.autosave ? parseInt(data.autosave_interval, 10) : 30;
            if (!(seconds >= 5)) seconds = 30;
            NP.editor._autosaveTimer = setInterval(function () {
                NP.editor.save(true);
            }, seconds * 1000);
        },

        stopAutosave: function () {
            if (NP.editor._autosaveTimer) {
                clearInterval(NP.editor._autosaveTimer);
                NP.editor._autosaveTimer = null;
            }
        }
    };

})(window.NP);

/* tabs.js - NoirPad tab bar management */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var MAX_TABS = 10;
    var NAME_MAX_LEN = 20;

    function findTab(noteId) {
        var tabs = NP.state.openTabs;
        for (var i = 0; i < tabs.length; i++) {
            if (tabs[i].id === noteId) return i;
        }
        return -1;
    }

    function truncate(name) {
        if (name.length > NAME_MAX_LEN) {
            return name.substring(0, NAME_MAX_LEN - 1) + "\u2026";
        }
        return name;
    }

    NP.tabs = {
        add: function (noteId, name) {
            var idx = findTab(noteId);
            if (idx !== -1) {
                /* Tab already exists, just activate */
                NP.tabs.activate(noteId);
                return;
            }

            /* Enforce max tabs */
            if (NP.state.openTabs.length >= MAX_TABS) {
                /* Close the oldest inactive tab */
                for (var i = 0; i < NP.state.openTabs.length; i++) {
                    if (NP.state.openTabs[i].id !== NP.state.activeTabId) {
                        NP.state.openTabs.splice(i, 1);
                        break;
                    }
                }
            }

            NP.state.openTabs.push({
                id: noteId,
                name: name,
                scrollTop: 0,
                selectionStart: null,
                selectionEnd: null
            });

            NP.tabs.activate(noteId);
        },

        close: function (noteId) {
            var idx = findTab(noteId);
            if (idx === -1) return;

            var wasActive = NP.state.activeTabId === noteId;
            NP.state.openTabs.splice(idx, 1);

            if (wasActive) {
                if (NP.state.openTabs.length > 0) {
                    /* Switch to nearest neighbor */
                    var newIdx = idx >= NP.state.openTabs.length ? NP.state.openTabs.length - 1 : idx;
                    NP.tabs.activate(NP.state.openTabs[newIdx].id);
                } else {
                    /* Unsaved typing in the last tab: write it before the note
                       is forgotten (the debounced save would find no note).
                       Not for a note just moved to the trash (tree.js clears
                       currentNoteId first): the server would refuse it. */
                    if (NP.editor && NP.editor._saveState === "dirty" &&
                        NP.state.currentNoteId === noteId) NP.editor.save(true);
                    NP.state.activeTabId = null;
                    NP.state.currentNoteId = null;
                    if (NP.editor) NP.editor.showWelcome({ focus: true });
                    NP.tabs.render();
                }
            } else {
                NP.tabs.render();
            }
        },

        /* Notes that just went to the trash (a folder takes all its notes):
           their tabs close. If the open note was one of them, the editor
           lets go of it first, so nothing typed afterwards is "saved" into
           a trashed note, and the start page takes its place (T1, T2). */
        closeNotes: function (ids) {
            var gone = {};
            ids.forEach(function (id) { gone[id] = true; });
            var openGone = !!(NP.state.currentNoteId && gone[NP.state.currentNoteId]) ||
                !!(NP.state.activeTabId && gone[NP.state.activeTabId]);
            for (var i = NP.state.openTabs.length - 1; i >= 0; i--) {
                if (gone[NP.state.openTabs[i].id]) NP.state.openTabs.splice(i, 1);
            }
            if (openGone) {
                NP.state.activeTabId = null;
                NP.state.currentNoteId = null;
                if (NP.editor) NP.editor.showWelcome();
            }
            NP.tabs.render();
        },

        activate: function (noteId) {
            /* Save state of current tab */
            NP.tabs._saveTabState();

            /* Save current note if needed */
            if (NP.state.activeTabId && NP.state.activeTabId !== noteId && NP.editor) {
                NP.editor.save(true);
            }

            NP.state.activeTabId = noteId;
            NP.state.currentNoteId = noteId;

            /* Load the note */
            if (NP.editor) {
                NP.editor.loadNote(noteId).then(function () {
                    /* Restore saved scroll and selection */
                    var idx = findTab(noteId);
                    if (idx !== -1) {
                        var tab = NP.state.openTabs[idx];
                        if (NP.editor.el && tab.scrollTop) {
                            NP.editor.el.scrollTop = tab.scrollTop;
                        }
                        /* Restore selection if available */
                        if (tab.selectionStart !== null && tab.selectionEnd !== null) {
                            try {
                                var sel = window.getSelection();
                                if (sel && NP.editor.el.childNodes.length > 0) {
                                    var range = document.createRange();
                                    NP.tabs._restoreSelection(range, tab.selectionStart, tab.selectionEnd);
                                    sel.removeAllRanges();
                                    sel.addRange(range);
                                }
                            } catch (e) {
                                /* Selection restore can fail if DOM changed */
                            }
                        }
                    }
                });
            }

            NP.tabs.render();

            /* Also update tree selection */
            if (NP.tree) NP.tree.render();
        },

        render: function () {
            var bar = NP.$("#tab-bar");
            if (!bar) return;

            /* Keyboard (ARIA tabs): ← → Home End move, Enter / Space open,
               Delete closes the focused tab. */
            if (!bar._npKeysBound) {
                bar._npKeysBound = true;
                bar.addEventListener("keydown", function (e) {
                    var pill = e.target.closest ? e.target.closest(".tab-pill") : null;
                    if (!pill) return;
                    var pills = Array.prototype.slice.call(bar.querySelectorAll(".tab-pill"));
                    var i = pills.indexOf(pill);
                    var to = null;
                    if (e.key === "ArrowRight") to = pills[(i + 1) % pills.length];
                    else if (e.key === "ArrowLeft") to = pills[(i - 1 + pills.length) % pills.length];
                    else if (e.key === "Home") to = pills[0];
                    else if (e.key === "End") to = pills[pills.length - 1];
                    else if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        NP.tabs.activate(pill.getAttribute("data-id"));
                        return;
                    } else if (e.key === "Delete") {
                        e.preventDefault();
                        e.stopPropagation();          /* not the tree's Delete */
                        NP.tabs.close(pill.getAttribute("data-id"));
                        var left = bar.querySelector(".tab-pill.active");
                        if (left) left.focus();
                        return;
                    } else return;
                    e.preventDefault();
                    pills.forEach(function (p) { p.tabIndex = -1; });
                    to.tabIndex = 0;
                    to.focus();
                });
            }
            var hadFocus = bar.contains(document.activeElement);

            bar.innerHTML = "";

            var tabs = NP.state.openTabs;
            var activeEl = null;
            for (var i = 0; i < tabs.length; i++) {
                (function (tab) {
                    var isActive = NP.state.activeTabId === tab.id;
                    var pill = document.createElement("div");
                    pill.className = "tab-pill" + (isActive ? " active" : "");
                    pill.setAttribute("role", "tab");
                    pill.setAttribute("aria-selected", isActive ? "true" : "false");
                    pill.setAttribute("aria-keyshortcuts", "Delete");
                    pill.setAttribute("data-id", tab.id);
                    pill.tabIndex = isActive ? 0 : -1;
                    pill.title = tab.name;

                    var nameSpan = document.createElement("span");
                    nameSpan.className = "tab-name";
                    nameSpan.textContent = truncate(tab.name);
                    pill.appendChild(nameSpan);

                    /* Close: shown on hover / for the active tab (CSS). For
                       the mouse only — the keyboard closes with Delete. */
                    var closeBtn = document.createElement("span");
                    closeBtn.className = "tab-close";
                    closeBtn.setAttribute("aria-hidden", "true");
                    closeBtn.title = NP.t("ui.topBar.closeTab");
                    closeBtn.textContent = "×";
                    closeBtn.addEventListener("click", function (e) {
                        e.stopPropagation();
                        NP.tabs.close(tab.id);
                    });
                    pill.appendChild(closeBtn);

                    pill.addEventListener("click", function () {
                        NP.tabs.activate(tab.id);
                    });
                    /* Middle-click to close */
                    pill.addEventListener("mousedown", function (e) {
                        if (e.button === 1) {
                            e.preventDefault();
                            NP.tabs.close(tab.id);
                        }
                    });

                    bar.appendChild(pill);
                    if (isActive) activeEl = pill;
                })(tabs[i]);
            }
            /* Keep the active tab in view when the strip scrolls. */
            if (activeEl && activeEl.scrollIntoView) {
                activeEl.scrollIntoView({ block: "nearest", inline: "nearest" });
            }
            if (hadFocus && activeEl) activeEl.focus();
            if (NP.topbar && NP.topbar.refresh) NP.topbar.refresh();
        },

        next: function () {
            var tabs = NP.state.openTabs;
            if (tabs.length < 2) return;
            var idx = findTab(NP.state.activeTabId);
            var next = (idx + 1) % tabs.length;
            NP.tabs.activate(tabs[next].id);
        },

        prev: function () {
            var tabs = NP.state.openTabs;
            if (tabs.length < 2) return;
            var idx = findTab(NP.state.activeTabId);
            var prev = (idx - 1 + tabs.length) % tabs.length;
            NP.tabs.activate(tabs[prev].id);
        },

        closeCurrent: function () {
            if (NP.state.activeTabId) {
                NP.tabs.close(NP.state.activeTabId);
            }
        },

        _saveTabState: function () {
            if (!NP.state.activeTabId) return;
            var idx = findTab(NP.state.activeTabId);
            if (idx === -1) return;

            var tab = NP.state.openTabs[idx];

            /* Save scroll position */
            if (NP.editor && NP.editor.el) {
                tab.scrollTop = NP.editor.el.scrollTop;
            }

            /* Save selection range as node offsets */
            try {
                var sel = window.getSelection();
                if (sel && sel.rangeCount > 0) {
                    var range = sel.getRangeAt(0);
                    tab.selectionStart = NP.tabs._serializePosition(range.startContainer, range.startOffset);
                    tab.selectionEnd = NP.tabs._serializePosition(range.endContainer, range.endOffset);
                } else {
                    tab.selectionStart = null;
                    tab.selectionEnd = null;
                }
            } catch (e) {
                tab.selectionStart = null;
                tab.selectionEnd = null;
            }
        },

        _serializePosition: function (node, offset) {
            /*
             * Serialize a DOM position as an array of child indices
             * from the editor root to the target node, plus the offset.
             */
            if (!NP.editor || !NP.editor.el) return null;
            var path = [];
            var current = node;
            while (current && current !== NP.editor.el) {
                var parent = current.parentNode;
                if (!parent) return null;
                var children = parent.childNodes;
                for (var i = 0; i < children.length; i++) {
                    if (children[i] === current) {
                        path.unshift(i);
                        break;
                    }
                }
                current = parent;
            }
            if (current !== NP.editor.el) return null;
            return { path: path, offset: offset };
        },

        _restoreSelection: function (range, startPos, endPos) {
            if (!NP.editor || !NP.editor.el) return;

            function resolvePosition(pos) {
                if (!pos || !pos.path) return null;
                var node = NP.editor.el;
                for (var i = 0; i < pos.path.length; i++) {
                    if (!node.childNodes || pos.path[i] >= node.childNodes.length) return null;
                    node = node.childNodes[pos.path[i]];
                }
                return { node: node, offset: Math.min(pos.offset, node.length || node.childNodes.length || 0) };
            }

            var start = resolvePosition(startPos);
            var end = resolvePosition(endPos);

            if (start) {
                range.setStart(start.node, start.offset);
            }
            if (end) {
                range.setEnd(end.node, end.offset);
            }
        }
    };

})(window.NP);

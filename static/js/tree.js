/* tree.js - NoirPad sidebar tree navigation */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var TAGS_SHOWN = 6;                               /* TAGS section, before "+ N more" */
    var TAGS_COLLAPSED_KEY = "noirpad_tags_collapsed";

    /* Every tag in the tree once (first spelling wins, case ignored),
       with how many notes carry it. */
    function collectTags(items, out) {
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            (it.tags || []).forEach(function (t) {
                var key = String(t).toLowerCase();
                if (!out[key]) out[key] = { name: String(t), count: 0 };
                if (it.type !== "folder") out[key].count++;
            });
            if (it.children) collectTags(it.children, out);
        }
        return out;
    }

    function hasTag(item, key) {
        return (item.tags || []).some(function (t) { return String(t).toLowerCase() === key; });
    }

    /* A folder stays visible while the filter is on if it holds a match. */
    function containsMatch(item, key) {
        if (item.type !== "folder") return hasTag(item, key);
        return (item.children || []).some(function (c) { return containsMatch(c, key); });
    }

    /* Folders an item may move into: every folder except itself and its
       own subfolders, with their depth for indentation. */
    function moveTargets(items, sourceId, depth, out) {
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it.type !== "folder" || it.id === sourceId) continue;
            out.push({ item: it, depth: depth });
            moveTargets(it.children || [], sourceId, depth + 1, out);
        }
        return out;
    }

    /* Display order of one folder's items (or the root's): subfolders,
       then favorite notes, then the other notes; favorite folders first
       among the folders. Each group keeps the user's own order (drag and
       drop). Only items of this level are reordered, so a favorite stays
       in its folder and never jumps above the folders. */
    /* 0 favorite folders, 1 folders, 2 favorite notes, 3 notes. */
    function groupOf(item) {
        var favs = (NP.state.data && NP.state.data.favorites) || [];
        var fav = favs.indexOf(item.id) !== -1 ? 0 : 1;
        return (item.type === "folder" ? 0 : 2) + fav;
    }

    function sortItems(items) {
        var group = groupOf;
        return items.map(function (item, i) { return { item: item, i: i }; })
            .sort(function (a, b) { return group(a.item) - group(b.item) || a.i - b.i; })
            .map(function (entry) { return entry.item; });
    }

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

    /* Returns the parent folder id of `id`: null if `id` is top-level,
       undefined if `id` is not found anywhere in `items`. */
    function findParentId(items, id, parentId) {
        for (var i = 0; i < items.length; i++) {
            if (items[i].id === id) return parentId;
            if (items[i].children) {
                var r = findParentId(items[i].children, id, items[i].id);
                if (r !== undefined) return r;
            }
        }
        return undefined;
    }

    function countChildren(item) {
        if (!item.children) return 0;
        var count = 0;
        for (var i = 0; i < item.children.length; i++) {
            count++;
            if (item.children[i].children) {
                count += countChildren(item.children[i]);
            }
        }
        return count;
    }

    function isEncrypted(id) {
        if (!NP.state.data || !NP.state.data.notes) return false;
        /* The same test as the editor's (E14): a plain note that only
           contains {"encrypted": true} as text gets no lock icon. */
        return NP.isEncryptedEnvelope(NP.state.data.notes[id]);
    }

    /* Walk up the tree to find every folder that contains `id`, so
       the open-state can be toggled to reveal the highlighted note.
       Returns the chain ordered root → leaf parent (excludes `id`
       itself). */
    function ancestorFolderIds(items, id, chain) {
        for (var i = 0; i < items.length; i++) {
            if (items[i].id === id) return chain.slice();
            if (items[i].children) {
                chain.push(items[i].id);
                var hit = ancestorFolderIds(items[i].children, id, chain);
                if (hit) return hit;
                chain.pop();
            }
        }
        return null;
    }

    NP.tree = {
        /* Sync the sidebar highlight with the active note. Called
           from editor.loadNote so EVERY note-open path (tree click,
           tab click, +Note, command bar, …) ends up with the right
           item highlighted — no need to remember to call it from
           every caller. Expands ancestor folders so the item is
           actually visible. */
        setSelected: function (noteId) {
            if (NP.state.selectedId === noteId) {
                /* Already selected — still re-render in case the
                   tree DOM was rebuilt for other reasons. */
                NP.tree.render();
                return;
            }
            NP.state.selectedId = noteId;

            if (noteId && NP.state.data && NP.state.data.tree) {
                var ancestors = ancestorFolderIds(
                    NP.state.data.tree, noteId, []
                );
                if (ancestors) {
                    for (var i = 0; i < ancestors.length; i++) {
                        if (!NP.state.getFolderOpenState(ancestors[i])) {
                            NP.state.setFolderOpenState(ancestors[i], true);
                        }
                    }
                }
            }

            NP.tree.render();

            /* Scroll the now-highlighted row into view if it ended
               up off-screen (e.g. when activating a tab for a note
               buried in a long, scrollable tree). */
            var el = NP.tree._row(noteId);
            if (el && el.scrollIntoView) {
                el.scrollIntoView({ block: "nearest" });
            }
        },

        render: function () {
            var container = NP.$("#tree-container");
            if (!container) return;

            /* Click on empty tree area (not on an item — items
               stopPropagation) clears the selection so +Note goes to
               root. Bound once on the persistent container element. */
            if (!container._npDeselectBound) {
                container._npDeselectBound = true;
                container.addEventListener("click", function (e) {
                    if (e.target === container) {
                        NP.state.selectedId = null;
                        NP.tree.render();
                    }
                });
            }

            if (!container._npKeysBound) {
                container._npKeysBound = true;
                container.setAttribute("role", "tree");
                container.setAttribute("aria-label", NP.t("ui.sidebar.notes"));
                container.addEventListener("keydown", NP.tree._onKey);
                container.addEventListener("focusin", function (e) {
                    var row = e.target.closest && e.target.closest(".tree-item[data-id]");
                    if (row) NP.tree._focusId = row.getAttribute("data-id");
                });
            }
            var hadFocus = container.contains(document.activeElement);

            container.innerHTML = "";

            var data = NP.state.data;
            if (!data || !data.tree) return;

            /* T7: the filter's tag is on no note any more (its last one
               was removed): the filter goes off instead of "no matches". */
            if (NP.tree.tagFilter && !collectTags(data.tree, {})[NP.tree.tagFilter]) {
                NP.tree.tagFilter = null;
            }

            var items = sortItems(data.tree);
            for (var i = 0; i < items.length; i++) {
                NP.tree._renderItem(items[i], 0, container);
            }
            if (NP.tree.tagFilter && !container.firstChild) {
                var none = document.createElement("div");
                none.className = "tree-empty";
                none.textContent = NP.t("tree.noTagMatches");
                container.appendChild(none);
            }
            NP.tree.renderTags();
            NP.tree.refreshSearchKeys();

            /* One row is reachable with Tab (roving tabindex); keyboard focus
               survives the re-render. */
            var rows = NP.tree._rows();
            var focusRow = NP.tree._row(NP.tree._focusId) || NP.tree._row(NP.state.selectedId) || rows[0];
            if (focusRow) {
                focusRow.tabIndex = 0;
                if (hadFocus) focusRow.focus();
            }

            /* ---- Trash section ---- */
            var trash = data.trash;
            var trashTree = (trash && trash.tree) || [];
            if (trashTree.length > 0) {
                var sep = document.createElement("div");
                sep.style.cssText = "height:1px;margin:12px 8px;background:var(--border);";
                container.appendChild(sep);

                var header = document.createElement("div");
                header.className = "tree-trash-header";
                var label = document.createElement("span");
                label.className = "tree-trash-title";
                label.textContent = NP.t("tree.trashHeader");
                header.appendChild(label);
                var emptyBtn = document.createElement("button");
                emptyBtn.type = "button";
                emptyBtn.className = "trash-btn trash-btn--danger trash-btn--text tree-trash-empty";
                emptyBtn.textContent = NP.t("trash.emptyTitle");
                emptyBtn.title = NP.t("trash.emptyTitle");
                emptyBtn.addEventListener("click", function (e) {
                    e.stopPropagation();
                    if (NP.trash && NP.trash.empty) NP.trash.empty();
                });
                header.appendChild(emptyBtn);
                container.appendChild(header);

                for (var t = 0; t < trashTree.length; t++) {
                    NP.tree._renderTrashItem(trashTree[t], 0, container);
                }
            }

            NP.tree._setupDragDrop();
        },

        _renderItem: function (item, depth, container) {
            var isFolder = item.type === "folder";
            if (!NP.tree._matchesFilter(item)) return;

            var div = document.createElement("div");
            div.className = "tree-item " + (isFolder ? "tree-item--folder" : "tree-item--note");
            div.setAttribute("data-id", item.id);
            div.setAttribute("draggable", "true");
            div.setAttribute("role", "treeitem");
            div.setAttribute("aria-level", String(depth + 1));
            div.tabIndex = -1;
            div.style.paddingLeft = (8 + depth * 16) + "px";

            var favs = (NP.state.data && NP.state.data.favorites) || [];
            var isFav = favs.indexOf(item.id) !== -1;
            var filtering = !!NP.tree.tagFilter;
            var isOpen = isFolder && (filtering || NP.state.getFolderOpenState(item.id));
            if (NP.state.selectedId === item.id) div.className += " selected";
            div.setAttribute("aria-selected", NP.state.selectedId === item.id ? "true" : "false");
            if (isFolder) div.setAttribute("aria-expanded", isOpen ? "true" : "false");

            if (isFolder) {
                var arrow = NP.icon(isOpen ? "chevron-down" : "chevron-right", "tree-arrow");
                div.appendChild(arrow);
                var sq = document.createElement("span");
                sq.className = "tree-folder-mark";
                sq.setAttribute("aria-hidden", "true");
                div.appendChild(sq);
            } else {
                div.style.paddingLeft = (8 + depth * 16 + 18) + "px";
            }

            var name = document.createElement("span");
            name.className = "tree-name";
            name.textContent = item.name;
            div.appendChild(name);

            if (!isFolder && isEncrypted(item.id)) {
                div.appendChild(NP.icon("lock", "tree-badge"));
            }
            if (isFav) {
                var star = document.createElement("span");
                star.className = "tree-star";
                star.textContent = "★";
                star.setAttribute("aria-label", NP.t("tree.favorite"));
                div.appendChild(star);
            }
            div.title = item.name;

            div.addEventListener("click", function (e) {
                NP.tree._onItemClick(e, item.id, item.type);
                e.stopPropagation();
            });
            div.addEventListener("contextmenu", function (e) {
                e.preventDefault();
                NP.tree._onRightClick(e, item.id, item.type);
            });

            container.appendChild(div);

            if (isOpen && item.children) {
                var children = sortItems(item.children);
                for (var c = 0; c < children.length; c++) {
                    NP.tree._renderItem(children[c], depth + 1, container);
                }
            }
        },

        _renderTrashItem: function (item, depth, container) {
            var div = document.createElement("div");
            div.className = "tree-item tree-item--trash";
            div.setAttribute("data-id", item.id);
            div.style.paddingLeft = (depth * 20 + 12) + "px";

            var isFolder = item.type === "folder";
            var html = "<span class='tree-trash-name'>";

            if (isFolder) {
                html += "<span style='margin-right:4px;'>&#128193;</span>";
            } else {
                html += "<span style='margin-right:4px;font-size:8px;color:var(--fg-dim);'>\u25c6</span>";
            }
            html += "<span class='tree-trash-label'>" + NP.escapeHtml(item.name) + "</span></span>";
            /* Big targets (32×32), icon + tooltip/aria-label, delete in red. */
            var restoreLabel = NP.escapeHtml(NP.t("trash.restoreItem", { name: item.name }));
            var deleteLabel = NP.escapeHtml(NP.t("trash.deleteItem", { name: item.name }));
            html += "<button type='button' class='trash-btn trash-btn--restore tree-trash-restore' title='" +
                NP.escapeHtml(NP.t("common.restore")) + "' aria-label='" + restoreLabel + "'>\u21a9</button>";
            html += "<button type='button' class='trash-btn trash-btn--danger tree-trash-delete' title='" +
                NP.escapeHtml(NP.t("tree.deletePermanently")) + "' aria-label='" + deleteLabel + "'>\u00d7</button>";

            div.innerHTML = html;

            /* Restore button */
            var restoreBtn = div.querySelector(".tree-trash-restore");
            if (restoreBtn) {
                restoreBtn.addEventListener("click", function (e) {
                    e.stopPropagation();
                    NP.api.restoreFromTrash(item.id).then(function () {
                        return NP.state.init();
                    }).then(function () {
                        NP.tree.render();
                        /* T9: the note on screen came back: editable again. */
                        var shown = NP.editor && NP.editor._trashedId;
                        if (shown && findItemById(NP.state.data.tree, shown)) NP.editor.loadNote(shown);
                    }).catch(NP.dialog.failed);
                });
            }

            /* Delete permanently button */
            var deleteBtn = div.querySelector(".tree-trash-delete");
            if (deleteBtn) {
                deleteBtn.addEventListener("click", function (e) {
                    e.stopPropagation();
                    NP.dialog.confirm(NP.t("tree.confirmDeletePermanently", { name: item.name }), {
                        title: NP.t("tree.deletePermanently"),
                        okLabel: NP.t("tree.deletePermanently"),
                        danger: true
                    }).then(function (ok) {
                        if (!ok) return;
                        return NP.api.deleteTrashItem(item.id).then(function () {
                            return NP.state.init();
                        }).then(function () {
                            NP.tree.render();
                        });
                    }).catch(NP.dialog.failed);
                });
            }

            /* Click on trash item to view (read-only) */
            div.addEventListener("click", function (e) {
                if (e.target.closest(".trash-btn")) return;
                if (item.type === "note" && NP.editor) {
                    /* The open note is saved first (E2); no tab stays
                       highlighted over a note from the trash. */
                    var leave = NP.editor.leave ? NP.editor.leave() : Promise.resolve(true);
                    leave.then(function (go) {
                        if (!go) return;
                        NP.state.activeTabId = null;
                        if (NP.tabs) NP.tabs.render();
                        NP.editor.loadNote(item.id);
                    });
                }
            });

            container.appendChild(div);

            if (isFolder && item.children) {
                for (var c = 0; c < item.children.length; c++) {
                    NP.tree._renderTrashItem(item.children[c], depth + 1, container);
                }
            }
        },

        _onItemClick: function (e, id, type) {
            if (type === "folder") {
                var onArrow = !!(e && e.target && e.target.closest &&
                    e.target.closest(".tree-arrow"));
                /* Anywhere on the row → open/close (N8); except the
                   chevron ▾▸, the click also selects the folder. */
                NP.state.setFolderOpenState(
                    id, !NP.state.getFolderOpenState(id)
                );
                if (!onArrow) NP.state.selectedId = id;
                NP.tree.render();
            } else {
                NP.state.selectedId = id;
                /* currentNoteId changes only once the open note is saved
                   (tabs.activate / loadNote), never before (E3). */
                if (NP.tabs) {
                    var item = findItemById(NP.state.data.tree, id);
                    var name = item ? item.name : NP.t("tree.defaultNoteName");
                    NP.tabs.add(id, name);
                } else if (NP.editor) {
                    /* Only call loadNote directly if tabs module is not available */
                    NP.editor.loadNote(id);
                }
                NP.tree.render();
            }
        },

        /* Parent folder id for a NEW note created via the +Note toolbar
           button: selected folder -> that folder; selected note -> its
           parent folder; nothing / stale-deleted selection -> null (root). */
        getNewItemParentId: function () {
            var sel = NP.state.selectedId;
            var data = NP.state.data;
            if (!sel || !data || !data.tree) return null;
            var item = findItemById(data.tree, sel);
            if (!item) return null;
            if (item.type === "folder") return sel;
            var p = findParentId(data.tree, sel, null);
            return p === undefined ? null : p;
        },

        _onRightClick: function (e, id, type) {
            var A = function (action) { return function () { NP.tree._handleContextAction(action, id, type); }; };
            var fav = ((NP.state.data && NP.state.data.favorites) || []).indexOf(id) !== -1;
            var items = [];
            if (type === "folder") {
                items.push({ id: "new-note", icon: "file-plus", label: NP.t("tree.contextMenu.newNote"), run: A("new-note") });
                items.push({ id: "new-folder", icon: "folder-plus", label: NP.t("tree.contextMenu.newFolder"), run: A("new-folder") });
                items.push("-");
            }
            items.push({ id: "rename", icon: "pencil", label: NP.t("common.rename"), run: A("rename") });
            items.push({ id: "move", icon: "folder", label: NP.t("tree.contextMenu.moveTo"), run: function () {
                NP.tree._openMoveMenu({ x: e.clientX, y: e.clientY }, id);
            } });
            if (type !== "folder") {
                items.push({ id: "favorite", icon: "star", label: NP.t(fav ? "tree.contextMenu.removeFavorite"
                    : "tree.contextMenu.addFavorite"), run: A("favorite") });
            }
            items.push("-");
            items.push({ id: "delete", icon: "trash-2", label: NP.t("common.delete"), danger: true, run: A("delete") });
            NP.menu.open({ x: e.clientX, y: e.clientY }, items);
        },

        /* "Move to…": the top level or any folder the item may go into. */
        _openMoveMenu: function (at, id) {
            var tree = (NP.state.data && NP.state.data.tree) || [];
            var parent = findParentId(tree, id, null);
            var roots = tree.filter(function (it) { return it.id !== id; });
            var items = [{ id: "root", icon: "folder", label: NP.t("tree.contextMenu.moveToRoot"),
                disabled: parent === null || !roots.length,
                run: function () { NP.tree._moveTo(id, null); } }];
            moveTargets(tree, id, 0, []).forEach(function (t) {
                items.push({ id: t.item.id, icon: "folder",
                    label: new Array(t.depth + 1).join("  ") + t.item.name,
                    disabled: t.item.id === parent,
                    run: function () { NP.tree._moveTo(id, t.item.id); } });
            });
            NP.menu.open(at, items, { label: NP.t("tree.contextMenu.moveTo") });
        },

        /* folderId null = the top level (after the last top-level item). */
        _moveTo: function (id, folderId) {
            var tree = (NP.state.data && NP.state.data.tree) || [];
            var call;
            if (folderId) {
                call = NP.api.move(id, folderId, "inside");
            } else {
                var roots = tree.filter(function (it) { return it.id !== id; });
                if (!roots.length) return Promise.resolve();
                call = NP.api.move(id, roots[roots.length - 1].id, "after");
            }
            return call.then(function () {
                if (folderId) NP.state.setFolderOpenState(folderId, true);
                return NP.state.init();
            }).then(function () {
                NP.tree.render();
            }).catch(NP.dialog.failed);
        },

        /* ---- Keyboard (ARIA tree): ↑↓ Home End move, → opens / goes in,
           ← closes / goes to the parent, Enter / Space opens, the
           context-menu key or Shift+F10 shows the item's menu, F2 renames
           and Delete deletes (shortcut registry, on the selected item). */

        _rows: function () {
            var c = NP.$("#tree-container");
            return c ? Array.prototype.slice.call(c.querySelectorAll(".tree-item[role='treeitem']")) : [];
        },

        _row: function (id) {
            if (!id) return null;
            var rows = NP.tree._rows();
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].getAttribute("data-id") === id) return rows[i];
            }
            return null;
        },

        _onKey: function (e) {
            var row = e.target.closest ? e.target.closest(".tree-item[role='treeitem']") : null;
            if (!row) return;
            var rows = NP.tree._rows();
            var i = rows.indexOf(row);
            var id = row.getAttribute("data-id");
            var folder = row.classList.contains("tree-item--folder");
            var open = row.getAttribute("aria-expanded") === "true";
            function go(r) {
                if (!r) return;
                rows.forEach(function (x) { x.tabIndex = -1; });
                r.tabIndex = 0;
                r.focus();
            }
            var handled = true;
            if (e.key === "ArrowDown") go(rows[i + 1]);
            else if (e.key === "ArrowUp") go(rows[i - 1]);
            else if (e.key === "Home") go(rows[0]);
            else if (e.key === "End") go(rows[rows.length - 1]);
            else if (e.key === "ArrowRight" && folder) {
                /* T8: into the first child — an open empty folder has none
                   (the next row is a sibling): stay put. */
                var next = rows[i + 1];
                var level = function (r) { return parseInt(r.getAttribute("aria-level"), 10) || 1; };
                if (open) { if (next && level(next) > level(row)) go(next); }
                else { NP.state.setFolderOpenState(id, true); NP.tree.render(); }
            } else if (e.key === "ArrowLeft") {
                if (folder && open) { NP.state.setFolderOpenState(id, false); NP.tree.render(); }
                else go(NP.tree._row(findParentId((NP.state.data && NP.state.data.tree) || [], id, null)));
            } else if (e.key === "Enter" || e.key === " ") {
                NP.tree._onItemClick({ target: row }, id, folder ? "folder" : "note");
            } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
                var r = row.getBoundingClientRect();
                NP.tree._onRightClick({ clientX: r.left + 24, clientY: r.bottom }, id, folder ? "folder" : "note");
            } else handled = false;
            if (handled) {
                e.preventDefault();
                e.stopPropagation();
            }
        },

        /* The tree row that has keyboard focus (Delete / F2 act on it). */
        focusedId: function () {
            var a = document.activeElement;
            var row = a && a.closest ? a.closest("#tree-container .tree-item[data-id]") : null;
            return row ? row.getAttribute("data-id") : null;
        },

        /* F2: rename the focused / selected item, else the open note. */
        renameSelected: function (explicitId) {
            var id = explicitId || NP.state.selectedId || NP.state.currentNoteId;
            var item = id && NP.state.data ? findItemById(NP.state.data.tree || [], id) : null;
            if (item) NP.tree._handleContextAction("rename", id, item.type);
        },

        /* The search field shows the current find-all shortcut. */
        refreshSearchKeys: function () {
            var keys = document.getElementById("sidebar-search-keys");
            if (keys && NP.shortcuts) keys.textContent = NP.shortcuts.getCurrent("find-all") || "";
        },

        /* ---- Tags: the TAGS section and the tree filter ---- */

        tagFilter: null,          /* lower-case tag or null; not saved */

        _matchesFilter: function (item) {
            var key = NP.tree.tagFilter;
            return !key || containsMatch(item, key);
        },

        /* Click a tag: show only its notes; click it again: show all. */
        setTagFilter: function (tag) {
            var key = tag ? String(tag).toLowerCase() : null;
            NP.tree.tagFilter = key === NP.tree.tagFilter ? null : key;
            NP.tree.render();
        },

        tagsExpanded: false,      /* "+ N more" opened; not saved */

        /* The whole TAGS section folded away (saved in localStorage). */
        tagsCollapsed: function () {
            try { return localStorage.getItem(TAGS_COLLAPSED_KEY) === "1"; } catch (e) { return false; }
        },

        setTagsCollapsed: function (on) {
            try {
                if (on) localStorage.setItem(TAGS_COLLAPSED_KEY, "1");
                else localStorage.removeItem(TAGS_COLLAPSED_KEY);
            } catch (e) { /* private window: just this session */ }
            NP.tree.renderTags();
        },

        /* Most used first (ties: by name). Only TAGS_SHOWN of them unless
           "+ N more" is open; the active filter tag is always listed, even
           in a collapsed section, so the filter can be turned off. */
        renderTags: function () {
            var list = document.getElementById("tag-list");
            if (!list) return;
            var tags = collectTags((NP.state.data && NP.state.data.tree) || [], {});
            var keys = Object.keys(tags).sort(function (a, b) {
                return tags[b].count - tags[a].count || (a < b ? -1 : a > b ? 1 : 0);
            });
            if (NP.tree.tagFilter && !tags[NP.tree.tagFilter]) NP.tree.tagFilter = null;
            list.replaceChildren();
            var head = document.getElementById("side-tags-head");
            if (head) head.hidden = !keys.length;

            if (keys.length <= TAGS_SHOWN) NP.tree.tagsExpanded = false;
            var collapsed = NP.tree.tagsCollapsed();
            var toggle = document.getElementById("side-tags-toggle");
            if (toggle) {
                toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
                toggle.title = NP.t(collapsed ? "tree.tagsExpand" : "tree.tagsCollapse");
                if (!toggle._npBound) {
                    toggle._npBound = true;
                    toggle.addEventListener("click", function () {
                        NP.tree.setTagsCollapsed(!NP.tree.tagsCollapsed());
                    });
                }
            }

            var shown = collapsed ? [] : NP.tree.tagsExpanded ? keys : keys.slice(0, TAGS_SHOWN);
            var active = NP.tree.tagFilter;
            if (active && shown.indexOf(active) < 0) shown = shown.concat([active]);
            shown.forEach(function (key) {
                var on = NP.tree.tagFilter === key;
                var b = document.createElement("button");
                b.type = "button";
                b.className = "tag-row" + (on ? " active" : "");
                b.setAttribute("aria-pressed", on ? "true" : "false");
                b.title = NP.t(on ? "tree.tagFilterOff" : "tree.tagFilterOn", { tag: tags[key].name });
                var name = document.createElement("span");
                name.className = "tag-row-name";
                name.textContent = "#" + tags[key].name;
                var n = document.createElement("span");
                n.className = "tag-row-count";
                n.textContent = String(tags[key].count);
                b.appendChild(name);
                b.appendChild(n);
                b.addEventListener("click", function () { NP.tree.setTagFilter(key); });
                list.appendChild(b);
            });

            var rest = keys.length - shown.length;
            if (collapsed || (!NP.tree.tagsExpanded && rest <= 0) || keys.length <= TAGS_SHOWN) return;
            var more = document.createElement("button");
            more.type = "button";
            more.className = "tag-row tag-more";
            more.setAttribute("aria-expanded", NP.tree.tagsExpanded ? "true" : "false");
            more.textContent = NP.tree.tagsExpanded ? NP.t("tree.tagsLess") : NP.t("tree.tagsMore", { n: rest });
            more.addEventListener("click", function () {
                NP.tree.tagsExpanded = !NP.tree.tagsExpanded;
                NP.tree.renderTags();
                /* keyboard focus stays put (or on the heading if the row is gone) */
                var again = list.querySelector(".tag-more") || document.getElementById("side-tags-toggle");
                if (again) again.focus();
            });
            list.appendChild(more);
        },

        /* Unified delete for the context menu and the Delete key.
           explicitId wins (context menu passes the right-clicked id);
           otherwise fall back to selectedId, then currentNoteId so a
           note open without an active tree selection still deletes. */
        deleteSelected: function (explicitId) {
            var data = NP.state.data;
            if (!data || !data.tree) return;
            var id = explicitId || NP.state.selectedId || NP.state.currentNoteId;
            if (!id) return;
            var item = findItemById(data.tree, id);
            if (!item) return;
            var name = item.name || NP.t("tree.thisItem");
            var isFolder = item.type === "folder";
            var skipConfirm = data.confirm_delete === false;
            var msg = isFolder
                ? NP.t("tree.confirmTrashFolder", { name: name })
                : NP.t("tree.confirmTrashNote", { name: name });
            var ask = skipConfirm ? Promise.resolve(true) : NP.dialog.confirm(msg, {
                title: NP.t("dialog.moveToTrashTitle"),
                okLabel: NP.t("dialog.moveToTrash")
            });
            /* Every note that goes to the trash with it (a folder takes its
               whole subtree): their tabs close, the open one included (T1). */
            var goneIds = [];
            (function collect(it) {
                if (it.type === "note") goneIds.push(it.id);
                (it.children || []).forEach(collect);
            })(item);
            return ask.then(function (ok) {
                if (!ok) return;
                var openGone = goneIds.indexOf(NP.state.currentNoteId) !== -1;
                /* What was typed last goes to the trash with the note. */
                var flushed = openGone && NP.editor ? NP.editor.save(true) : Promise.resolve();
                return flushed.then(function () {
                    return NP.api.deleteItem(id);
                }).then(function () {
                    if (NP.tabs) NP.tabs.closeNotes(goneIds);
                    else if (openGone) {
                        NP.state.currentNoteId = null;
                        if (NP.editor) NP.editor.showWelcome();
                    }
                    if (NP.state.selectedId === id || goneIds.indexOf(NP.state.selectedId) !== -1) {
                        NP.state.selectedId = null;
                    }
                    return NP.state.init();
                }).then(function () {
                    NP.tree.render();
                    /* The start page is up: its RECENT list must lose the note too. */
                    if (NP.editor && NP.editor.el && NP.editor.el.querySelector(".welcome-wrap")) {
                        NP.editor.showWelcome();
                    }
                });
            }).catch(NP.dialog.failed);
        },

        _handleContextAction: function (action, id, type) {
            switch (action) {
                case "new-note":
                    NP.dialog.prompt(NP.t("tree.promptNoteName"), {
                        title: NP.t("dialog.newNoteTitle"),
                        okLabel: NP.t("dialog.create")
                    }).then(function (noteName) {
                        if (!noteName) return;
                        NP.tree.tagFilter = null;     /* or the new note would be hidden */
                        return NP.api.newNote(id, noteName).then(function () {
                            NP.state.setFolderOpenState(id, true);
                            return NP.state.init();
                        }).then(function () {
                            NP.tree.render();
                        });
                    }).catch(NP.dialog.failed);
                    break;

                case "new-folder":
                    NP.dialog.prompt(NP.t("tree.promptFolderName"), {
                        title: NP.t("dialog.newFolderTitle"),
                        okLabel: NP.t("dialog.create")
                    }).then(function (folderName) {
                        if (!folderName) return;
                        NP.tree.tagFilter = null;
                        return NP.api.newFolder(id, folderName).then(function () {
                            NP.state.setFolderOpenState(id, true);
                            return NP.state.init();
                        }).then(function () {
                            NP.tree.render();
                        });
                    }).catch(NP.dialog.failed);
                    break;

                case "rename":
                    var current = findItemById(NP.state.data.tree, id);
                    var oldName = current ? current.name : "";
                    NP.dialog.prompt(NP.t("tree.promptNewName"), {
                        title: NP.t("dialog.renameTitle"),
                        okLabel: NP.t("common.rename"),
                        value: oldName
                    }).then(function (newName) {
                        if (!newName || newName === oldName) return;
                        return NP.app.renameNote(id, newName);
                    }).catch(NP.dialog.failed);
                    break;

                case "delete":
                    NP.tree.deleteSelected(id);
                    break;

                case "favorite":
                    NP.api.toggleFavorite(id).then(function () {
                        return NP.state.init();
                    }).then(function () {
                        NP.tree.render();
                    }).catch(NP.dialog.failed);
                    break;
            }
        },

        /* Where a dragged item may land on *targetId*: the wanted
           "before" / "after" / "inside", another one that makes sense, or
           null. A folder never goes into itself or its own subfolder (C3);
           before/after only within the same display group – folders,
           favorite notes, other notes – or the move would look like it did
           nothing (C4). */
        _dropPosition: function (sourceId, targetId, wanted) {
            var tree = (NP.state.data && NP.state.data.tree) || [];
            var source = findItemById(tree, sourceId);
            var target = findItemById(tree, targetId);
            if (!source || !target || sourceId === targetId) return null;
            if (source.type === "folder" && findItemById(source.children || [], targetId)) return null;
            if (wanted === "inside") return target.type === "folder" ? "inside" : null;
            if (groupOf(source) === groupOf(target)) return wanted;
            return target.type === "folder" ? "inside" : null;
        },

        _setupDragDrop: function () {
            var container = NP.$("#tree-container");
            if (!container) return;

            var items = container.querySelectorAll(".tree-item[draggable='true']");
            var dragId = null;
            var dropIndicator = null;

            function removeIndicator() {
                if (dropIndicator && dropIndicator.parentNode) {
                    dropIndicator.parentNode.removeChild(dropIndicator);
                }
                dropIndicator = null;
                /* Remove all highlight classes */
                var all = container.querySelectorAll(".tree-item--drop-target");
                for (var i = 0; i < all.length; i++) {
                    all[i].classList.remove("tree-item--drop-target");
                }
            }

            function createIndicator() {
                var ind = document.createElement("div");
                ind.style.cssText =
                    "height:2px;background:var(--accent);position:absolute;left:8px;right:8px;" +
                    "pointer-events:none;z-index:100;border-radius:1px;";
                return ind;
            }

            for (var i = 0; i < items.length; i++) {
                (function (el) {
                    el.addEventListener("dragstart", function (e) {
                        dragId = el.getAttribute("data-id");
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", dragId);
                        el.style.opacity = "0.4";
                    });

                    el.addEventListener("dragend", function () {
                        el.style.opacity = "";
                        dragId = null;
                        removeIndicator();
                    });

                    el.addEventListener("dragover", function (e) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";

                        removeIndicator();

                        var rect = el.getBoundingClientRect();
                        var y = e.clientY - rect.top;
                        var h = rect.height;
                        var targetId = el.getAttribute("data-id");
                        var isFolder = el.classList.contains("tree-item--folder");
                        var wanted = (isFolder && y > h * 0.25 && y < h * 0.75) ? "inside"
                            : (y <= h * 0.5 ? "before" : "after");
                        var pos = NP.tree._dropPosition(dragId, targetId, wanted);

                        if (!pos) {
                            e.dataTransfer.dropEffect = "none";
                            el.removeAttribute("data-drop-pos");
                        } else if (pos === "inside") {
                            /* Drop inside folder */
                            el.classList.add("tree-item--drop-target");
                            el.setAttribute("data-drop-pos", "inside");
                        } else if (pos === "before") {
                            /* Drop before */
                            dropIndicator = createIndicator();
                            el.style.position = "relative";
                            dropIndicator.style.top = "0";
                            el.appendChild(dropIndicator);
                            el.setAttribute("data-drop-pos", "before");
                        } else {
                            /* Drop after */
                            dropIndicator = createIndicator();
                            el.style.position = "relative";
                            dropIndicator.style.bottom = "0";
                            dropIndicator.style.top = "auto";
                            el.appendChild(dropIndicator);
                            el.setAttribute("data-drop-pos", "after");
                        }
                    });

                    el.addEventListener("dragleave", function () {
                        removeIndicator();
                        el.removeAttribute("data-drop-pos");
                    });

                    el.addEventListener("drop", function (e) {
                        e.preventDefault();
                        removeIndicator();

                        var sourceId = e.dataTransfer.getData("text/plain");
                        var targetId = el.getAttribute("data-id");
                        var position = el.getAttribute("data-drop-pos");
                        el.removeAttribute("data-drop-pos");

                        if (sourceId && targetId && position &&
                                NP.tree._dropPosition(sourceId, targetId, position)) {
                            NP.api.move(sourceId, targetId, position).then(function () {
                                return NP.state.init();
                            }).then(function () {
                                NP.tree.render();
                            }).catch(NP.dialog.failed);   /* never silent (C3) */
                        }
                    });
                })(items[i]);
            }
        }
    };

})(window.NP);

/* tree.js - NoirPad sidebar tree navigation */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var contextMenu = null;

    function removeContextMenu() {
        if (contextMenu && contextMenu.parentNode) {
            contextMenu.parentNode.removeChild(contextMenu);
        }
        contextMenu = null;
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
        var content = NP.state.data.notes[id];
        if (typeof content !== "string") return false;
        try {
            var obj = JSON.parse(content);
            return obj && obj.encrypted === true;
        } catch (e) {
            return false;
        }
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
            var el = document.querySelector(
                "#tree-container .tree-item[data-id='" + noteId + "']"
            );
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

            container.innerHTML = "";

            var data = NP.state.data;
            if (!data || !data.tree) return;

            var items = sortItems(data.tree);
            for (var i = 0; i < items.length; i++) {
                NP.tree._renderItem(items[i], 0, container);
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
            var div = document.createElement("div");
            div.className = "tree-item";
            div.setAttribute("data-id", item.id);
            div.setAttribute("draggable", "true");
            div.style.paddingLeft = (depth * 20) + "px";

            var favs = (NP.state.data && NP.state.data.favorites) || [];
            var isFav = favs.indexOf(item.id) !== -1;
            var isFolder = item.type === "folder";
            var isSelected = NP.state.selectedId === item.id;
            var locked = !isFolder && isEncrypted(item.id);

            if (isFolder) {
                div.className += " tree-item--folder";
            } else {
                div.className += " tree-item--note";
                div.style.paddingLeft = (depth * 20 + 20) + "px";
            }

            if (isSelected) {
                div.className += " selected";
            }

            /* Build inner HTML */
            var html = "";

            if (isFolder) {
                var isOpen = NP.state.getFolderOpenState(item.id);
                var arrow = isOpen ? "\u25bd" : "\u25b7";
                html += "<span class='tree-arrow' style='margin-right:4px;cursor:pointer;font-size:10px;'>" + arrow + "</span>";
                html += "<span style='margin-right:4px;'>&#128193;</span>";
                if (isFav) html += "<span style='color:var(--accent);margin-right:2px;'>\u2605</span>";
                html += "<span style='font-weight:bold;color:var(--fg-bright);'>" + NP.escapeHtml(item.name) + "</span>";
            } else {
                html += "<span style='margin-right:4px;font-size:8px;color:var(--fg-dim);'>\u25c6</span>";
                if (isFav) html += "<span style='color:var(--accent);margin-right:2px;'>\u2605</span>";
                if (locked) html += "<span style='margin-right:2px;'>\ud83d\udd12</span>";
                html += "<span style='color:var(--fg-dim);'>" + NP.escapeHtml(item.name) + "</span>";
            }

            div.innerHTML = html;

            /* Click handler */
            div.addEventListener("click", function (e) {
                NP.tree._onItemClick(e, item.id, item.type);
                e.stopPropagation();
            });

            /* Right-click handler */
            div.addEventListener("contextmenu", function (e) {
                e.preventDefault();
                NP.tree._onRightClick(e, item.id, item.type);
            });

            container.appendChild(div);

            /* Render children if folder is open */
            if (isFolder && item.children && NP.state.getFolderOpenState(item.id)) {
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
                    });
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
                    NP.editor.loadNote(item.id);
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
                NP.state.currentNoteId = id;
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
            removeContextMenu();

            var menu = document.createElement("div");
            menu.style.cssText =
                "position:fixed;z-index:9999;min-width:160px;padding:4px 0;" +
                "background:var(--bg-light);border:1px solid var(--border);" +
                "border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.5);";
            menu.style.left = e.clientX + "px";
            menu.style.top = e.clientY + "px";

            var items = [];
            if (type === "folder") {
                items = [
                    { label: NP.t("tree.contextMenu.newNote"), action: "new-note" },
                    { label: NP.t("tree.contextMenu.newFolder"), action: "new-folder" },
                    { label: NP.t("common.rename"), action: "rename" },
                    { label: NP.t("common.delete"), action: "delete" }
                ];
            } else {
                items = [
                    { label: NP.t("common.rename"), action: "rename" },
                    { label: NP.t(((NP.state.data && NP.state.data.favorites) || []).indexOf(id) !== -1
                        ? "tree.contextMenu.removeFavorite" : "tree.contextMenu.addFavorite"), action: "favorite" },
                    { label: NP.t("common.delete"), action: "delete" }
                ];
            }

            for (var i = 0; i < items.length; i++) {
                (function (item) {
                    var opt = document.createElement("div");
                    opt.style.cssText =
                        "padding:6px 16px;cursor:pointer;color:var(--fg);font-size:13px;" +
                        "white-space:nowrap;";
                    opt.textContent = item.label;
                    opt.addEventListener("mouseenter", function () {
                        opt.style.background = "var(--hover-bg)";
                    });
                    opt.addEventListener("mouseleave", function () {
                        opt.style.background = "none";
                    });
                    opt.addEventListener("click", function (ev) {
                        ev.stopPropagation();
                        removeContextMenu();
                        NP.tree._handleContextAction(item.action, id, type);
                    });
                    menu.appendChild(opt);
                })(items[i]);
            }

            document.body.appendChild(menu);
            contextMenu = menu;

            /* Clamp menu to viewport */
            var rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
                menu.style.left = (window.innerWidth - rect.width - 4) + "px";
            }
            if (rect.bottom > window.innerHeight) {
                menu.style.top = (window.innerHeight - rect.height - 4) + "px";
            }

            /* Close on click outside */
            setTimeout(function () {
                document.addEventListener("click", removeContextMenu, { once: true });
            }, 0);
        },

        /* Unified delete for #btn-delete, context menu, and Delete key.
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
            return ask.then(function (ok) {
                if (!ok) return;
                return NP.api.deleteItem(id).then(function () {
                    if (NP.state.currentNoteId === id) {
                        NP.state.currentNoteId = null;
                        if (NP.tabs) NP.tabs.close(id);
                        if (NP.editor) NP.editor.showWelcome();
                    }
                    if (NP.state.selectedId === id) {
                        NP.state.selectedId = null;
                    }
                    return NP.state.init();
                }).then(function () {
                    NP.tree.render();
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
                        return NP.api.rename(id, newName).then(function () {
                            return NP.state.init();
                        }).then(function () {
                            NP.tree.render();
                            if (NP.tabs) NP.tabs.render();
                        });
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

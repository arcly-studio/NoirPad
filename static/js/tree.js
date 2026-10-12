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

    function sortItems(items) {
        var favs = (NP.state.data && NP.state.data.favorites) || [];
        var sorted = items.slice();
        sorted.sort(function (a, b) {
            var aFav = favs.indexOf(a.id) !== -1 ? 0 : 1;
            var bFav = favs.indexOf(b.id) !== -1 ? 0 : 1;
            if (aFav !== bFav) return aFav - bFav;
            return 0;
        });
        return sorted;
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
                header.style.cssText = "padding:4px 12px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--fg-dim);opacity:0.6;user-select:none;";
                header.textContent = NP.t("tree.trashHeader");
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
            div.style.opacity = "0.5";

            var isFolder = item.type === "folder";
            var html = "";

            if (isFolder) {
                html += "<span style='margin-right:4px;'>&#128193;</span>";
            } else {
                html += "<span style='margin-right:4px;font-size:8px;color:var(--fg-dim);'>\u25c6</span>";
            }
            html += "<span style='color:var(--fg-dim);'>" + NP.escapeHtml(item.name) + "</span>";
            html += "<span class='tree-trash-restore' style='margin-left:auto;cursor:pointer;padding:0 3px;color:var(--fg-dim);font-size:11px;' title='" + NP.escapeHtml(NP.t("common.restore")) + "'>\u21a9</span>";
            html += "<span class='tree-trash-delete' style='cursor:pointer;padding:0 3px;color:var(--fg-dim);font-size:10px;' title='" + NP.escapeHtml(NP.t("tree.deletePermanently")) + "'>\u00d7</span>";

            div.style.display = "flex";
            div.style.alignItems = "center";
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
                    if (!confirm(NP.t("tree.confirmDeletePermanently", { name: item.name }))) return;
                    NP.api.deleteTrashItem(item.id).then(function () {
                        return NP.state.init();
                    }).then(function () {
                        NP.tree.render();
                    });
                });
            }

            /* Click on trash item to view (read-only) */
            div.addEventListener("click", function (e) {
                if (e.target.classList.contains("tree-trash-restore") ||
                    e.target.classList.contains("tree-trash-delete")) return;
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
                if (onArrow) {
                    /* Chevron ▾▸ → expand/collapse only (no selection) */
                    NP.state.setFolderOpenState(
                        id, !NP.state.getFolderOpenState(id)
                    );
                } else {
                    /* Name/icon → select the folder (no expand/collapse) */
                    NP.state.selectedId = id;
                }
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
                    { label: NP.t("tree.contextMenu.toggleFavorite"), action: "favorite" },
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
            if (!skipConfirm && !confirm(msg)) return;
            NP.api.deleteItem(id).then(function () {
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
        },

        _handleContextAction: function (action, id, type) {
            switch (action) {
                case "new-note":
                    var noteName = prompt(NP.t("tree.promptNoteName"));
                    if (noteName) {
                        NP.api.newNote(id, noteName).then(function () {
                            NP.state.setFolderOpenState(id, true);
                            return NP.state.init();
                        }).then(function () {
                            NP.tree.render();
                        });
                    }
                    break;

                case "new-folder":
                    var folderName = prompt(NP.t("tree.promptFolderName"));
                    if (folderName) {
                        NP.api.newFolder(id, folderName).then(function () {
                            NP.state.setFolderOpenState(id, true);
                            return NP.state.init();
                        }).then(function () {
                            NP.tree.render();
                        });
                    }
                    break;

                case "rename":
                    var newName = prompt(NP.t("tree.promptNewName"));
                    if (newName) {
                        NP.api.rename(id, newName).then(function () {
                            return NP.state.init();
                        }).then(function () {
                            NP.tree.render();
                            if (NP.tabs) NP.tabs.render();
                        });
                    }
                    break;

                case "delete":
                    NP.tree.deleteSelected(id);
                    break;

                case "favorite":
                    NP.api.toggleFavorite(id).then(function () {
                        return NP.state.init();
                    }).then(function () {
                        NP.tree.render();
                    });
                    break;
            }
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

                        if (isFolder && y > h * 0.25 && y < h * 0.75) {
                            /* Drop inside folder */
                            el.classList.add("tree-item--drop-target");
                            el.setAttribute("data-drop-pos", "inside");
                        } else if (y <= h * 0.5) {
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
                        var position = el.getAttribute("data-drop-pos") || "after";
                        el.removeAttribute("data-drop-pos");

                        if (sourceId && targetId && sourceId !== targetId) {
                            NP.api.move(sourceId, targetId, position).then(function () {
                                return NP.state.init();
                            }).then(function () {
                                NP.tree.render();
                            });
                        }
                    });
                })(items[i]);
            }
        }
    };

})(window.NP);

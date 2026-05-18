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

    NP.tree = {
        render: function () {
            var container = NP.$("#tree-container");
            if (!container) return;
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
                header.textContent = "Trash";
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
            var isSelected = NP.state.currentNoteId === item.id;
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
                NP.tree._onItemClick(item.id, item.type);
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
            html += "<span class='tree-trash-restore' style='margin-left:auto;cursor:pointer;padding:0 3px;color:var(--fg-dim);font-size:11px;' title='Restore'>\u21a9</span>";
            html += "<span class='tree-trash-delete' style='cursor:pointer;padding:0 3px;color:var(--fg-dim);font-size:10px;' title='Delete permanently'>\u00d7</span>";

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
                    if (!confirm("Permanently delete '" + item.name + "'? This cannot be undone.")) return;
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

        _onItemClick: function (id, type) {
            if (type === "folder") {
                var isOpen = NP.state.getFolderOpenState(id);
                NP.state.setFolderOpenState(id, !isOpen);
                NP.tree.render();
            } else {
                NP.state.currentNoteId = id;
                if (NP.tabs) {
                    var item = findItemById(NP.state.data.tree, id);
                    var name = item ? item.name : "Note";
                    NP.tabs.add(id, name);
                } else if (NP.editor) {
                    /* Only call loadNote directly if tabs module is not available */
                    NP.editor.loadNote(id);
                }
                NP.tree.render();
            }
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
                    { label: "New Note", action: "new-note" },
                    { label: "New Folder", action: "new-folder" },
                    { label: "Rename", action: "rename" },
                    { label: "Delete", action: "delete" }
                ];
            } else {
                items = [
                    { label: "Rename", action: "rename" },
                    { label: "Toggle Favorite", action: "favorite" },
                    { label: "Delete", action: "delete" }
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

        _handleContextAction: function (action, id, type) {
            switch (action) {
                case "new-note":
                    var noteName = prompt("Note name:");
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
                    var folderName = prompt("Folder name:");
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
                    var newName = prompt("New name:");
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
                    var delItem = findItemById(NP.state.data.tree, id);
                    var delName = delItem ? delItem.name : "this item";
                    if (confirm("Move '" + delName + "' to trash?")) {
                        NP.api.deleteItem(id).then(function () {
                            if (NP.state.currentNoteId === id) {
                                NP.state.currentNoteId = null;
                                if (NP.tabs) NP.tabs.close(id);
                                if (NP.editor) NP.editor.showWelcome();
                            }
                            return NP.state.init();
                        }).then(function () {
                            NP.tree.render();
                        });
                    }
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

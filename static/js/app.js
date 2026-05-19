/* app.js - NoirPad main entry point */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    NP.app = {
        init: function () {
            /* Restore CRT state immediately (before any rendering) */
            if (NP.effects && NP.effects.crtRestore) NP.effects.crtRestore();

            return NP.state.init().then(function () {
                NP.themes.apply(NP.state.data.theme || "matrix");

                /* Initialize modules */
                if (NP.settings && NP.settings.init) NP.settings.init();
                /* Settings v2: apply persisted runtime state (matrix rain,
                   shortcut hints, spellcheck, page orientation) now that
                   NP.state.data is loaded. */
                if (NP.settings && NP.settings.applyRuntimeState) {
                    NP.settings.applyRuntimeState();
                }
                if (NP.editor && NP.editor.init) NP.editor.init();
                if (NP.images && NP.images.init) NP.images.init();
                /* cursor.js disabled while debugging "dot" report */
                /* if (NP.cursor && NP.cursor.init) NP.cursor.init(); */

                if (NP.tree && NP.tree.render) {
                    NP.tree.render();
                }

                if (NP.splash && NP.splash.show) {
                    NP.splash.show();
                }

                NP.app.bindKeys();
                NP.app.bindButtons();
                NP.state.startPolling();

                if (NP.editor && NP.editor.showWelcome) {
                    NP.editor.showWelcome();
                }
            }).catch(function (err) {
                console.error("NoirPad init failed:", err);
                /* Hide splash and surface the error so the user isn't stuck on "Loading..." */
                var splash = document.getElementById("splash-overlay");
                if (splash) {
                    var sub = document.getElementById("splash-subtitle");
                    if (sub) sub.textContent = "Failed to reach server: " + (err && err.message ? err.message : err);
                    setTimeout(function () {
                        if (splash.parentNode) splash.parentNode.removeChild(splash);
                    }, 3000);
                }
            });
        },

        bindKeys: function () {
            document.addEventListener("keydown", function (e) {
                var key = e.key;
                var ctrl = e.ctrlKey || e.metaKey;
                var shift = e.shiftKey;

                /* Ctrl+S - Save */
                if (ctrl && !shift && key === "s") {
                    e.preventDefault();
                    if (NP.editor && NP.editor.save) {
                        NP.editor.save();
                    }
                    return;
                }

                /* Ctrl+F - Find */
                if (ctrl && !shift && key === "f") {
                    e.preventDefault();
                    if (NP.search && NP.search.toggle) {
                        NP.search.toggle();
                    }
                    return;
                }

                /* Ctrl+B - Focus mode */
                if (ctrl && !shift && key === "b") {
                    e.preventDefault();
                    if (NP.focusMode && NP.focusMode.toggle) {
                        NP.focusMode.toggle();
                    }
                    return;
                }

                /* Ctrl+Shift+P - Command bar */
                if (ctrl && shift && key === "P") {
                    e.preventDefault();
                    if (NP.commandBar && NP.commandBar.toggle) {
                        NP.commandBar.toggle();
                    }
                    return;
                }

                /* Ctrl+L - Toggle orientation */
                if (ctrl && !shift && key === "l") {
                    e.preventDefault();
                    if (NP.layout && NP.layout.toggleOrientation) {
                        NP.layout.toggleOrientation();
                    }
                    return;
                }

                /* F1 - Help */
                if (key === "F1") {
                    e.preventDefault();
                    if (NP.help && NP.help.show) {
                        NP.help.show();
                    }
                    return;
                }

                /* F2 - Rename */
                if (key === "F2") {
                    e.preventDefault();
                    if (NP.tree && NP.tree.renameSelected) {
                        NP.tree.renameSelected();
                    }
                    return;
                }

                /* F3 - Find next, Shift+F3 - Find previous */
                if (key === "F3") {
                    e.preventDefault();
                    if (NP.search) {
                        if (shift && NP.search.prev) {
                            NP.search.prev();
                        } else if (NP.search.next) {
                            NP.search.next();
                        }
                    }
                    return;
                }

                /* F11 - Fullscreen */
                if (key === "F11") {
                    e.preventDefault();
                    if (NP.fullscreen && NP.fullscreen.toggle) {
                        NP.fullscreen.toggle();
                    }
                    return;
                }

                /* Delete - Delete selected item */
                if (key === "Delete" && !ctrl && !shift) {
                    var active = document.activeElement;
                    var isInput =
                        active &&
                        (active.tagName === "INPUT" ||
                            active.tagName === "TEXTAREA" ||
                            active.isContentEditable);
                    if (!isInput && NP.tree && NP.tree.deleteSelected) {
                        e.preventDefault();
                        NP.tree.deleteSelected();
                    }
                    return;
                }

                /* Escape - Close overlays */
                if (key === "Escape") {
                    if (NP.commandBar && NP.commandBar.visible && NP.commandBar.close) {
                        NP.commandBar.close();
                    } else if (NP.search && NP.search.visible && NP.search.hide) {
                        NP.search.hide();
                    }
                    return;
                }

                /* Ctrl+Tab - Next tab */
                if (ctrl && !shift && key === "Tab") {
                    e.preventDefault();
                    if (NP.tabs && NP.tabs.next) {
                        NP.tabs.next();
                    }
                    return;
                }

                /* Ctrl+Shift+Tab - Previous tab */
                if (ctrl && shift && key === "Tab") {
                    e.preventDefault();
                    if (NP.tabs && NP.tabs.prev) {
                        NP.tabs.prev();
                    }
                    return;
                }

                /* Ctrl+W - Close tab */
                if (ctrl && !shift && key === "w") {
                    e.preventDefault();
                    if (NP.tabs && NP.tabs.closeCurrent) {
                        NP.tabs.closeCurrent();
                    }
                    return;
                }

                /* Ctrl+I - Italic */
                if (ctrl && !shift && key === "i") {
                    e.preventDefault();
                    if (NP.editor && NP.editor.toggleItalic) {
                        NP.editor.toggleItalic();
                    }
                    return;
                }

                /* Ctrl+U - Underline */
                if (ctrl && !shift && key === "u") {
                    e.preventDefault();
                    if (NP.editor && NP.editor.toggleUnderline) {
                        NP.editor.toggleUnderline();
                    }
                    return;
                }

                /* Ctrl+Z - Undo */
                if (ctrl && !shift && key === "z") {
                    /* Let browser handle native undo in contenteditable/textarea */
                    if (NP.editor && NP.editor.undo) {
                        e.preventDefault();
                        NP.editor.undo();
                    }
                    return;
                }

                /* Ctrl+Y - Redo */
                if (ctrl && !shift && key === "y") {
                    if (NP.editor && NP.editor.redo) {
                        e.preventDefault();
                        NP.editor.redo();
                    }
                    return;
                }
            });
        },

        bindButtons: function () {
            /* Title input — readonly until a note is selected */
            var titleInput = NP.$("#note-title-input");
            if (titleInput) {
                titleInput.readOnly = true;
                titleInput.addEventListener("change", function () {
                    if (NP.state.currentNoteId && titleInput.value.trim()) {
                        NP.api.rename(NP.state.currentNoteId, titleInput.value.trim()).then(function () {
                            /* Update local tree data */
                            var item = NP.editor._findItemInTree(NP.state.data.tree, NP.state.currentNoteId);
                            if (item) item.name = titleInput.value.trim();
                            if (NP.tree && NP.tree.render) NP.tree.render();
                            if (NP.tabs && NP.tabs.render) {
                                /* Update tab name */
                                var tabs = NP.state.openTabs || (NP.tabs._tabs || []);
                                for (var i = 0; i < tabs.length; i++) {
                                    if (tabs[i].id === NP.state.currentNoteId) {
                                        tabs[i].name = titleInput.value.trim();
                                        break;
                                    }
                                }
                                NP.tabs.render();
                            }
                        });
                    }
                });
            }

            /* Sidebar buttons */
            var btnNewFolder = NP.$("#btn-new-folder");
            if (btnNewFolder) {
                btnNewFolder.addEventListener("click", function () {
                    var name = prompt("Folder name:");
                    if (!name) return;
                    var parentId = NP.state.currentNoteId ? null : null;
                    NP.api.newFolder(parentId, name).then(function () {
                        return NP.state.init();
                    }).then(function () {
                        NP.tree.render();
                    });
                });
            }

            var btnNewNote = NP.$("#btn-new-note");
            if (btnNewNote) {
                btnNewNote.addEventListener("click", function () {
                    var name = prompt("Note name:");
                    if (!name) return;
                    NP.api.newNote(null, name).then(function (res) {
                        return NP.state.init().then(function () {
                            NP.tree.render();
                            if (res && res.id) {
                                NP.editor.loadNote(res.id);
                                if (NP.tabs) NP.tabs.add(res.id, name);
                            }
                        });
                    });
                });
            }

            var btnDelete = NP.$("#btn-delete");
            if (btnDelete) {
                btnDelete.addEventListener("click", function () {
                    if (!NP.state.currentNoteId) return;
                    var item = NP.editor._findItemInTree(NP.state.data.tree, NP.state.currentNoteId);
                    var itemName = item ? item.name : "this item";
                    /* Settings v2: confirm_delete (default true — only an
                       explicit false skips the confirm dialog). */
                    var skipConfirm = NP.state.data &&
                        NP.state.data.confirm_delete === false;
                    if (!skipConfirm && !confirm("Move '" + itemName + "' to trash?")) return;
                    NP.api.deleteItem(NP.state.currentNoteId).then(function () {
                        if (NP.tabs) NP.tabs.close(NP.state.currentNoteId);
                        NP.state.currentNoteId = null;
                        return NP.state.init();
                    }).then(function () {
                        NP.tree.render();
                        if (NP.editor) NP.editor.showWelcome();
                    });
                });
            }

            var btnRename = NP.$("#btn-rename");
            if (btnRename) {
                btnRename.addEventListener("click", function () {
                    if (!NP.state.currentNoteId) return;
                    var item = NP.editor._findItemInTree(NP.state.data.tree, NP.state.currentNoteId);
                    var oldName = item ? item.name : "";
                    var newName = prompt("New name:", oldName);
                    if (!newName || newName === oldName) return;
                    NP.api.rename(NP.state.currentNoteId, newName).then(function () {
                        if (item) item.name = newName;
                        if (titleInput) titleInput.value = newName;
                        NP.tree.render();
                        if (NP.tabs) NP.tabs.render();
                    });
                });
            }

            /* Focus mode button (back in the top bar — same #btn-focus id,
               so this handler attaches to the top-bar element). */
            var btnFocus = NP.$("#btn-focus");
            if (btnFocus) {
                btnFocus.addEventListener("click", function () {
                    if (NP.focusMode && NP.focusMode.toggle) NP.focusMode.toggle();
                });
            }

            /* Sidebar Backup button — download the .zip backup. Reuses the
               app's established download path (anchor download, no SPA
               navigation); same as Settings "Download backup" / :backup. */
            var btnBackup = NP.$("#btn-backup");
            if (btnBackup) {
                btnBackup.addEventListener("click", function () {
                    if (NP.backup && NP.backup.download) {
                        NP.backup.download();
                    } else if (NP.api && NP.api.downloadBackup) {
                        NP.api.downloadBackup();
                    } else {
                        window.location.href = "/api/backup";
                    }
                });
            }

            /* Settings button — opens the Settings panel */
            var btnSettings = NP.$("#btn-settings");
            if (btnSettings) {
                btnSettings.addEventListener("click", function () {
                    if (NP.settings && NP.settings.open) NP.settings.open();
                });
            }

            /* Header buttons */
            var btnHelp = NP.$("#btn-help");
            if (btnHelp) {
                btnHelp.addEventListener("click", function () {
                    if (NP.help && NP.help.show) NP.help.show();
                });
            }

            var btnFont = NP.$("#btn-font");
            if (btnFont) {
                btnFont.addEventListener("click", function () {
                    if (NP.fontPicker && NP.fontPicker.show) NP.fontPicker.show();
                });
            }

            var btnFavorite = NP.$("#btn-favorite");
            if (btnFavorite) {
                btnFavorite.addEventListener("click", function () {
                    if (NP.favorites && NP.favorites.toggle) NP.favorites.toggle();
                });
            }

            var btnLock = NP.$("#btn-lock");
            if (btnLock) {
                btnLock.addEventListener("click", function () {
                    if (!NP.encryption) return;
                    var noteId = NP.state.currentNoteId;
                    if (!noteId) return;
                    if (NP.encryption.isEncrypted(noteId)) {
                        NP.encryption.decrypt();
                    } else {
                        NP.encryption.encrypt();
                    }
                });
            }

            var btnInsertImage = NP.$("#btn-insert-image");
            if (btnInsertImage) {
                btnInsertImage.addEventListener("click", function () {
                    var input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/*";
                    input.onchange = function () {
                        if (input.files[0] && NP.images && NP.images.upload) {
                            NP.images.upload(input.files[0]);
                        }
                    };
                    input.click();
                });
            }

            /* Autosave toggle */
            var btnAutosave = NP.$("#autosave-toggle");
            var autosaveIndicator = NP.$("#autosave-indicator");
            function refreshAutosaveIndicator() {
                if (!autosaveIndicator) return;
                var on = !!(NP.state.data && NP.state.data.autosave);
                autosaveIndicator.style.color = on ? "var(--accent)" : "var(--fg-dim)";
                autosaveIndicator.style.opacity = on ? "1" : "0.4";
            }
            refreshAutosaveIndicator();
            if (btnAutosave) {
                btnAutosave.style.cursor = "pointer";
                btnAutosave.addEventListener("click", function () {
                    if (!NP.state.data) return;
                    var enabled = !NP.state.data.autosave;
                    NP.state.data.autosave = enabled;
                    NP.api.saveSettings({ autosave: enabled });
                    refreshAutosaveIndicator();
                    if (enabled && NP.editor) {
                        NP.editor.startAutosave();
                    } else if (NP.editor) {
                        NP.editor.stopAutosave();
                    }
                });
            }
        }
    };

    document.addEventListener("DOMContentLoaded", function () {
        NP.app.init();
    });

})(window.NP);

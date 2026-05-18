/* command-bar.js - NoirPad command palette (Ctrl+Shift+P) */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var COMMANDS = [
        { cmd: ":search", hint: "<text>", desc: "Search in note" },
        { cmd: ":new note", hint: "<name>", desc: "Create new note" },
        { cmd: ":new folder", hint: "<name>", desc: "Create new folder" },
        { cmd: ":theme", hint: "<name>", desc: "Switch theme" },
        { cmd: ":encrypt", hint: "", desc: "Encrypt current note" },
        { cmd: ":decrypt", hint: "", desc: "Decrypt current note" },
        { cmd: ":fullscreen", hint: "", desc: "Toggle fullscreen" },
        { cmd: ":autosave", hint: "", desc: "Toggle autosave" },
        { cmd: ":export", hint: "", desc: "Export as TXT" },
        { cmd: ":exportpdf", hint: "", desc: "Export as PDF" },
        { cmd: ":exporthtml", hint: "", desc: "Export as HTML" },
        { cmd: ":focus", hint: "", desc: "Toggle focus mode" },
        { cmd: ":tag", hint: "<name>", desc: "Add tag to note" },
        { cmd: ":tags", hint: "", desc: "Show all tags" },
        { cmd: ":fontsize", hint: "<N>", desc: "Set font size (6-72)" },
        { cmd: ":font", hint: "", desc: "Open font picker" },
        { cmd: ":backup", hint: "", desc: "Download backup" },
        { cmd: ":import", hint: "", desc: "Import backup" },
        { cmd: ":fav", hint: "", desc: "Toggle favorite" },
        { cmd: ":emptytrash", hint: "", desc: "Empty trash" },
        { cmd: ":orientation", hint: "", desc: "Toggle page orientation" },
        { cmd: ":matrix", hint: "", desc: "Toggle matrix rain" },
        { cmd: ":help", hint: "", desc: "Show help" },
        { cmd: ":closetab", hint: "", desc: "Close current tab" },
        { cmd: ":closeall", hint: "", desc: "Close all tabs" },
        { cmd: ":crt", hint: "", desc: "Toggle CRT scanlines" },
        { cmd: ":findall", hint: "<text>", desc: "Search across all notes" }
    ];

    var overlay = null;
    var input = null;
    var dropdown = null;
    var selectedIdx = -1;

    function ensureDOM() {
        if (overlay) return;

        overlay = document.createElement("div");
        overlay.className = "np-command-overlay";
        overlay.style.cssText =
            "position:fixed;top:0;left:0;right:0;bottom:0;z-index:9000;" +
            "background:rgba(0,0,0,0.5);display:none;";

        var bar = document.createElement("div");
        bar.className = "np-command-bar";
        bar.style.cssText =
            "position:absolute;top:0;left:50%;transform:translateX(-50%) translateY(-100%);" +
            "width:500px;max-width:90vw;background:var(--bg-dark,#0a0a0a);" +
            "border:1px solid var(--accent,#00ff41);border-top:none;border-radius:0 0 8px 8px;" +
            "padding:8px;transition:transform 0.2s ease;";

        input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Type a command (e.g. :search, :theme amber)";
        input.style.cssText =
            "width:100%;box-sizing:border-box;padding:8px 12px;" +
            "background:var(--bg,#000);color:var(--fg,#00ff41);" +
            "border:1px solid var(--fg-dim,#006b1d);border-radius:4px;" +
            "font-family:var(--font-mono,'Consolas',monospace);font-size:14px;outline:none;";

        dropdown = document.createElement("div");
        dropdown.className = "np-command-dropdown";
        dropdown.style.cssText =
            "max-height:260px;overflow-y:auto;margin-top:4px;display:none;";

        bar.appendChild(input);
        bar.appendChild(dropdown);
        overlay.appendChild(bar);
        document.body.appendChild(overlay);

        input.addEventListener("input", onInput);
        input.addEventListener("keydown", onKeydown);
        overlay.addEventListener("mousedown", function (e) {
            if (e.target === overlay) NP.commandBar.close();
        });

        /* Force reflow then animate in */
        overlay._bar = bar;
    }

    function onInput() {
        var val = input.value.trim().toLowerCase();
        selectedIdx = -1;
        if (!val) {
            dropdown.style.display = "none";
            return;
        }
        var matches = COMMANDS.filter(function (c) {
            return c.cmd.indexOf(val) !== -1 || c.desc.toLowerCase().indexOf(val) !== -1;
        });
        /* Also check theme names */
        if (NP.THEMES) {
            Object.keys(NP.THEMES).forEach(function (t) {
                if (t.indexOf(val) !== -1) {
                    matches.push({ cmd: t, hint: "", desc: "Apply theme" });
                }
            });
        }
        renderDropdown(matches);
    }

    function renderDropdown(matches) {
        if (!matches.length) {
            dropdown.style.display = "none";
            return;
        }
        dropdown.innerHTML = "";
        dropdown.style.display = "block";
        matches.forEach(function (m, i) {
            var item = document.createElement("div");
            item.className = "np-command-item";
            item.style.cssText =
                "padding:6px 10px;cursor:pointer;font-family:var(--font-mono,'Consolas',monospace);" +
                "font-size:13px;color:var(--fg,#00ff41);border-radius:3px;";
            item.textContent = m.cmd + (m.hint ? " " + m.hint : "") + "  \u2014 " + m.desc;
            item.addEventListener("mouseenter", function () {
                highlightItem(i);
            });
            item.addEventListener("click", function () {
                input.value = m.cmd + " ";
                input.focus();
                if (!m.hint) {
                    NP.commandBar.execute(m.cmd);
                }
            });
            dropdown.appendChild(item);
        });
    }

    function highlightItem(idx) {
        var items = dropdown.children;
        for (var i = 0; i < items.length; i++) {
            items[i].style.background = i === idx ? "var(--select-bg,#003300)" : "transparent";
        }
        selectedIdx = idx;
    }

    function onKeydown(e) {
        var items = dropdown.children;
        if (e.key === "Escape") {
            e.preventDefault();
            NP.commandBar.close();
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (items.length) {
                selectedIdx = (selectedIdx + 1) % items.length;
                highlightItem(selectedIdx);
            }
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            if (items.length) {
                selectedIdx = selectedIdx <= 0 ? items.length - 1 : selectedIdx - 1;
                highlightItem(selectedIdx);
            }
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            if (selectedIdx >= 0 && items.length) {
                items[selectedIdx].click();
                return;
            }
            var val = input.value.trim();
            if (!val) {
                NP.commandBar.close();
                return;
            }
            NP.commandBar.execute(val);
            return;
        }
    }

    function getSelectedFolderId() {
        if (NP.state && NP.state.currentNoteId && NP.state.data) {
            /* Walk tree to find parent folder */
            return NP.tree && NP.tree.getParentId
                ? NP.tree.getParentId(NP.state.currentNoteId)
                : null;
        }
        return null;
    }

    NP.commandBar = {
        visible: false,

        open: function () {
            ensureDOM();
            overlay.style.display = "block";
            NP.commandBar.visible = true;
            input.value = "";
            dropdown.style.display = "none";
            selectedIdx = -1;
            /* Trigger slide-in */
            requestAnimationFrame(function () {
                overlay._bar.style.transform = "translateX(-50%) translateY(0)";
            });
            setTimeout(function () { input.focus(); }, 50);
        },

        close: function () {
            if (!overlay) return;
            NP.commandBar.visible = false;
            overlay._bar.style.transform = "translateX(-50%) translateY(-100%)";
            setTimeout(function () {
                overlay.style.display = "none";
            }, 200);
        },

        toggle: function () {
            if (NP.commandBar.visible) {
                NP.commandBar.close();
            } else {
                NP.commandBar.open();
            }
        },

        execute: function (cmd) {
            cmd = cmd.trim();
            var lower = cmd.toLowerCase();

            /* Theme name without colon */
            if (NP.THEMES && NP.THEMES[lower]) {
                NP.themes.apply(lower);
                NP.commandBar.close();
                return;
            }

            /* Commands with arguments */
            if (lower.indexOf(":search ") === 0) {
                var q = cmd.substring(8).trim();
                if (q && NP.search) NP.search.find(q);
            } else if (lower.indexOf(":new note ") === 0) {
                var noteName = cmd.substring(10).trim();
                if (noteName && NP.api) NP.api.newNote(getSelectedFolderId(), noteName).then(function () {
                    if (NP.state) NP.state.poll();
                    if (NP.tree) NP.tree.render();
                });
            } else if (lower.indexOf(":new folder ") === 0) {
                var folderName = cmd.substring(12).trim();
                if (folderName && NP.api) NP.api.newFolder(getSelectedFolderId(), folderName).then(function () {
                    if (NP.state) NP.state.poll();
                    if (NP.tree) NP.tree.render();
                });
            } else if (lower.indexOf(":theme ") === 0) {
                var theme = cmd.substring(7).trim().toLowerCase();
                if (NP.themes) NP.themes.apply(theme);
            } else if (lower === ":encrypt") {
                if (NP.encryption) NP.encryption.encrypt();
            } else if (lower === ":decrypt") {
                if (NP.encryption) NP.encryption.decrypt();
            } else if (lower === ":fullscreen") {
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(function () {});
                } else {
                    document.exitFullscreen().catch(function () {});
                }
            } else if (lower === ":autosave") {
                if (NP.state && NP.state.data) {
                    NP.state.data.autosave = !NP.state.data.autosave;
                    if (NP.api) NP.api.saveSettings({ autosave: NP.state.data.autosave });
                }
            } else if (lower === ":export") {
                if (NP.export) NP.export.txt();
            } else if (lower === ":exportpdf") {
                if (NP.status && NP.status.show) {
                    NP.status.show("PDF export not available in web");
                } else {
                    alert("PDF export not available in web");
                }
            } else if (lower === ":exporthtml") {
                if (NP.export) NP.export.html();
            } else if (lower === ":focus") {
                if (NP.focusMode && NP.focusMode.toggle) NP.focusMode.toggle();
                else if (NP.focus && NP.focus.toggle) NP.focus.toggle();
            } else if (lower.indexOf(":tag ") === 0) {
                var tag = cmd.substring(5).trim();
                if (tag && NP.tags) NP.tags.addTag(tag);
            } else if (lower === ":tags") {
                if (NP.tags) NP.tags.showAll();
            } else if (lower.indexOf(":fontsize ") === 0) {
                var size = parseInt(cmd.substring(10).trim(), 10);
                if (size >= 6 && size <= 72) {
                    var editor = document.getElementById("editor");
                    if (editor) editor.style.fontSize = size + "px";
                    if (NP.api) NP.api.saveSettings({ font_size: size });
                    if (NP.state && NP.state.data) NP.state.data.font_size = size;
                }
            } else if (lower === ":font") {
                if (NP.fontPicker && NP.fontPicker.show) NP.fontPicker.show();
            } else if (lower === ":backup") {
                if (NP.backup) NP.backup.download();
            } else if (lower === ":import") {
                if (NP.backup) NP.backup.import();
            } else if (lower === ":fav") {
                if (NP.favorites) NP.favorites.toggle();
            } else if (lower === ":emptytrash") {
                if (NP.trash) NP.trash.empty();
            } else if (lower === ":orientation") {
                if (NP.layout && NP.layout.toggleOrientation) NP.layout.toggleOrientation();
            } else if (lower === ":matrix") {
                if (NP.matrixRain && NP.matrixRain.toggle) NP.matrixRain.toggle();
            } else if (lower === ":help") {
                if (NP.help && NP.help.show) NP.help.show();
            } else if (lower === ":closetab") {
                if (NP.tabs && NP.tabs.closeCurrent) NP.tabs.closeCurrent();
            } else if (lower === ":closeall") {
                if (NP.tabs && NP.tabs.closeAll) NP.tabs.closeAll();
            } else if (lower === ":crt") {
                if (NP.effects && NP.effects.crtToggle) NP.effects.crtToggle();
            } else if (lower.indexOf(":findall ") === 0) {
                var fq = cmd.substring(9).trim();
                if (fq && NP.findAll && NP.findAll.show) NP.findAll.show(fq);
            } else if (lower === ":findall") {
                if (NP.findAll && NP.findAll.show) NP.findAll.show("");
            }

            NP.commandBar.close();
        }
    };

})(window.NP);

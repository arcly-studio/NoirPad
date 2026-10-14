/* tags.js - NoirPad tag management */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var tagBar = null;
    var tagInput = null;

    function ensureDOM() {
        if (tagBar) return;
        /* Reuse the existing #tag-bar from index.html if present */
        tagBar = document.getElementById("tag-bar");
        if (!tagBar) {
            tagBar = document.createElement("div");
            tagBar.id = "tag-bar";
            tagBar.style.cssText =
                "display:none;padding:4px 10px;gap:6px;flex-wrap:wrap;align-items:center;" +
                "font-family:var(--font-mono,'Consolas',monospace);font-size:12px;" +
                "border-bottom:1px solid var(--fg-dim,#006b1d);min-height:28px;";
            var tabBarEl = document.getElementById("tab-bar");
            var editorWrap = document.getElementById("editor-wrapper")
                || document.getElementById("editor-area")
                || document.getElementById("editor-container");
            if (tabBarEl && tabBarEl.parentNode) {
                tabBarEl.parentNode.insertBefore(tagBar, tabBarEl.nextSibling);
            } else if (editorWrap) {
                editorWrap.insertBefore(tagBar, editorWrap.firstChild);
            } else {
                document.body.appendChild(tagBar);
            }
        }

        /* Wire the existing #tag-input (if any) so Enter adds a tag */
        tagInput = document.getElementById("tag-input");
        if (tagInput && !tagInput._npWired) {
            tagInput._npWired = true;
            tagInput.addEventListener("keydown", function (e) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    var v = tagInput.value.trim();
                    if (v) {
                        NP.tags.addTag(v);
                        tagInput.value = "";
                    }
                }
            });
        }
    }

    function createPill(name) {
        var pill = document.createElement("span");
        pill.className = "np-tag-pill";
        pill.style.cssText =
            "display:inline-flex;align-items:center;gap:4px;padding:2px 8px;" +
            "background:var(--select-bg,#003300);color:var(--fg,#00ff41);" +
            "border-radius:12px;cursor:default;";

        var label = document.createElement("span");
        label.textContent = name;

        var removeBtn = document.createElement("span");
        removeBtn.textContent = "\u00D7";
        removeBtn.title = NP.t("tags.remove");
        removeBtn.style.cssText =
            "cursor:pointer;opacity:0;transition:opacity 0.15s;font-size:14px;line-height:1;";
        removeBtn.addEventListener("click", function () {
            NP.tags.removeTag(name);
        });

        pill.addEventListener("mouseenter", function () { removeBtn.style.opacity = "1"; });
        pill.addEventListener("mouseleave", function () { removeBtn.style.opacity = "0"; });

        pill.appendChild(label);
        pill.appendChild(removeBtn);
        return pill;
    }

    NP.tags = {
        render: function () {
            ensureDOM();
            /* Remove any existing pills but keep #tag-input intact */
            var existingPills = tagBar.querySelectorAll(".np-tag-pill");
            for (var p = 0; p < existingPills.length; p++) {
                existingPills[p].parentNode.removeChild(existingPills[p]);
            }

            var tags = NP.tags._getNoteTags();
            var hasInput = !!tagInput;
            if ((!tags || !tags.length) && !hasInput) {
                tagBar.style.display = "none";
                return;
            }

            tagBar.style.display = "flex";
            tags.forEach(function (t) {
                /* Insert pills before the input (or append if no input) */
                if (tagInput && tagInput.parentNode === tagBar) {
                    tagBar.insertBefore(createPill(t), tagInput);
                } else {
                    tagBar.appendChild(createPill(t));
                }
            });
        },

        addTag: function (name) {
            if (!name) return;
            name = name.trim();
            var noteId = NP.state && NP.state.currentNoteId;
            if (!noteId) return;

            if (!name) return;
            var tags = NP.tags._getNoteTags();
            /* "Work" and "work" are the same tag (C5). */
            var lower = name.toLowerCase();
            if (tags.some(function (t) { return String(t).toLowerCase() === lower; })) return;

            tags.push(name);
            NP.api.setTags(noteId, tags).then(function () {
                NP.tags._setNoteTags(tags);
                NP.tags.render();
            }).catch(function (err) {
                console.error("Failed to add tag:", err);
            });
        },

        removeTag: function (name) {
            var noteId = NP.state && NP.state.currentNoteId;
            if (!noteId) return;

            var tags = NP.tags._getNoteTags();
            var idx = tags.indexOf(name);
            if (idx === -1) return;

            tags.splice(idx, 1);
            NP.api.setTags(noteId, tags).then(function () {
                NP.tags._setNoteTags(tags);
                NP.tags.render();
            }).catch(function (err) {
                console.error("Failed to remove tag:", err);
            });
        },

        showAll: function () {
            NP.api.getTags().then(function (res) {
                /* Server returns { tags: ["foo", "bar", ...] } */
                var list = (res && Array.isArray(res.tags)) ? res.tags : [];
                var msg = NP.t("tags.allTags") + "\n\n" + (list.length ? list.sort().join(", ") : NP.t("tags.none"));
                NP.dialog.alert(msg);
            }).catch(function (err) {
                console.error("Failed to get tags:", err);
            });
        },

        _getNoteTags: function () {
            var noteId = NP.state && NP.state.currentNoteId;
            if (!noteId || !NP.state.data) return [];

            /* Look in tree items */
            var item = NP.tags._findItem(NP.state.data.tree, noteId);
            if (item && item.tags) return item.tags.slice();
            return [];
        },

        _setNoteTags: function (tags) {
            var noteId = NP.state && NP.state.currentNoteId;
            if (!noteId || !NP.state.data) return;
            var item = NP.tags._findItem(NP.state.data.tree, noteId);
            if (item) item.tags = tags;
        },

        _findItem: function (tree, id) {
            if (!tree) return null;
            for (var i = 0; i < tree.length; i++) {
                if (tree[i].id === id) return tree[i];
                if (tree[i].children) {
                    var found = NP.tags._findItem(tree[i].children, id);
                    if (found) return found;
                }
            }
            return null;
        }
    };

})(window.NP);

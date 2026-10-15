/* tags.js - NoirPad tag management */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var tagBar = null;
    var tagInput = null;

    /* #tag-bar lives in the note header (index.html). */
    function ensureDOM() {
        if (tagBar) return true;
        tagBar = document.getElementById("tag-bar");
        if (!tagBar) return false;

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
        return true;
    }

    /* "#name" (click = show this tag's notes in the tree) and an ×
       that appears on hover / keyboard focus. */
    function createPill(name) {
        var pill = document.createElement("span");
        pill.className = "np-tag-pill";

        var label = document.createElement("button");
        label.type = "button";
        label.className = "np-tag-name";
        label.textContent = "#" + name;
        label.title = NP.t("tree.tagFilterOn", { tag: name });
        label.addEventListener("click", function () {
            if (NP.tree && NP.tree.setTagFilter) NP.tree.setTagFilter(name);
        });

        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "np-tag-remove";
        removeBtn.textContent = "\u00D7";
        removeBtn.title = NP.t("tags.remove");
        removeBtn.setAttribute("aria-label", NP.t("tags.removeNamed", { tag: name }));
        removeBtn.addEventListener("click", function () {
            NP.tags.removeTag(name);
        });

        pill.appendChild(label);
        pill.appendChild(removeBtn);
        return pill;
    }

    NP.tags = {
        render: function () {
            if (!ensureDOM()) return;
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
            if (tagInput) tagInput.disabled = !(NP.state && NP.state.currentNoteId);
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
                if (NP.tree && NP.tree.render) NP.tree.render();
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
                if (NP.tree && NP.tree.render) NP.tree.render();
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

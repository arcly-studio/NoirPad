/* find-all.js - Global search across all notes (:findall) */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var SNIPPET_RADIUS = 40;       /* chars on each side of match */
    var MAX_HITS_PER_NOTE = 5;
    var MAX_TOTAL_HITS = 200;

    var overlayEl = null;

    function findItemById(tree, id) {
        if (!tree) return null;
        for (var i = 0; i < tree.length; i++) {
            if (tree[i].id === id) return tree[i];
            if (tree[i].children) {
                var found = findItemById(tree[i].children, id);
                if (found) return found;
            }
        }
        return null;
    }

    function isEncrypted(content) {
        if (typeof content !== "string") return false;
        try {
            var obj = JSON.parse(content);
            return !!(obj && obj.encrypted && obj.data);
        } catch (e) {
            return false;
        }
    }

    function escapeHtml(s) {
        var d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    function makeSnippet(content, idx, queryLen) {
        var start = Math.max(0, idx - SNIPPET_RADIUS);
        var end = Math.min(content.length, idx + queryLen + SNIPPET_RADIUS);
        var prefix = start > 0 ? "…" : "";
        var suffix = end < content.length ? "…" : "";
        var before = content.substring(start, idx);
        var match = content.substring(idx, idx + queryLen);
        var after = content.substring(idx + queryLen, end);
        return prefix + escapeHtml(before) +
            "<mark>" + escapeHtml(match) + "</mark>" +
            escapeHtml(after) + suffix;
    }

    NP.findAll = {

        search: function (query) {
            var results = [];
            if (!query || !NP.state || !NP.state.data) return results;
            var notes = NP.state.data.notes || {};
            var tree = NP.state.data.tree || [];
            var lq = query.toLowerCase();

            for (var noteId in notes) {
                if (!Object.prototype.hasOwnProperty.call(notes, noteId)) continue;
                var content = notes[noteId];
                if (!content || isEncrypted(content)) continue;

                var lc = content.toLowerCase();
                var hitsInNote = 0;
                var pos = 0;
                while (true) {
                    var idx = lc.indexOf(lq, pos);
                    if (idx === -1) break;
                    var item = findItemById(tree, noteId);
                    var name = item ? item.name : noteId;
                    results.push({
                        noteId: noteId,
                        name: name,
                        snippet: makeSnippet(content, idx, query.length),
                        offset: idx
                    });
                    hitsInNote++;
                    if (hitsInNote >= MAX_HITS_PER_NOTE) break;
                    if (results.length >= MAX_TOTAL_HITS) break;
                    pos = idx + query.length;
                }
                if (results.length >= MAX_TOTAL_HITS) break;
            }
            return results;
        },

        show: function (initialQuery) {
            NP.findAll.close();

            var overlay = document.createElement("div");
            overlay.className = "np-findall-overlay";
            overlay.addEventListener("mousedown", function (e) {
                if (e.target === overlay) NP.findAll.close();
            });

            var modal = document.createElement("div");
            modal.className = "np-findall-modal";

            var header = document.createElement("div");
            header.className = "np-findall-header";

            var input = document.createElement("input");
            input.type = "text";
            input.value = initialQuery || "";
            input.placeholder = "Search across all notes...";
            input.style.cssText =
                "width:100%;box-sizing:border-box;padding:6px 10px;" +
                "background:var(--bg);color:var(--fg);" +
                "border:1px solid var(--border);border-radius:3px;" +
                "font-family:inherit;font-size:13px;outline:none;";
            header.appendChild(input);

            var list = document.createElement("div");
            list.className = "np-findall-list";

            modal.appendChild(header);
            modal.appendChild(list);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            overlayEl = overlay;

            function render(query) {
                var hits = NP.findAll.search(query);
                list.innerHTML = "";
                if (!query) {
                    list.innerHTML = '<div class="np-findall-empty">Type to search</div>';
                    return;
                }
                if (!hits.length) {
                    list.innerHTML = '<div class="np-findall-empty">No matches</div>';
                    return;
                }
                hits.forEach(function (hit) {
                    var item = document.createElement("div");
                    item.className = "np-findall-result";
                    item.innerHTML =
                        '<div class="np-findall-result-name">' + escapeHtml(hit.name) + '</div>' +
                        '<div class="np-findall-result-snippet">' + hit.snippet + '</div>';
                    item.addEventListener("click", function () {
                        NP.findAll.close();
                        if (NP.tabs && NP.tabs.add) {
                            NP.tabs.add(hit.noteId, hit.name);
                        } else if (NP.editor && NP.editor.loadNote) {
                            NP.editor.loadNote(hit.noteId);
                        }
                        /* Trigger in-note search to highlight the match */
                        setTimeout(function () {
                            if (NP.search && NP.search.show) {
                                NP.search.show();
                                NP.search.find(query);
                            }
                        }, 250);
                    });
                    list.appendChild(item);
                });
            }

            input.addEventListener("input", function () {
                render(input.value.trim());
            });
            input.addEventListener("keydown", function (e) {
                if (e.key === "Escape") {
                    e.preventDefault();
                    NP.findAll.close();
                } else if (e.key === "Enter") {
                    e.preventDefault();
                    /* Click the first result if any */
                    var first = list.querySelector(".np-findall-result");
                    if (first) first.click();
                }
            });

            input.focus();
            render(input.value.trim());
        },

        close: function () {
            if (overlayEl && overlayEl.parentNode) {
                overlayEl.parentNode.removeChild(overlayEl);
            }
            overlayEl = null;
        }
    };

})(window.NP);

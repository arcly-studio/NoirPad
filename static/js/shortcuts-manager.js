/* shortcuts-manager.js - Standalone Shortcuts overlay (search / filter /
 * record / reset). All shortcut UI + recording logic lives here; the
 * core registry/dispatch/validate stays in shortcuts.js (untouched).
 */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var recordingState = null;
    var filterCustomizedOnly = false;
    var searchQuery = "";

    function getOverlay() { return document.getElementById("shortcuts-overlay"); }
    function getBody() { return document.getElementById("shortcuts-body"); }

    function renderList() {
        var body = getBody();
        if (!body || !NP.shortcuts || !NP.shortcuts.getAll) return;

        /* A re-render wipes the row a recording is attached to. */
        if (recordingState) cancelRecording();

        var registry = NP.shortcuts.getAll();
        var order = [];
        var byCategory = {};
        var totalCount = 0;
        var customCount = 0;

        for (var id in registry) {
            var item = registry[id];
            var isCustom = item.current !== item.default;

            totalCount++;
            if (isCustom) customCount++;

            if (filterCustomizedOnly && !isCustom) continue;
            var label = NP.shortcuts.label(id);
            if (searchQuery && label.toLowerCase()
                .indexOf(searchQuery.toLowerCase()) === -1) continue;

            var cat = item.categoryKey ? NP.shortcuts.categoryLabel(id)
                : NP.t("shortcutsManager.otherCategory");
            if (!byCategory[cat]) { byCategory[cat] = []; order.push(cat); }
            byCategory[cat].push({
                id: id, info: item, label: label, isCustom: isCustom
            });
        }

        var html = "";
        for (var c = 0; c < order.length; c++) {
            var cat = order[c];
            html += '<div class="shortcuts-category">' + NP.escapeHtml(cat) + "</div>";
            byCategory[cat].forEach(function (entry) {
                html += '<div class="shortcuts-row" data-shortcut-id="' +
                    NP.escapeHtml(entry.id) + '">' +
                    '<span class="shortcuts-row-label">' +
                    NP.escapeHtml(entry.label) + "</span>" +
                    '<span class="shortcuts-row-key' +
                    (entry.isCustom ? " custom" : "") +
                    '" data-role="display">' +
                    NP.escapeHtml(entry.info.current || "—") + "</span>" +
                    '<button class="shortcuts-row-btn" data-role="record">' +
                    NP.escapeHtml(NP.t("shortcutsManager.record")) +
                    "</button>" +
                    '<button class="shortcuts-row-btn reset-mini' +
                    (entry.isCustom ? "" : " hidden") +
                    '" data-role="reset" aria-label="' +
                    NP.escapeHtml(NP.t("shortcutsManager.resetToDefault")) +
                    '">' +
                    "↻</button>" +
                    "</div>";
            });
        }

        if (order.length === 0) {
            html = '<div style="text-align:center;color:var(--fg-dim);' +
                'padding:30px;font-size:12px;">' +
                NP.escapeHtml(NP.t("shortcutsManager.noneFound")) + "</div>";
        }

        body.innerHTML = html;
        bindRowHandlers();

        updateFooter(totalCount, customCount);
        updateSettingsSummary(totalCount, customCount);
    }

    function countsText(total, custom) {
        return NP.t("shortcutsManager.totalCount", { n: total }) + " · " +
            NP.t("shortcutsManager.customCount", { n: custom });
    }

    function updateFooter(total, custom) {
        var f = document.getElementById("shortcuts-footer-info");
        if (f) f.textContent = countsText(total, custom);
    }

    function updateSettingsSummary(total, custom) {
        var s = document.getElementById("shortcuts-summary");
        if (s) s.textContent = countsText(total, custom);
    }

    function bindRowHandlers() {
        var body = getBody();
        if (!body) return;

        var recs = body.querySelectorAll('[data-role="record"]');
        for (var i = 0; i < recs.length; i++) {
            (function (btn) {
                btn.addEventListener("click", function (e) {
                    e.stopPropagation();
                    var row = btn.closest(".shortcuts-row");
                    /* Toggle: clicking the (now "Cancel") button while
                       recording THIS row cancels; otherwise (re)start.
                       Single handler — no onclick/addEventListener race. */
                    if (recordingState && recordingState.rowEl === row) {
                        cancelRecording();
                    } else {
                        startRecording(row);
                    }
                });
            })(recs[i]);
        }

        var resets = body.querySelectorAll('[data-role="reset"]');
        for (var j = 0; j < resets.length; j++) {
            (function (btn) {
                btn.addEventListener("click", function (e) {
                    e.stopPropagation();
                    var row = btn.closest(".shortcuts-row");
                    NP.shortcuts.reset(row.getAttribute("data-shortcut-id"));
                    renderList();
                });
            })(resets[j]);
        }
    }

    function startRecording(rowEl) {
        if (recordingState) cancelRecording();
        if (!rowEl) return;

        var id = rowEl.getAttribute("data-shortcut-id");
        var displayEl = rowEl.querySelector('[data-role="display"]');
        var recordBtn = rowEl.querySelector('[data-role="record"]');
        if (!displayEl || !recordBtn) return;

        recordingState = {
            id: id, rowEl: rowEl, displayEl: displayEl, recordBtn: recordBtn,
            originalDisplay: displayEl.textContent,
            originalBtnText: recordBtn.textContent
        };

        displayEl.textContent = NP.t("shortcutsManager.pressKeys");
        displayEl.classList.add("recording");
        recordBtn.textContent = NP.t("common.cancel");
        recordBtn.classList.add("recording-cancel");

        NP.shortcuts._recordingActive = true;
        document.addEventListener("keydown", recordingKeyHandler, true);
    }

    function recordingKeyHandler(e) {
        if (!recordingState) return;
        e.preventDefault();
        e.stopPropagation();

        if (e.key === "Escape") { cancelRecording(); return; }

        if (e.key === "Control" || e.key === "Alt" ||
            e.key === "Shift" || e.key === "Meta") {
            var mods = [];
            if (e.ctrlKey || e.metaKey) mods.push("Ctrl");
            if (e.altKey) mods.push("Alt");
            if (e.shiftKey) mods.push("Shift");
            recordingState.displayEl.textContent =
                (mods.length ? mods.join("+") + "+" : "") + "...";
            return;
        }

        var parts = [];
        if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
        if (e.altKey) parts.push("Alt");
        if (e.shiftKey) parts.push("Shift");
        var key = e.key;
        /* Uppercase single-char finals so customs match the registry
           defaults ("Ctrl+S") + BLACKLIST and display consistently. */
        if (key.length === 1) key = key.toUpperCase();
        parts.push(key);
        var keystroke = parts.join("+");

        var validation = NP.shortcuts.validate(keystroke);
        if (!validation.ok) {
            recordingState.displayEl.textContent = validation.reason;
            recordingState.displayEl.classList.add("error");
            setTimeout(function () {
                if (recordingState) {
                    recordingState.displayEl.classList.remove("error");
                    recordingState.displayEl.textContent = NP.t("shortcutsManager.pressKeys");
                }
            }, 2000);
            return;
        }

        var conflict = NP.shortcuts.findConflict(keystroke, recordingState.id);
        if (conflict) {
            /* The dialog takes the keyboard (Enter/Escape) while it is open. */
            var rs = recordingState;
            NP.dialog.confirm(NP.t("shortcutsManager.conflictConfirm", {
                keys: keystroke, label: conflict.label
            })).then(function (ok) {
                if (recordingState !== rs) return;    /* cancelled meanwhile */
                if (!ok) {
                    rs.displayEl.textContent = NP.t("shortcutsManager.pressKeys");
                    return;
                }
                NP.shortcuts.setCurrent(conflict.id, "");
                NP.shortcuts.setCurrent(rs.id, keystroke);
                finishRecording();
            });
            return;
        }

        NP.shortcuts.setCurrent(recordingState.id, keystroke);
        finishRecording();
    }

    function cancelRecording() {
        if (!recordingState) return;
        var rs = recordingState;
        recordingState = null;
        document.removeEventListener("keydown", recordingKeyHandler, true);
        NP.shortcuts._recordingActive = false;
        if (rs.displayEl) {
            rs.displayEl.textContent = rs.originalDisplay;
            rs.displayEl.classList.remove("recording", "error");
        }
        if (rs.recordBtn) {
            rs.recordBtn.textContent = rs.originalBtnText;
            rs.recordBtn.classList.remove("recording-cancel");
        }
    }

    function finishRecording() {
        recordingState = null;
        document.removeEventListener("keydown", recordingKeyHandler, true);
        NP.shortcuts._recordingActive = false;
        renderList();
    }

    NP.shortcutsManager = {

        init: function () {
            var openBtn = document.getElementById("open-shortcuts-manager");
            if (openBtn) {
                openBtn.addEventListener("click", NP.shortcutsManager.open);
            }
            var closeBtn = document.getElementById("shortcuts-close");
            if (closeBtn) {
                closeBtn.addEventListener("click", NP.shortcutsManager.close);
            }
            var overlay = getOverlay();
            if (overlay) {
                overlay.addEventListener("mousedown", function (e) {
                    if (e.target === overlay) NP.shortcutsManager.close();
                });
            }
            var search = document.getElementById("shortcuts-search");
            if (search) {
                search.addEventListener("input", function () {
                    searchQuery = search.value;
                    renderList();
                });
            }
            var filterBtn =
                document.getElementById("shortcuts-filter-customized");
            if (filterBtn) {
                filterBtn.addEventListener("click", function () {
                    filterCustomizedOnly = !filterCustomizedOnly;
                    filterBtn.setAttribute("aria-pressed",
                        filterCustomizedOnly ? "true" : "false");
                    renderList();
                });
            }
            var resetAllBtn = document.getElementById("shortcuts-reset-all");
            if (resetAllBtn) {
                resetAllBtn.addEventListener("click", function () {
                    NP.dialog.confirm(NP.t("shortcutsManager.resetAllConfirm"), {
                        danger: true
                    }).then(function (ok) {
                        if (!ok) return;
                        NP.shortcuts.resetAll();
                        renderList();
                    });
                });
            }

            /* Escape: when recording, recordingKeyHandler (capture) eats
               it. Otherwise, if the manager is open, close it. */
            document.addEventListener("keydown", function (e) {
                if (e.key !== "Escape") return;
                if (recordingState) return;
                var ov = getOverlay();
                if (!ov || !ov.classList.contains("visible")) return;
                NP.shortcutsManager.close();
                e.stopPropagation();
            });

            /* Populate the Settings summary at startup. */
            renderList();
        },

        open: function () {
            var ov = getOverlay();
            if (!ov) return;
            searchQuery = "";
            filterCustomizedOnly = false;
            var search = document.getElementById("shortcuts-search");
            if (search) search.value = "";
            var filterBtn =
                document.getElementById("shortcuts-filter-customized");
            if (filterBtn) filterBtn.setAttribute("aria-pressed", "false");
            renderList();
            ov.classList.add("visible");
            ov.setAttribute("aria-hidden", "false");
        },

        close: function () {
            if (recordingState) cancelRecording();
            var ov = getOverlay();
            if (!ov) return;
            ov.classList.remove("visible");
            ov.setAttribute("aria-hidden", "true");
        },

        refreshSummary: function () {
            renderList();
        }
    };

})(window.NP);

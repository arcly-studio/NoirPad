/* shortcuts.js - Central keyboard-shortcut registry + dispatcher.
 *
 * One global capture-phase keydown listener replaces the per-module
 * hardcoded handlers. Handlers are registered by id; the binding for
 * each id lives in `registry` (default + current) and can later be
 * remapped from Settings (next phase) and persisted to the backend.
 *
 * Dispatcher contract:
 *   - On a keystroke match the registered handler is called.
 *   - If the handler returns `false`, the dispatcher CONTINUES iterating
 *     to find the next matching binding. This enables context-aware
 *     bindings (e.g. md-bold's Ctrl+B consumes only in MD mode; in
 *     rich-text it returns false so toggle-sidebar — also Ctrl+B — can
 *     fire). When all matching handlers passthrough, the event falls
 *     through to browser default (e.g. Delete in a focused input still
 *     deletes the character).
 *   - Otherwise the event is consumed (preventDefault + stopPropagation).
 *
 * Iteration order is for...in (insertion order). Place higher-priority
 * (more specific) bindings earlier in the registry — Markdown actions
 * are listed first so they get the first chance to claim conflicting
 * keystrokes like Ctrl+B.
 */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* ============== Helpers ============== */

    function normalizeKey(key) {
        if (!key) return "";
        if (key.length === 1) return key.toLowerCase();
        return key;
    }

    function eventToKeystroke(e) {
        var parts = [];
        if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
        if (e.altKey) parts.push("Alt");
        if (e.shiftKey) parts.push("Shift");

        var key = normalizeKey(e.key);
        if (key === "Control" || key === "Alt" ||
            key === "Shift" || key === "Meta") {
            return null;
        }
        parts.push(key);
        return parts.join("+");
    }

    function hasPart(parts, name) {
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] === name) return true;
        }
        return false;
    }

    function parseKeystroke(str) {
        var raw = str.split("+");
        var parts = [];
        for (var i = 0; i < raw.length; i++) parts.push(raw[i].trim());
        return {
            ctrl:  hasPart(parts, "Ctrl"),
            alt:   hasPart(parts, "Alt"),
            shift: hasPart(parts, "Shift"),
            key:   normalizeKey(parts[parts.length - 1])
        };
    }

    function matchesKeystroke(e, ks) {
        var p = parseKeystroke(ks);
        /* ctrl == ctrl||meta to match the old `e.ctrlKey || e.metaKey`
           behaviour (Cmd on macOS) used by every migrated handler. */
        return (
            !!(e.ctrlKey || e.metaKey) === p.ctrl &&
            !!e.altKey === p.alt &&
            !!e.shiftKey === p.shift &&
            normalizeKey(e.key) === p.key
        );
    }

    /* Browser-reserved combos that must not be rebound. */
    var BLACKLIST = [
        "Ctrl+T", "Ctrl+Shift+T", "Ctrl+N", "Ctrl+Shift+N",
        "Ctrl+R", "F5", "Ctrl+Q", "F11", "F12", "Ctrl+Shift+I",
        "Ctrl+Shift+J", "Ctrl+U", "Ctrl+Shift+C"
    ];

    /* Canonical form for comparison: single-char final key uppercased
       (matches the registry defaults like "Ctrl+S" and the BLACKLIST),
       so blacklist / conflict checks aren't defeated by letter case. */
    function normKs(ks) {
        if (!ks) return "";
        var parts = String(ks).split("+");
        var last = parts[parts.length - 1];
        if (last && last.length === 1) {
            parts[parts.length - 1] = last.toUpperCase();
        }
        return parts.join("+");
    }

    /* ============== Registry ============== */

    var registry = {
        /* Markdown — listed FIRST so for...in dispatch order gives these
           priority over conflicting bindings (e.g. md-bold's Ctrl+B vs
           toggle-sidebar's Ctrl+B). MD handlers return false when the MD
           textarea isn't focused, and the dispatcher's "continue on
           passthrough" semantics let the next matching binding fire. */
        "md-h1":                { default: "",              current: "",              label: "Markdown: H1 heading",        category: "Markdown" },
        "md-h2":                { default: "",              current: "",              label: "Markdown: H2 heading",        category: "Markdown" },
        "md-h3":                { default: "",              current: "",              label: "Markdown: H3 heading",        category: "Markdown" },
        "md-bold":              { default: "Ctrl+B",        current: "Ctrl+B",        label: "Markdown: Bold",              category: "Markdown" },
        "md-italic":            { default: "Ctrl+I",        current: "Ctrl+I",        label: "Markdown: Italic",            category: "Markdown" },
        "md-code-inline":       { default: "Ctrl+E",        current: "Ctrl+E",        label: "Markdown: Inline code",       category: "Markdown" },
        "md-strikethrough":     { default: "",              current: "",              label: "Markdown: Strikethrough",     category: "Markdown" },
        "md-code-block":        { default: "Ctrl+Shift+E",  current: "Ctrl+Shift+E",  label: "Markdown: Code block",        category: "Markdown" },
        "md-quote":             { default: "",              current: "",              label: "Markdown: Quote",             category: "Markdown" },
        "md-list-bullet":       { default: "",              current: "",              label: "Markdown: Bullet list",       category: "Markdown" },
        "md-list-numbered":     { default: "",              current: "",              label: "Markdown: Numbered list",     category: "Markdown" },
        "md-horizontal-rule":   { default: "",              current: "",              label: "Markdown: Horizontal rule",   category: "Markdown" },
        "md-link":              { default: "Ctrl+K",        current: "Ctrl+K",        label: "Markdown: Link",              category: "Markdown" },
        "md-image":             { default: "",              current: "",              label: "Markdown: Image",             category: "Markdown" },

        /* Editor */
        "save":                 { default: "Ctrl+S",        current: "Ctrl+S",        label: "Save note",              category: "Editor" },
        "find":                 { default: "Ctrl+F",        current: "Ctrl+F",        label: "Find in note",           category: "Editor" },
        "find-next":            { default: "F3",            current: "F3",            label: "Find next",              category: "Editor" },
        "find-prev":            { default: "Shift+F3",      current: "Shift+F3",      label: "Find previous",          category: "Editor" },
        "insert-image":         { default: "Ctrl+Shift+I",  current: "Ctrl+Shift+I",  label: "Insert image",           category: "Editor" },
        "toggle-markdown":      { default: "Ctrl+M",        current: "Ctrl+M",        label: "Toggle markdown mode",   category: "Editor" },

        /* Notes */
        "new-folder":           { default: "Ctrl+Shift+F",  current: "Ctrl+Shift+F",  label: "New folder",             category: "Notes" },
        "new-note":             { default: "Ctrl+Shift+N",  current: "Ctrl+Shift+N",  label: "New note",               category: "Notes" },
        "delete":               { default: "Delete",        current: "Delete",        label: "Delete selected",        category: "Notes" },
        "rename":               { default: "F2",            current: "F2",            label: "Rename selected",        category: "Notes" },
        "toggle-favorite":      { default: "Ctrl+D",        current: "Ctrl+D",        label: "Toggle favorite",        category: "Notes" },
        "toggle-lock":          { default: "Ctrl+Shift+L",  current: "Ctrl+Shift+L",  label: "Lock/unlock note",       category: "Notes" },

        /* UI */
        "toggle-sidebar":       { default: "Ctrl+B",        current: "Ctrl+B",        label: "Toggle sidebar/focus",   category: "UI" },
        "toggle-orientation":   { default: "Ctrl+L",        current: "Ctrl+L",        label: "Toggle page orientation",category: "UI" },
        "open-settings":        { default: "Ctrl+,",        current: "Ctrl+,",        label: "Open settings",          category: "UI" },
        "open-help":            { default: "F1",            current: "F1",            label: "Open help",              category: "UI" },
        "open-command-palette": { default: "Ctrl+Shift+P",  current: "Ctrl+Shift+P",  label: "Open command palette",   category: "UI" },
        "open-font-picker":     { default: "Ctrl+Shift+T",  current: "Ctrl+Shift+T",  label: "Open font picker",       category: "UI" },
        "fullscreen":           { default: "F11",           current: "F11",           label: "Toggle fullscreen",      category: "UI" },

        /* Tabs */
        "next-tab":             { default: "Ctrl+Tab",      current: "Ctrl+Tab",      label: "Next tab",               category: "Tabs" },
        "prev-tab":             { default: "Ctrl+Shift+Tab",current: "Ctrl+Shift+Tab",label: "Previous tab",           category: "Tabs" },
        "close-tab":            { default: "Ctrl+W",        current: "Ctrl+W",        label: "Close tab",              category: "Tabs" }
    };

    var handlers = {}; /* id -> function (may return false = passthrough) */

    /* ============== Public API ============== */

    NP.shortcuts = {

        register: function (id, handler) {
            handlers[id] = handler;
        },

        getAll: function () {
            return registry;
        },

        getCurrent: function (id) {
            return registry[id] ? registry[id].current : null;
        },

        setCurrent: function (id, keystroke) {
            if (registry[id]) {
                registry[id].current = keystroke;
                NP.shortcuts.persist();
            }
        },

        reset: function (id) {
            if (registry[id]) {
                registry[id].current = registry[id].default;
                NP.shortcuts.persist();
            }
        },

        resetAll: function () {
            for (var id in registry) {
                registry[id].current = registry[id].default;
            }
            NP.shortcuts.persist();
        },

        persist: function () {
            if (NP.api && NP.api.saveSettings) {
                var mapping = {};
                for (var id in registry) {
                    if (registry[id].current !== registry[id].default) {
                        mapping[id] = registry[id].current;
                    }
                }
                if (NP.state && NP.state.data) {
                    NP.state.data.custom_shortcuts = mapping;
                }
                NP.api.saveSettings({ custom_shortcuts: mapping });
            }
        },

        loadFromState: function () {
            if (NP.state && NP.state.data && NP.state.data.custom_shortcuts) {
                var mapping = NP.state.data.custom_shortcuts;
                for (var id in mapping) {
                    if (registry[id]) {
                        registry[id].current = mapping[id];
                    }
                }
            }
        },

        validate: function (keystroke) {
            keystroke = normKs(keystroke);
            if (!keystroke) {
                return { ok: false, reason: "Empty keystroke" };
            }
            var hasModifier = /^(Ctrl|Alt|Shift)\+/.test(keystroke);
            var standalone = /^(F\d+|Delete|Insert|Home|End|PageUp|PageDown|Escape)$/
                .test(keystroke);
            if (!hasModifier && !standalone) {
                return {
                    ok: false,
                    reason: "Shortcut must include Ctrl, Alt, or Shift"
                };
            }
            for (var i = 0; i < BLACKLIST.length; i++) {
                if (normKs(BLACKLIST[i]) === keystroke) {
                    return {
                        ok: false,
                        reason: "This shortcut is reserved by your " +
                            "browser and cannot be used"
                    };
                }
            }
            return { ok: true };
        },

        findConflict: function (keystroke, excludeId) {
            keystroke = normKs(keystroke);
            for (var id in registry) {
                if (id === excludeId) continue;
                if (registry[id].current &&
                    normKs(registry[id].current) === keystroke) {
                    return { id: id, label: registry[id].label };
                }
            }
            return null;
        },

        /* Expose for the (future) Settings editor + tests. */
        eventToKeystroke: eventToKeystroke,

        _bound: false,

        init: function () {
            NP.shortcuts.loadFromState();

            if (NP.shortcuts._bound) return;   /* one listener only */
            NP.shortcuts._bound = true;

            document.addEventListener("keydown", function (e) {
                /* While recording a new binding in Settings, let the
                   keystroke pass through to the recorder (no dispatch,
                   no preventDefault). */
                if (NP.shortcuts._recordingActive) return;
                for (var id in registry) {
                    var ks = registry[id].current;
                    if (!ks) continue;
                    if (!matchesKeystroke(e, ks)) continue;

                    var handler = handlers[id];
                    if (!handler) {
                        /* Bound but no handler — try the next binding for
                           this keystroke (could be a more specific action
                           that owns the key). */
                        continue;
                    }
                    var result;
                    try {
                        result = handler(e);
                    } catch (err) {
                        console.error(
                            "Shortcut handler error for " + id + ":", err
                        );
                    }
                    if (result === false) {
                        /* Context-aware passthrough — try the next binding
                           that matches the same keystroke (e.g. md-bold
                           defers to toggle-sidebar outside MD mode). If
                           none matches, the key falls through to browser
                           default at the bottom of the loop. */
                        continue;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
            }, true); /* capture: run before contentEditable defaults */
        }
    };

})(window.NP);

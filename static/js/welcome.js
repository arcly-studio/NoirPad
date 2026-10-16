/* welcome.js - the start page (nothing open): logo + name, actions,
   RECENT notes, F1 hint. One narrow column, rendered into #editor by
   NP.editor.showWelcome() with DOM APIs only (note names are user data).

   Recent notes: settings key "recent_notes" = [{id, at}], newest first,
   at most RECENT_MAX; `at` = when the note was last opened (ms). Notes in
   the trash or deleted are skipped when shown and dropped on the next save.
   The action shortcuts come from the shortcut registry, so a remapped key
   shows up here as well. */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var RECENT_MAX = 10;
    var RECENT_SHOWN = 3;
    var REWRITE_AFTER = 10 * 60 * 1000;   /* re-opening the newest note: save its time at most this often */
    var LOGO = "/static/img/noirpad-icon.svg";

    var ACTIONS = [
        { id: "new-note",             icon: "file-plus",   key: "welcome.newNote" },
        { id: "new-folder",           icon: "folder-plus", key: "welcome.newFolder" },
        { id: "find-all",             icon: "search",      key: "welcome.search" },
        { id: "open-command-palette", icon: "terminal",    key: "welcome.commands" }
    ];

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    /* "Ctrl+Shift+K" → <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> */
    function keys(ks) {
        var span = el("span", "welcome-keys");
        if (!ks) return span;
        /* "Ctrl++" = Ctrl and the plus key */
        (String(ks).match(/[^+]+|\+$/g) || []).forEach(function (part, i) {
            if (i) span.appendChild(document.createTextNode("+"));
            span.appendChild(el("kbd", null, part));
        });
        return span;
    }

    function shortcut(id) {
        return NP.shortcuts && NP.shortcuts.getCurrent ? NP.shortcuts.getCurrent(id) : "";
    }

    function findItem(items, id) {
        for (var i = 0; i < (items || []).length; i++) {
            if (items[i].id === id) return items[i];
            var hit = findItem(items[i].children, id);
            if (hit) return hit;
        }
        return null;
    }

    function liveNote(id) {
        var data = NP.state && NP.state.data;
        var item = data ? findItem(data.tree, id) : null;   /* the trash is a separate tree */
        return item && item.type !== "folder" ? item : null;
    }

    function recentList() {
        var raw = NP.state && NP.state.data && NP.state.data.recent_notes;
        if (!Array.isArray(raw)) return [];
        return raw.filter(function (r) {
            return r && typeof r.id === "string" && typeof r.at === "number";
        });
    }

    function sameDay(a, b) {
        return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() &&
            a.getDate() === b.getDate();
    }

    /* today / yesterday / a short date in the UI language */
    function relativeDate(at, now) {
        var d = new Date(at);
        now = now || new Date();
        if (sameDay(d, now)) return NP.t("welcome.today");
        var y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        if (sameDay(d, y)) return NP.t("welcome.yesterday");
        var lang = NP.i18n && NP.i18n.lang ? NP.i18n.lang() : "en";
        var opts = { day: "numeric", month: "short" };
        if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
        try { return d.toLocaleDateString(lang, opts); } catch (e) { return d.toDateString(); }
    }

    function isLocked(id) {
        return !!(NP.encryption && NP.encryption.isEncrypted && NP.encryption.isEncrypted(id));
    }

    function isFavorite(id) {
        var favs = NP.state && NP.state.data && NP.state.data.favorites;
        return Array.isArray(favs) && favs.indexOf(id) >= 0;
    }

    function row(iconName, label, right, onRun) {
        var b = el("button", "welcome-row");
        b.type = "button";
        if (iconName && NP.icon) b.appendChild(NP.icon(iconName, "welcome-row-icon"));
        b.appendChild(el("span", "welcome-row-label", label));
        if (right) b.appendChild(right);
        b.addEventListener("click", onRun);
        return b;
    }

    /* Up / Down between the rows, Home / End, Enter or Space runs one. */
    function onKeydown(e) {
        var rows = Array.prototype.slice.call(e.currentTarget.querySelectorAll(".welcome-row"));
        var i = rows.indexOf(document.activeElement);
        if (i < 0) return;
        var next = null;
        if (e.key === "ArrowDown") next = rows[(i + 1) % rows.length];
        else if (e.key === "ArrowUp") next = rows[(i - 1 + rows.length) % rows.length];
        else if (e.key === "Home") next = rows[0];
        else if (e.key === "End") next = rows[rows.length - 1];
        else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            rows[i].click();
            return;
        }
        if (next) {
            e.preventDefault();
            next.focus();
        }
    }

    NP.welcome = {
        RECENT_MAX: RECENT_MAX,
        _relativeDate: relativeDate,      /* tests */

        /* Remember that *id* was opened (newest first, no duplicates,
           only notes that still exist), and persist it as a setting. */
        noteOpened: function (id) {
            if (!id || !NP.state || !NP.state.data || !liveNote(id)) return;
            /* Already the newest (tab switching back and forth): no write,
               every settings write changes the data file and makes the
               other windows poll it again. */
            var cur = recentList();
            if (cur.length && cur[0].id === id && Date.now() - cur[0].at < REWRITE_AFTER) return;
            var list = cur.filter(function (r) { return r.id !== id && liveNote(r.id); });
            list.unshift({ id: id, at: Date.now() });
            list = list.slice(0, RECENT_MAX);
            NP.state.data.recent_notes = list;
            if (NP.api && NP.api.saveSettings) {
                var p = NP.api.saveSettings({ recent_notes: list });
                if (p && p.catch) p.catch(function () { /* not worth an error box */ });
            }
        },

        /* The notes for the RECENT section: existing, not in the trash. */
        recent: function () {
            return recentList().map(function (r) {
                var item = liveNote(r.id);
                return item ? { id: r.id, at: r.at, name: item.name } : null;
            }).filter(Boolean).slice(0, RECENT_SHOWN);
        },

        /* opts.focus: start with the keyboard on the first row. */
        render: function (container, opts) {
            var wrap = el("div", "welcome-wrap");
            var col = el("div", "welcome-col");
            wrap.appendChild(col);

            /* 1. Header: logo (not clickable, N4) + name + tagline · version */
            var head = el("div", "welcome-head");
            var logo = document.createElement("img");
            logo.className = "welcome-icon np-decorative";
            logo.src = LOGO;
            logo.width = 44;
            logo.height = 44;
            logo.alt = "";
            logo.draggable = false;
            logo.setAttribute("aria-hidden", "true");
            head.appendChild(logo);
            var titles = el("div", "welcome-titles");
            titles.appendChild(el("h1", "welcome-logo", "NoirPad"));   // i18n-ignore (brand)
            var version = (NP.appInfo && NP.appInfo.version) || "?";
            titles.appendChild(el("p", "welcome-tagline", NP.t("welcome.tagline", { version: version })));
            head.appendChild(titles);
            col.appendChild(head);

            /* 2. Actions */
            var actions = el("div", "welcome-list");
            actions.setAttribute("role", "group");
            actions.setAttribute("aria-label", NP.t("welcome.actions"));
            ACTIONS.forEach(function (a) {
                actions.appendChild(row(a.icon, NP.t(a.key), keys(shortcut(a.id)), function () {
                    if (NP.shortcuts && NP.shortcuts.run) NP.shortcuts.run(a.id);
                }));
            });
            col.appendChild(actions);

            /* 3. RECENT (hidden when empty) */
            var recent = NP.welcome.recent();
            if (recent.length) {
                var hid = "welcome-recent-title";
                var title = el("h2", "welcome-section", NP.t("welcome.recent"));
                title.id = hid;
                col.appendChild(title);
                var list = el("div", "welcome-list");
                list.setAttribute("role", "group");
                list.setAttribute("aria-labelledby", hid);
                var now = new Date();
                recent.forEach(function (r) {
                    var right = el("span", "welcome-row-meta");
                    var spoken = [r.name];
                    if (isFavorite(r.id)) {
                        var star = el("span", "welcome-star", "★");      // i18n-ignore (symbol)
                        star.title = NP.t("tree.favorite");
                        right.appendChild(star);
                        spoken.push(NP.t("tree.favorite"));
                    }
                    if (isLocked(r.id)) spoken.push(NP.t("welcome.locked"));
                    var when = relativeDate(r.at, now);
                    spoken.push(when);
                    right.appendChild(el("span", "welcome-date", when));
                    var b = row(isLocked(r.id) ? "lock" : "file-text", r.name, right, function () {
                        if (NP.tabs && NP.tabs.add) NP.tabs.add(r.id, r.name);
                        else if (NP.editor) NP.editor.loadNote(r.id);
                    });
                    if (isLocked(r.id)) b.classList.add("welcome-row--locked");
                    b.setAttribute("aria-label", spoken.join(", "));
                    list.appendChild(b);
                });
                col.appendChild(list);
            }

            /* 4. F1 help */
            var foot = el("p", "welcome-foot");
            foot.appendChild(keys(shortcut("open-help")));
            foot.appendChild(document.createTextNode(" " + NP.t("welcome.help")));
            col.appendChild(foot);

            /* 5. Keyboard */
            wrap.addEventListener("keydown", onKeydown);

            container.replaceChildren(wrap);
            if (opts && opts.focus) {
                var first = wrap.querySelector(".welcome-row");
                if (first) first.focus({ preventScroll: true });
            }
        }
    };

})(window.NP);

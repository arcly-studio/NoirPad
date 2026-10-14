/* print.js - Export current note to PDF via browser print dialog.
   The @media print rules in noirpad.css hide UI chrome and render
   only the note content; user picks "Save as PDF" in the dialog.

   Two extras on top of plain window.print():
     - LINKED IMAGES: any <a href> pointing at an image URL gets a
       sibling <img> injected so the picture itself prints, not just
       a text URL. The injected nodes are tagged data-np-print-img
       so the afterprint cleanup can remove them again.
     - MARKDOWN CHOICE: in markdown mode the user is asked whether to
       export the RENDERED preview or the RAW source (with #, **, …).
       Raw mode swaps in a temporary <pre> and sets body.np-print-raw,
       which the print stylesheet uses to show only that pre. */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var IMG_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp)(\?|#|$)/i;
    var RAW_LIGHT_CLASS = "np-print-raw";
    var RAW_DARK_CLASS = "np-print-raw-dark";
    var INJECTED_IMG_ATTR = "data-np-print-img";
    var RAW_NODE_ID = "np-print-raw";
    var RAW_PAGE_STYLE_ID = "np-print-raw-page-style";

    /* Raw print modes use `@page { margin: 0 }` for TWO reasons:
         1. Chrome renders its built-in headers/footers (timestamp,
            URL, page number) INSIDE the @page margin area. With
            margin: 0 there's no room → Chrome silently skips them.
            Websites can't programmatically untick the user's
            "Headers and footers" checkbox in the print dialog (browser
            security), so this is the only CSS-level way to hide them.
         2. With margin: 0 the @page margin area doesn't render at
            all, so the dark theme leaking through as top/bottom
            "borders" in light mode is also gone.

       Trade-off: per-page breathing room at page breaks is lost.
       The <pre> gets vertical padding so the very first and very
       last pages still have whitespace, but middle pages flow
       edge-to-edge. */
    function ensureRawPageStyle() {
        if (document.getElementById(RAW_PAGE_STYLE_ID)) return;
        var s = document.createElement("style");
        s.id = RAW_PAGE_STYLE_ID;
        s.textContent = "@media print { @page { margin: 0; } }";
        document.head.appendChild(s);
    }

    function clearRawPageStyle() {
        var s = document.getElementById(RAW_PAGE_STYLE_ID);
        if (s && s.parentNode) s.parentNode.removeChild(s);
    }

    /* ---- markdown / rich-text print wrap ----

       For rendered markdown (and rich-text notes) we use the same
       table+thead/tfoot trick as raw mode: temporarily move the
       container's children into a <tbody><td>, sandwiched between
       1cm-tall <thead> and <tfoot> spacer rows that the browser
       repeats on every printed page. That keeps per-page breathing
       room while @page margin can stay 0 (no Chrome headers/footers).
       wrapHostForPrint() returns a cleanup function that restores
       the original DOM. */
    function wrapHostForPrint(hostId) {
        var host = document.getElementById(hostId);
        if (!host) return function () {};

        var originalChildren = [];
        var child = host.firstChild;
        while (child) {
            originalChildren.push(child);
            child = child.nextSibling;
        }

        var table = document.createElement("table");
        table.className = "np-print-wrap-table";

        var thead = document.createElement("thead");
        var theadTr = document.createElement("tr");
        var theadTd = document.createElement("td");
        theadTd.className = "np-print-spacer";
        theadTr.appendChild(theadTd);
        thead.appendChild(theadTr);

        var tbody = document.createElement("tbody");
        var tbodyTr = document.createElement("tr");
        var tbodyTd = document.createElement("td");
        tbodyTd.className = "np-print-wrap-content";
        for (var i = 0; i < originalChildren.length; i++) {
            tbodyTd.appendChild(originalChildren[i]); /* moves, not clones */
        }
        tbodyTr.appendChild(tbodyTd);
        tbody.appendChild(tbodyTr);

        var tfoot = document.createElement("tfoot");
        var tfootTr = document.createElement("tr");
        var tfootTd = document.createElement("td");
        tfootTd.className = "np-print-spacer";
        tfootTr.appendChild(tfootTd);
        tfoot.appendChild(tfootTr);

        table.appendChild(thead);
        table.appendChild(tbody);
        table.appendChild(tfoot);
        host.appendChild(table);

        return function unwrap() {
            if (table.parentNode === host) host.removeChild(table);
            for (var i = 0; i < originalChildren.length; i++) {
                host.appendChild(originalChildren[i]);
            }
        };
    }

    /* ---- helpers ---- */

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

    function getCurrentNoteName() {
        if (!NP.state || !NP.state.currentNoteId) return null;
        if (!NP.state.data || !NP.state.data.tree) return null;
        var item = findItemById(NP.state.data.tree, NP.state.currentNoteId);
        return item ? item.name : null;
    }

    function isCurrentNoteLocked() {
        var id = NP.state && NP.state.currentNoteId;
        if (!id) return false;
        if (!NP.encryption || !NP.encryption.isEncrypted) return false;
        if (!NP.encryption.isEncrypted(id)) return false;
        return !(NP.editor && NP.editor._unlockToken);
    }

    function isMarkdownMode() {
        return !!(NP.markdown &&
            NP.markdown.isActive && NP.markdown.isActive());
    }

    function looksLikeImageUrl(href) {
        if (!href) return false;
        if (href.indexOf("/images/") === 0) return true;
        if (href.indexOf("data:image/") === 0) return true;
        return IMG_EXT_RE.test(href);
    }

    /* ---- linked-image expansion ----

       For every <a href="…image…"> in the printable area, append
       a sibling <img> tagged with INJECTED_IMG_ATTR. The anchor
       itself stays (its text + " (url)" suffix still print), but
       the picture now actually shows up.

       cleanupInjectedImages() removes everything we added so the
       live editor DOM is back to normal once printing returns. */
    function expandLinkedImages() {
        var hosts = [
            document.getElementById("editor"),
            document.getElementById("md-preview")
        ];
        hosts.forEach(function (host) {
            if (!host) return;
            var anchors = host.querySelectorAll("a[href]");
            for (var i = 0; i < anchors.length; i++) {
                var a = anchors[i];
                /* Skip anchors that already wrap an <img> — picture
                   is there, nothing to expand. */
                if (a.querySelector("img")) continue;
                var href = a.getAttribute("href");
                if (!looksLikeImageUrl(href)) continue;

                var img = document.createElement("img");
                img.src = href;
                img.alt = a.textContent || "";
                img.setAttribute(INJECTED_IMG_ATTR, "1");
                img.style.cssText =
                    "display:block;max-width:100%;height:auto;" +
                    "margin:6pt 0;border-radius:6px;";
                /* Insert AFTER the anchor so the link text + URL
                   appear first, then the picture below — reads
                   naturally on the page. */
                if (a.parentNode) {
                    a.parentNode.insertBefore(img, a.nextSibling);
                }
            }
        });
    }

    function cleanupInjectedImages() {
        var imgs = document.querySelectorAll(
            "img[" + INJECTED_IMG_ATTR + "]"
        );
        for (var i = 0; i < imgs.length; i++) {
            if (imgs[i].parentNode) {
                imgs[i].parentNode.removeChild(imgs[i]);
            }
        }
    }

    /* ---- raw-markdown print swap ----

       Adds <pre id="np-print-raw">SOURCE</pre> to the body and
       sets body.np-print-raw (or .np-print-raw-dark for the dark
       theme); the print stylesheet hides everything except that
       <pre>. removeRawNode() reverses both. */
    function insertRawNode(rawText, theme) {
        var existing = document.getElementById(RAW_NODE_ID);
        if (existing && existing.parentNode) {
            existing.parentNode.removeChild(existing);
        }

        /* Build:
             <table id="np-print-raw">
               <thead><tr><td class="np-print-spacer"></td></tr></thead>
               <tbody><tr><td><pre>SOURCE</pre></td></tr></tbody>
               <tfoot><tr><td class="np-print-spacer"></td></tr></tfoot>
             </table>

           In print, browsers REPEAT <thead> at the top and <tfoot>
           at the bottom of every printed page (standard CSS Paged
           Media behaviour — same trick PDF generators use for
           repeating table headers). The two spacer cells therefore
           give us per-page breathing room WITHOUT needing @page
           margin > 0 (which would also re-introduce Chrome's
           built-in headers/footers we just got rid of). */
        var table = document.createElement("table");
        table.id = RAW_NODE_ID;

        var thead = document.createElement("thead");
        var theadTr = document.createElement("tr");
        var theadTd = document.createElement("td");
        theadTd.className = "np-print-spacer";
        theadTr.appendChild(theadTd);
        thead.appendChild(theadTr);

        var tbody = document.createElement("tbody");
        var tbodyTr = document.createElement("tr");
        var tbodyTd = document.createElement("td");
        var pre = document.createElement("pre");
        pre.className = "np-print-content";
        pre.textContent = rawText || "";
        tbodyTd.appendChild(pre);
        tbodyTr.appendChild(tbodyTd);
        tbody.appendChild(tbodyTr);

        var tfoot = document.createElement("tfoot");
        var tfootTr = document.createElement("tr");
        var tfootTd = document.createElement("td");
        tfootTd.className = "np-print-spacer";
        tfootTr.appendChild(tfootTd);
        tfoot.appendChild(tfootTr);

        table.appendChild(thead);
        table.appendChild(tbody);
        table.appendChild(tfoot);
        document.body.appendChild(table);

        var cls = theme === "dark" ? RAW_DARK_CLASS : RAW_LIGHT_CLASS;
        document.documentElement.classList.add(cls);
        document.body.classList.add(cls);
        ensureRawPageStyle();
    }

    function removeRawNode() {
        document.documentElement.classList.remove(RAW_LIGHT_CLASS);
        document.documentElement.classList.remove(RAW_DARK_CLASS);
        document.body.classList.remove(RAW_LIGHT_CLASS);
        document.body.classList.remove(RAW_DARK_CLASS);
        clearRawPageStyle();
        var pre = document.getElementById(RAW_NODE_ID);
        if (pre && pre.parentNode) pre.parentNode.removeChild(pre);
    }

    /* ---- the actual print call ----

       window.print() blocks in Chrome/Edge (returns after the dialog
       closes) but returns early in Safari and in some Chromium
       headless variants. Cleanup happens in BOTH the synchronous
       finally AND in afterprint, so we don't depend on either alone.
       afterprint also fires on the WindowEventHandlers; we attach it
       per-call so multiple prints don't double-fire cleanup. */
    function doPrint(cleanup) {
        var done = false;
        function once() {
            if (done) return;
            done = true;
            cleanup();
            window.removeEventListener("afterprint", once);
        }
        window.addEventListener("afterprint", once);

        var originalTitle = document.title;
        var noteName = getCurrentNoteName();
        if (noteName) document.title = noteName;

        try {
            window.print();
        } finally {
            /* Slight delay so the print dialog has actually rendered
               before we yank the DOM back. */
            setTimeout(function () {
                document.title = originalTitle;
                once();
            }, 250);
        }
    }

    /* ---- markdown choice dialog ---- */

    function askMarkdownChoice() {
        return new Promise(function (resolve) {
            var overlay = document.createElement("div");
            overlay.className = "paste-image-overlay";
            overlay.id = "np-print-md-overlay";
            function tx(key) { return NP.escapeHtml(NP.t(key)); }
            overlay.innerHTML =
                '<div class="paste-image-modal">' +
                    '<h3>' + tx("print.mdDialog.title") + '</h3>' +
                    '<p>' + tx("print.mdDialog.message") + '</p>' +
                    '<div class="paste-image-buttons">' +
                        '<button id="np-print-rendered">' +
                            tx("print.mdDialog.rendered") +
                        '</button>' +
                        '<button id="np-print-raw-light">' +
                            tx("print.mdDialog.rawLight") +
                        '</button>' +
                        '<button id="np-print-raw-dark">' +
                            tx("print.mdDialog.rawDark") +
                        '</button>' +
                        '<button id="np-print-cancel">' + tx("print.mdDialog.cancel") + '</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(overlay);

            function close(choice) {
                document.removeEventListener("keydown", onKey);
                if (overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
                resolve(choice);
            }
            function onKey(e) {
                if (e.key === "Escape") close(null);
            }
            document.addEventListener("keydown", onKey);

            overlay.querySelector("#np-print-rendered")
                .addEventListener("click", function () { close("rendered"); });
            overlay.querySelector("#np-print-raw-light")
                .addEventListener("click", function () { close("raw-light"); });
            overlay.querySelector("#np-print-raw-dark")
                .addEventListener("click", function () { close("raw-dark"); });
            overlay.querySelector("#np-print-cancel")
                .addEventListener("click", function () { close(null); });
            overlay.addEventListener("click", function (e) {
                if (e.target === overlay) close(null);
            });
        });
    }

    /* ---- public API ---- */

    NP.print = {
        exportCurrentNote: function () {
            if (!NP.state || !NP.state.currentNoteId) {
                NP.dialog.alert(NP.t("print.noNoteSelected"));
                return;
            }
            if (isCurrentNoteLocked()) {
                NP.dialog.alert(NP.t("print.unlockFirst"));
                return;
            }

            if (isMarkdownMode()) {
                askMarkdownChoice().then(function (choice) {
                    if (!choice) return;  /* user cancelled */
                    if (choice === "raw-light" || choice === "raw-dark") {
                        var src = NP.markdown.getRawText
                            ? NP.markdown.getRawText()
                            : "";
                        var theme = choice === "raw-dark" ? "dark" : "light";
                        insertRawNode(src, theme);
                        doPrint(function () {
                            removeRawNode();
                        });
                    } else {
                        /* Rendered markdown — wrap #md-preview in table
                           so thead/tfoot spacers give per-page breathing
                           room without needing @page margin (which would
                           reintroduce Chrome's headers/footers). */
                        expandLinkedImages();
                        var unwrap = wrapHostForPrint("md-preview");
                        document.documentElement.classList.add("np-print-wrapped");
                        document.body.classList.add("np-print-wrapped");
                        ensureRawPageStyle();
                        doPrint(function () {
                            document.documentElement.classList.remove("np-print-wrapped");
                            document.body.classList.remove("np-print-wrapped");
                            clearRawPageStyle();
                            unwrap();
                            cleanupInjectedImages();
                        });
                    }
                });
                return;
            }

            /* Rich-text / plain mode — same table wrap trick. */
            expandLinkedImages();
            var unwrap = wrapHostForPrint("editor");
            document.documentElement.classList.add("np-print-wrapped");
            document.body.classList.add("np-print-wrapped");
            ensureRawPageStyle();
            doPrint(function () {
                document.documentElement.classList.remove("np-print-wrapped");
                document.body.classList.remove("np-print-wrapped");
                clearRawPageStyle();
                unwrap();
                cleanupInjectedImages();
            });
        }
    };

    document.addEventListener("DOMContentLoaded", function () {
        var btn = document.getElementById("btn-print");
        if (btn) {
            btn.addEventListener("click", function (e) {
                e.preventDefault();
                NP.print.exportCurrentNote();
            });
        }
    });

})(window.NP);

/* links.js - the app window never navigates away.

   Every activation of an <a href> anywhere in the document (click, Ctrl/
   Shift/Meta-click, middle-click, Enter) is intercepted in the capture
   phase and default-prevented:
     - http(s):/mailto: → window.open(…, "noopener,noreferrer"). In the
       desktop app pywebview hands new windows to the system browser.
     - /images/<name>   → in-app image viewer.
     - anything else    → nothing happens.
   Exception: download anchors created by the app itself (blob: or /api/
   with a `download` attribute). A plain click on a link inside the
   editable note only places the caret; Ctrl+click opens it.

   Dropping a file or link onto the window would also navigate it, so
   unhandled drops are cancelled too. */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    function isAppDownload(a) {
        if (!a.hasAttribute("download")) return false;
        var href = a.getAttribute("href") || "";
        return href.indexOf("blob:") === 0 || href.indexOf("/api/") === 0;
    }

    function onActivate(e) {
        if (e.type === "auxclick" && e.button !== 1) return;
        var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
        if (!a || isAppDownload(a)) return;

        e.preventDefault();
        /* In the editable note a click places the caret; Ctrl+click opens. */
        if (a.isContentEditable && e.type === "click" && !(e.ctrlKey || e.metaKey)) return;
        var href = a.getAttribute("href");
        var kind = NP.linkKind(href);
        if (kind === "external") {
            window.open(href.trim(), "_blank", "noopener,noreferrer");
        } else if (kind === "image" && NP.images && NP.images._openViewer) {
            NP.images._openViewer(href);
        }
    }

    /* Text dragged within an editable field keeps its native behaviour;
       files, or anything dropped elsewhere, would navigate the window. */
    function wouldNavigate(e) {
        var dt = e.dataTransfer;
        var hasFiles = !!(dt && dt.types && Array.prototype.indexOf.call(dt.types, "Files") !== -1);
        var t = e.target;
        var editable = !!(t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA"));
        return hasFiles || !editable;
    }

    function onDragOver(e) {
        if (wouldNavigate(e)) e.preventDefault();
    }

    function onDrop(e) {
        /* Handlers that accept a drop call preventDefault themselves. */
        if (!e.defaultPrevented && wouldNavigate(e)) e.preventDefault();
    }

    document.addEventListener("click", onActivate, true);
    document.addEventListener("auxclick", onActivate, true);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);

    NP.links = { _onActivate: onActivate };

})(window.NP);

/* mobile.js - Mobile/tablet UI: hamburger-triggered slide-out sidebar.

   Activates only when the layout is in mobile mode (viewport ≤ 900px,
   controlled by the @media (max-width: 900px) block in noirpad.css).
   On wider viewports nothing happens — the hamburger button is
   display:none and the sidebar keeps its desktop position. */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var MOBILE_BREAKPOINT = 900;
    var SIDEBAR_OPEN_CLASS = "mobile-open";
    var BACKDROP_VISIBLE_CLASS = "visible";

    function isMobile() {
        return window.innerWidth <= MOBILE_BREAKPOINT;
    }

    function openSidebar() {
        var sidebar = document.getElementById("sidebar");
        var backdrop = document.getElementById("sidebar-backdrop");
        var hamburger = document.getElementById("btn-hamburger");
        if (sidebar) sidebar.classList.add(SIDEBAR_OPEN_CLASS);
        if (backdrop) backdrop.classList.add(BACKDROP_VISIBLE_CLASS);
        if (hamburger) hamburger.classList.add("sidebar-open");
    }

    function closeSidebar() {
        var sidebar = document.getElementById("sidebar");
        var backdrop = document.getElementById("sidebar-backdrop");
        var hamburger = document.getElementById("btn-hamburger");
        if (sidebar) sidebar.classList.remove(SIDEBAR_OPEN_CLASS);
        if (backdrop) backdrop.classList.remove(BACKDROP_VISIBLE_CLASS);
        if (hamburger) hamburger.classList.remove("sidebar-open");
    }

    function toggleSidebar() {
        var sidebar = document.getElementById("sidebar");
        if (sidebar && sidebar.classList.contains(SIDEBAR_OPEN_CLASS)) {
            closeSidebar();
        } else {
            openSidebar();
        }
    }

    NP.mobile = {
        isMobile: isMobile,
        openSidebar: openSidebar,
        closeSidebar: closeSidebar,
        toggleSidebar: toggleSidebar
    };

    document.addEventListener("DOMContentLoaded", function () {
        var hamburger = document.getElementById("btn-hamburger");
        if (hamburger) {
            hamburger.addEventListener("click", function (e) {
                e.preventDefault();
                e.stopPropagation();
                toggleSidebar();
            });
        }

        var backdrop = document.getElementById("sidebar-backdrop");
        if (backdrop) {
            backdrop.addEventListener("click", closeSidebar);
        }

        /* Auto-close the sidebar once the user picks a note on mobile —
           sidebar takes 85vw, picking a note should hand the screen
           back to the editor. Folder rows and the chevron stay open
           so the user can expand/collapse without losing the panel.
           tree.js renders folders as `.tree-item.tree-item--folder`
           and notes as `.tree-item.tree-item--note` — gate on those. */
        var sidebar = document.getElementById("sidebar");
        if (sidebar) {
            sidebar.addEventListener("click", function (e) {
                if (!isMobile()) return;
                var item = e.target.closest(".tree-item");
                if (!item) return;
                if (item.classList.contains("tree-item--folder")) return;
                if (item.classList.contains("tree-item--trash")) return;
                /* Defer: let the existing tree click handler load the
                   note first so the close animation doesn't compete
                   with the editor swap. */
                setTimeout(closeSidebar, 150);
            });
        }

        /* Escape closes the slide-out (also closes desktop dialogs
           elsewhere, but those have their own handlers and this one
           is gated to mobile width). */
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && isMobile()) {
                var sb = document.getElementById("sidebar");
                if (sb && sb.classList.contains(SIDEBAR_OPEN_CLASS)) {
                    closeSidebar();
                }
            }
        });

        /* Resizing past the breakpoint (e.g. rotating tablet to
           landscape) — drop the mobile-only state so the desktop
           layout doesn't inherit a stuck `.mobile-open` class. */
        window.addEventListener("resize", function () {
            if (!isMobile()) closeSidebar();
        });
    });

})(window.NP);

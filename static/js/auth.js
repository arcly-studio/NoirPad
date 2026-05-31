/* auth.js - NoirPad authentication screen + session lifecycle.
   Gate that runs BEFORE the main app boots. If /api/auth/me succeeds,
   we hand control to NP.app.init(); otherwise we render the auth overlay
   and only proceed once the user logs in or registers. */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var currentUser = null;
    var overlay = null;
    var mode = "login"; // "login" | "register"

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                if (k === "class") node.className = attrs[k];
                else if (k === "html") node.innerHTML = attrs[k];
                else if (k === "text") node.textContent = attrs[k];
                else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") {
                    node.addEventListener(k.slice(2), attrs[k]);
                } else if (attrs[k] !== undefined && attrs[k] !== null) {
                    node.setAttribute(k, attrs[k]);
                }
            });
        }
        (children || []).forEach(function (c) {
            if (c == null) return;
            if (typeof c === "string") node.appendChild(document.createTextNode(c));
            else node.appendChild(c);
        });
        return node;
    }

    function buildOverlay() {
        if (overlay) return overlay;

        overlay = el("div", { id: "auth-overlay", class: "auth-overlay" }, [
            el("div", { class: "auth-window" }, [
                el("pre", { id: "auth-ascii", class: "auth-ascii", html:
" _   _       _      ____           _\n" +
"| \\ | | ___ (_)_ __|  _ \\ __ _  __| |\n" +
"|  \\| |/ _ \\| | '__| |_) / _` |/ _` |\n" +
"| |\\  | (_) | | |  |  __/ (_| | (_| |\n" +
"|_| \\_|\\___/|_|_|  |_|   \\__,_|\\__,_|"
                }),
                el("div", { class: "auth-subtitle", id: "auth-subtitle",
                    text: "// secure terminal — authentication required" }),
                el("form", { id: "auth-form", class: "auth-form" }, [
                    el("div", { class: "auth-row" }, [
                        el("label", { for: "auth-username", text: "username" }),
                        el("input", {
                            id: "auth-username",
                            type: "text",
                            autocomplete: "username",
                            spellcheck: "false",
                            required: "required"
                        })
                    ]),
                    el("div", { class: "auth-row" }, [
                        el("label", { for: "auth-password", text: "password" }),
                        el("input", {
                            id: "auth-password",
                            type: "password",
                            autocomplete: "current-password",
                            required: "required"
                        })
                    ]),
                    el("div", { class: "auth-row auth-row-inline", id: "auth-remember-row" }, [
                        el("label", { class: "auth-check" }, [
                            el("input", { id: "auth-remember", type: "checkbox", checked: "checked" }),
                            el("span", { text: " remember me (30 days)" })
                        ])
                    ]),
                    el("div", { id: "auth-error", class: "auth-error" }),
                    el("button", {
                        id: "auth-submit",
                        type: "submit",
                        class: "auth-submit"
                    }, [document.createTextNode("> LOGIN")]),
                    el("div", { class: "auth-toggle" }, [
                        el("span", { id: "auth-toggle-prompt", text: "no account?" }),
                        el("button", {
                            id: "auth-toggle-btn",
                            type: "button",
                            class: "auth-link",
                            text: "register"
                        })
                    ])
                ])
            ])
        ]);

        document.body.appendChild(overlay);

        var form = overlay.querySelector("#auth-form");
        form.addEventListener("submit", onSubmit);
        overlay.querySelector("#auth-toggle-btn").addEventListener("click", toggleMode);

        return overlay;
    }

    function renderMode() {
        if (!overlay) return;
        var btn = overlay.querySelector("#auth-submit");
        var togglePrompt = overlay.querySelector("#auth-toggle-prompt");
        var toggleBtn = overlay.querySelector("#auth-toggle-btn");
        var rememberRow = overlay.querySelector("#auth-remember-row");
        var subtitle = overlay.querySelector("#auth-subtitle");
        var pw = overlay.querySelector("#auth-password");

        if (mode === "login") {
            btn.textContent = "> LOGIN";
            togglePrompt.textContent = "no account?";
            toggleBtn.textContent = "register";
            rememberRow.style.display = "";
            subtitle.textContent = "// secure terminal — authentication required";
            pw.setAttribute("autocomplete", "current-password");
        } else {
            btn.textContent = "> REGISTER";
            togglePrompt.textContent = "already have an account?";
            toggleBtn.textContent = "login";
            rememberRow.style.display = "none";
            subtitle.textContent = "// new account — min. 8 chars for password";
            pw.setAttribute("autocomplete", "new-password");
        }
        showError("");
    }

    function toggleMode() {
        mode = (mode === "login") ? "register" : "login";
        renderMode();
        var u = overlay.querySelector("#auth-username");
        if (u) u.focus();
    }

    function showError(msg) {
        if (!overlay) return;
        var box = overlay.querySelector("#auth-error");
        box.textContent = msg || "";
        box.style.display = msg ? "block" : "none";
    }

    function setBusy(busy) {
        if (!overlay) return;
        var btn = overlay.querySelector("#auth-submit");
        btn.disabled = !!busy;
        btn.classList.toggle("auth-busy", !!busy);
    }

    function onSubmit(e) {
        e.preventDefault();
        var username = overlay.querySelector("#auth-username").value.trim();
        var password = overlay.querySelector("#auth-password").value;
        var remember = overlay.querySelector("#auth-remember").checked;
        if (!username) { showError("Username required"); return; }
        if (!password) { showError("Password required"); return; }
        if (mode === "register" && password.length < 8) {
            showError("Password must be at least 8 characters");
            return;
        }
        showError("");
        setBusy(true);

        var op = mode === "login"
            ? NP.api.authLogin(username, password, remember)
            : NP.api.authRegister(username, password);

        op.then(function (res) {
            currentUser = res && res.username;
            hide();
            return bootApp();
        }).catch(function (err) {
            setBusy(false);
            showError((err && err.message) || "Authentication failed");
        });
    }

    function show() {
        buildOverlay();
        overlay.classList.add("auth-visible");
        document.body.classList.add("auth-active");
        renderMode();
        // Focus username after a tick so the browser doesn't fight us.
        setTimeout(function () {
            var u = overlay.querySelector("#auth-username");
            if (u) u.focus();
        }, 50);
    }

    function hide() {
        if (!overlay) return;
        overlay.classList.remove("auth-visible");
        document.body.classList.remove("auth-active");
    }

    function bootApp() {
        // Hand off to the main app. NP.app.init is the previous bootstrap.
        if (NP.app && NP.app.init) {
            return NP.app.init();
        }
        return Promise.resolve();
    }

    function logout() {
        return NP.api.authLogout().catch(function () {
            // Logout failure: just force a reload — server cookie state
            // is unrecoverable from the client side anyway.
        }).then(function () {
            // Stop polling so old endpoints don't keep 401'ing.
            window.location.reload();
        });
    }

    NP.auth = {
        getUser: function () { return currentUser; },
        logout: logout,
        showLogin: function () {
            mode = "login";
            show();
        },
        /* Called by the very first DOMContentLoaded handler. Decides
           between "user already authed, render the app" and "show login". */
        start: function () {
            return NP.api.authMe().then(function (res) {
                currentUser = res && res.username;
                return bootApp();
            }).catch(function (err) {
                if (err && (err.unauthorized || err.status === 401)) {
                    show();
                    return;
                }
                // Backend totally down — surface in the splash like before.
                var splash = document.getElementById("splash-overlay");
                if (splash) {
                    var sub = document.getElementById("splash-subtitle");
                    if (sub) sub.textContent = "Failed to reach server: " + (err && err.message ? err.message : err);
                }
            });
        }
    };

})(window.NP);

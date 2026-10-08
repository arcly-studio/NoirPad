/* auth.js - NoirPad start gate.
   NoirPad has a single local profile. Only a self-hosted server started
   with NOIRPAD_PASSWORD asks for a password; everything else boots the
   app straight away. */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var session = null;   // last /api/session response
    var overlay = null;

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                if (k === "class") node.className = attrs[k];
                else if (k === "text") node.textContent = attrs[k];
                else if (attrs[k] !== undefined && attrs[k] !== null) {
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
                el("pre", { id: "auth-ascii", class: "auth-ascii", text:
" _   _       _      ____           _\n" +
"| \\ | | ___ (_)_ __|  _ \\ __ _  __| |\n" +
"|  \\| |/ _ \\| | '__| |_) / _` |/ _` |\n" +
"| |\\  | (_) | | |  |  __/ (_| | (_| |\n" +
"|_| \\_|\\___/|_|_|  |_|   \\__,_|\\__,_|"
                }),
                el("div", { class: "auth-subtitle",
                    text: "// this server is password protected" }),
                el("form", { id: "auth-form", class: "auth-form" }, [
                    el("div", { class: "auth-row" }, [
                        el("label", { for: "auth-password", text: "password" }),
                        el("input", {
                            id: "auth-password",
                            type: "password",
                            autocomplete: "current-password",
                            required: "required"
                        })
                    ]),
                    el("div", { class: "auth-row auth-row-inline" }, [
                        el("label", { class: "auth-check" }, [
                            el("input", { id: "auth-remember", type: "checkbox", checked: "checked" }),
                            el("span", { text: " remember me (30 days)" })
                        ])
                    ]),
                    el("div", { id: "auth-error", class: "auth-error" }),
                    el("button", {
                        id: "auth-submit",
                        type: "submit",
                        class: "auth-submit",
                        text: "> UNLOCK"
                    })
                ])
            ])
        ]);

        document.body.appendChild(overlay);
        overlay.querySelector("#auth-form").addEventListener("submit", onSubmit);
        return overlay;
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
        var pwInput = overlay.querySelector("#auth-password");
        var password = pwInput.value;
        var remember = overlay.querySelector("#auth-remember").checked;
        if (!password) { showError("Password required"); return; }
        showError("");
        setBusy(true);

        NP.api.login(password, remember).then(function () {
            pwInput.value = "";
            if (session) session.authenticated = true;
            hide();
            return bootApp();
        }).catch(function (err) {
            setBusy(false);
            showError((err && err.message) || "Login failed");
        });
    }

    function show() {
        buildOverlay();
        overlay.classList.add("auth-visible");
        document.body.classList.add("auth-active");
        showError("");
        setTimeout(function () {
            var pw = overlay.querySelector("#auth-password");
            if (pw) pw.focus();
        }, 50);
    }

    function hide() {
        if (!overlay) return;
        overlay.classList.remove("auth-visible");
        document.body.classList.remove("auth-active");
    }

    function bootApp() {
        if (NP.app && NP.app.init) {
            return NP.app.init();
        }
        return Promise.resolve();
    }

    function showStartError(err) {
        var sub = document.getElementById("splash-subtitle");
        if (sub) sub.textContent = "Failed to reach server: " + (err && err.message ? err.message : err);
    }

    NP.auth = {
        /* True when the server asks for a password (logout makes sense). */
        passwordRequired: function () {
            return !!(session && session.password_required);
        },
        logout: function () {
            return NP.api.logout().catch(function () {
                /* reload anyway — the server drops the session on restart */
            }).then(function () {
                window.location.reload();
            });
        },
        start: function () {
            return NP.api.session().then(function (res) {
                session = res || {};
                if (session.password_required && !session.authenticated) {
                    show();
                    return;
                }
                return bootApp();
            }).catch(showStartError);
        }
    };

})(window.NP);

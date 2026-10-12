/* app-lock.js - optional "App lock" (Settings → App lock).

   A password asked when NoirPad starts (auth.js shows the gate) and after
   auto-lock. The server stores only a scrypt hash and refuses every API
   call (423) until the window unlocks. It does NOT encrypt notes — only
   locked notes are encrypted. There is no reset in the app: a forgotten
   password means removing `app_lock` from the data file (README). */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var MIN_PASSWORD = 8;

    function $(id) { return document.getElementById(id); }

    function message(err) {
        return err && err.message ? err.message : String(err);
    }

    function askNew(title) {
        return NP.passwordDialog.ask({
            title: title,
            message: NP.t("appLock.chooseMessage", { min: MIN_PASSWORD }),
            warning: NP.t("appLock.chooseWarning"),
            confirm: true,
            minLength: MIN_PASSWORD,
            okLabel: NP.t("appLock.setPassword")
        });
    }

    function askCurrent(title) {
        return NP.passwordDialog.ask({
            title: title,
            message: NP.t("appLock.currentMessage"),
            okLabel: NP.t("appLock.continue")
        });
    }

    function render() {
        var toggle = $("setting-app-lock");
        if (toggle) {
            toggle.classList.toggle("on", NP.appLock.enabled);
            toggle.setAttribute("aria-checked", NP.appLock.enabled ? "true" : "false");
        }
        var actions = $("setting-app-lock-actions");
        if (actions) actions.hidden = !NP.appLock.enabled;
    }

    NP.appLock = {
        enabled: false,   /* set by auth.js from /api/session */

        init: function () {
            render();
            var toggle = $("setting-app-lock");
            if (toggle) {
                toggle.addEventListener("click", function () {
                    (NP.appLock.enabled ? NP.appLock.disable() : NP.appLock.enable())
                        .then(render);
                });
            }
            var change = $("setting-app-lock-change");
            if (change) change.addEventListener("click", function () { NP.appLock.change(); });
            var now = $("setting-app-lock-now");
            if (now) now.addEventListener("click", function () { NP.appLock.lockNow(); });
        },

        enable: function () {
            return askNew(NP.t("appLock.enableTitle")).then(function (password) {
                if (!password) return;
                return NP.api.appLockEnable(password).then(function () {
                    NP.appLock.enabled = true;
                });
            }).catch(function (err) { alert(NP.t("appLock.failed", { error: message(err) })); });
        },

        change: function () {
            return askCurrent(NP.t("appLock.changeTitle")).then(function (current) {
                if (!current) return;
                return askNew(NP.t("appLock.newTitle")).then(function (password) {
                    if (!password) return;
                    return NP.api.appLockEnable(password, current);
                });
            }).catch(function (err) { alert(NP.t("appLock.failed", { error: message(err) })); });
        },

        disable: function () {
            return askCurrent(NP.t("appLock.disableTitle")).then(function (password) {
                if (!password) return;
                return NP.api.appLockDisable(password).then(function () {
                    NP.appLock.enabled = false;
                });
            }).catch(function (err) { alert(NP.t("appLock.failed", { error: message(err) })); });
        },

        /* Save, lock (the server also forgets unlocked note keys), and
           reload into the gate, so no note text stays in this page. */
        lockNow: function () {
            var ed = NP.editor;
            var flush = ed && ed.save ? ed.save(true) : Promise.resolve();
            return flush.catch(function () { /* locking matters more */ }).then(function () {
                return NP.api.appLockLock();
            }).catch(function () { /* reload shows the gate anyway */ }).then(function () {
                window.location.reload();
            });
        }
    };

})(window.NP);

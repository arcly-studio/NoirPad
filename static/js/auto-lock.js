/* auto-lock.js - Auto-lock encrypted notes after a period of inactivity.
 *
 * Setting: idle_lock_minutes ("off" | "5" | "30" | "60"). When on, any
 * user activity resets an idle timer; on expiry every currently-unlocked
 * encrypted note is re-locked via NP.encryption.lockAll() (in this app
 * that's the single open note, unlocked via editor._unlockToken).
 */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var idleTimer = null;
    var currentIdleMinutes = 0;   /* 0 = off */
    var lastActivity = Date.now();

    var ACTIVITY_EVENTS = [
        "mousedown", "mousemove", "keydown", "keypress",
        "touchstart", "touchmove", "scroll", "click", "wheel"
    ];

    var activityHandler = null;

    function clearTimer() {
        if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
        }
    }

    function startTimer() {
        clearTimer();
        if (currentIdleMinutes <= 0) return;            /* off */
        var ms = currentIdleMinutes * 60 * 1000;        /* minutes */
        idleTimer = setTimeout(onIdleExpired, ms);
    }

    function resetTimer() {
        lastActivity = Date.now();
        startTimer();
    }

    function onIdleExpired() {
        lockAllUnlockedEncryptedNotes();
        /* Restart, not stop: if the user stays idle and later opens
           another encrypted note it gets locked again. */
        startTimer();
    }

    function lockAllUnlockedEncryptedNotes() {
        var locked = false;
        if (NP.encryption && NP.encryption.lockAll) {
            locked = !!NP.encryption.lockAll();
        }
        if (locked) {
            console.log("[auto-lock] Encrypted note locked after idle");
        }
    }

    function attachActivityListeners() {
        if (activityHandler) return;                    /* already attached */
        activityHandler = function () { resetTimer(); };
        for (var i = 0; i < ACTIVITY_EVENTS.length; i++) {
            document.addEventListener(
                ACTIVITY_EVENTS[i], activityHandler, { passive: true }
            );
        }
    }

    function detachActivityListeners() {
        if (!activityHandler) return;
        for (var i = 0; i < ACTIVITY_EVENTS.length; i++) {
            document.removeEventListener(
                ACTIVITY_EVENTS[i], activityHandler
            );
        }
        activityHandler = null;
    }

    NP.autoLock = {

        /* minutes: 0 = off, otherwise a positive number. */
        setMinutes: function (minutes) {
            var n = parseInt(minutes, 10);
            currentIdleMinutes = isNaN(n) || n < 0 ? 0 : n;

            if (currentIdleMinutes <= 0) {
                detachActivityListeners();
                clearTimer();
            } else {
                attachActivityListeners();
                resetTimer();                           /* count from now */
            }
        },

        getMinutes: function () {
            return currentIdleMinutes;
        },

        /* Force-lock now (testing / manual). */
        triggerNow: function () {
            onIdleExpired();
        },

        init: function () {
            var val = "off";
            if (NP.state && NP.state.data &&
                NP.state.data.idle_lock_minutes != null) {
                val = NP.state.data.idle_lock_minutes;
            }
            /* "off" -> NaN -> 0; "5"/"30"/"60" (or numbers) -> minutes */
            var n = parseInt(val, 10);
            NP.autoLock.setMinutes(isNaN(n) ? 0 : n);
        }
    };

})(window.NP);

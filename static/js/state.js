/* state.js - NoirPad client-side state management */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var POLL_INTERVAL = 5000;
    var FOLDER_STORAGE_KEY = "noirpad_folder_states";
    var pollTimer = null;

    NP.state = {
        data: null,
        etag: null,
        openTabs: [],
        activeTabId: null,
        currentNoteId: null,
        selectedId: null,
        focusMode: false,
        fullscreen: false,
        searchVisible: false,
        commandBarVisible: false,
        matrixRunning: false,

        init: function () {
            return NP.api.getDataIfChanged(null).then(function (res) {
                NP.state.data = res.data;
                NP.state.etag = res.etag;
                return res.data;
            });
        },

        /* Pick up changes made elsewhere (another tab, a restored backup).
           Only while the window is visible, and the server answers 304
           when nothing changed (D13). */
        poll: function () {
            if (document.visibilityState !== "visible") return Promise.resolve();
            return NP.api.getDataIfChanged(NP.state.etag).then(function (res) {
                if (!res) return;
                NP.state.data = res.data;
                NP.state.etag = res.etag;
                if (NP.tree && NP.tree.render) NP.tree.render();
            }).catch(function () {
                /* offline / locked: try again on the next tick */
            });
        },

        startPolling: function () {
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = setInterval(NP.state.poll, POLL_INTERVAL);
            document.addEventListener("visibilitychange", function () {
                if (document.visibilityState === "visible") NP.state.poll();
            });
        },

        getTheme: function () {
            if (NP.state.data && NP.state.data.theme) {
                return NP.state.data.theme;
            }
            return "matrix";
        },

        getFolderOpenState: function (id) {
            var states = NP.state._loadFolderStates();
            return states[id] === true;
        },

        setFolderOpenState: function (id, open) {
            var states = NP.state._loadFolderStates();
            if (open) {
                states[id] = true;
            } else {
                delete states[id];
            }
            NP.state._saveFolderStates(states);
        },

        _loadFolderStates: function () {
            try {
                var raw = localStorage.getItem(FOLDER_STORAGE_KEY);
                if (raw) return JSON.parse(raw);
            } catch (e) { /* ignore */ }
            return {};
        },

        _saveFolderStates: function (states) {
            try {
                localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(states));
            } catch (e) { /* ignore */ }
        }
    };

})(window.NP);

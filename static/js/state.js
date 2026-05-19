/* state.js - NoirPad client-side state management */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var POLL_INTERVAL = 5000;
    var FOLDER_STORAGE_KEY = "noirpad_folder_states";
    var pollTimer = null;

    NP.state = {
        data: null,
        version: 0,
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
            return NP.api.getData().then(function (data) {
                NP.state.data = data;
                NP.state.version = data._version || 0;
                return data;
            });
        },

        poll: function () {
            return NP.api.getVersion().then(function (res) {
                var newVersion = (res && res.version) || 0;
                if (newVersion && newVersion !== NP.state.version) {
                    return NP.api.getData().then(function (data) {
                        NP.state.data = data;
                        NP.state.version = newVersion;
                        /* Reflect remote changes in the UI */
                        if (NP.tree && NP.tree.render) NP.tree.render();
                    });
                }
            }).catch(function () {
                /* silently ignore polling errors */
            });
        },

        startPolling: function () {
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = setInterval(function () {
                NP.state.poll();
            }, POLL_INTERVAL);
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

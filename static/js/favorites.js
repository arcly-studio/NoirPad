/* favorites.js - NoirPad favorites management */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    NP.favorites = {
        toggle: function () {
            var noteId = NP.state && NP.state.currentNoteId;
            if (!noteId) return Promise.resolve();
            /* A note shown from the trash cannot be a favorite (T9). */
            if (NP.editor && NP.editor._trashedId === noteId) return Promise.resolve();

            return NP.api.toggleFavorite(noteId).then(function () {
                /* Update local state */
                if (NP.state.data) {
                    if (!NP.state.data.favorites) NP.state.data.favorites = [];
                    var idx = NP.state.data.favorites.indexOf(noteId);
                    if (idx === -1) {
                        NP.state.data.favorites.push(noteId);
                    } else {
                        NP.state.data.favorites.splice(idx, 1);
                    }
                }
                if (NP.tree && NP.tree.render) NP.tree.render();
                if (NP.topbar && NP.topbar.refresh) NP.topbar.refresh();
            }).catch(function (err) {
                console.error("Failed to toggle favorite:", err);
                if (NP.dialog && NP.dialog.failed) NP.dialog.failed(err);
            });
        },

        isFavorite: function (id) {
            if (!NP.state || !NP.state.data || !NP.state.data.favorites) return false;
            return NP.state.data.favorites.indexOf(id) !== -1;
        }
    };

})(window.NP);

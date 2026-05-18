/* trash.js - NoirPad trash management */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    NP.trash = {
        restore: function (id) {
            if (!id) return Promise.resolve();
            return NP.api.restoreFromTrash(id).then(function () {
                return NP.state.poll();
            }).then(function () {
                if (NP.tree && NP.tree.render) NP.tree.render();
            }).catch(function (err) {
                console.error("Failed to restore item:", err);
            });
        },

        empty: function () {
            var ok = confirm("Permanently delete all items in trash? This cannot be undone.");
            if (!ok) return Promise.resolve();

            return NP.api.emptyTrash().then(function () {
                return NP.state.poll();
            }).then(function () {
                if (NP.tree && NP.tree.render) NP.tree.render();
            }).catch(function (err) {
                console.error("Failed to empty trash:", err);
            });
        }
    };

})(window.NP);

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
            return NP.dialog.confirm(NP.t("trash.confirmEmpty"), {
                title: NP.t("trash.emptyTitle"),
                okLabel: NP.t("trash.emptyTitle"),
                danger: true
            }).then(function (ok) {
                if (!ok) return;
                return NP.api.emptyTrash().then(function () {
                    return NP.state.poll();
                }).then(function () {
                    if (NP.tree && NP.tree.render) NP.tree.render();
                });
            }).catch(function (err) {
                console.error("Failed to empty trash:", err);
            });
        }
    };

})(window.NP);

/* backup.js - NoirPad backup/restore */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    NP.backup = {
        download: function () {
            NP.api.downloadBackup();
        },

        import: function () {
            var input = document.createElement("input");
            input.type = "file";
            input.accept = ".zip";
            input.style.display = "none";

            input.addEventListener("change", function () {
                var file = input.files && input.files[0];
                if (!file) return;
                NP.dialog.confirm(NP.t("backup.importConfirm", { name: file.name }), {
                    title: NP.t("backup.importTitle"),
                    okLabel: NP.t("backup.importOk"),
                    danger: true
                }).then(function (ok) {
                    if (!ok) {
                        document.body.removeChild(input);
                        return;
                    }

                    return NP.api.importBackup(file).then(function () {
                        /* Reload everything */
                        return NP.state.init();
                    }).then(function () {
                        if (NP.tree && NP.tree.render) NP.tree.render();
                        if (NP.themes && NP.themes.apply && NP.state.data) {
                            NP.themes.apply(NP.state.data.theme);
                        }
                        NP.dialog.alert(NP.t("backup.importSuccess"));
                    }).catch(function (err) {
                        NP.dialog.alert(NP.t("backup.importFailed", { error: err.message }));
                    }).finally(function () {
                        document.body.removeChild(input);
                    });
                });
            });

            document.body.appendChild(input);
            input.click();
        }
    };

})(window.NP);

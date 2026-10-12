/* export.js - NoirPad export functionality */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    NP.export = {
        txt: function () {
            var noteId = NP.state && NP.state.currentNoteId;
            if (!noteId) {
                alert(NP.t("export.noNoteSelected"));
                return;
            }
            NP.api.exportTxt(noteId);
        },

        html: function () {
            var noteId = NP.state && NP.state.currentNoteId;
            if (!noteId) {
                alert(NP.t("export.noNoteSelected"));
                return;
            }
            NP.api.exportHtml(noteId);
        }
    };

})(window.NP);

/* export.js - NoirPad export functionality */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    NP.export = {
        txt: function () {
            var noteId = NP.state && NP.state.currentNoteId;
            if (!noteId) {
                NP.dialog.alert(NP.t("export.noNoteSelected"));
                return;
            }
            NP.api.exportTxt(noteId);
        },

        html: function () {
            var noteId = NP.state && NP.state.currentNoteId;
            if (!noteId) {
                NP.dialog.alert(NP.t("export.noNoteSelected"));
                return;
            }
            NP.api.exportHtml(noteId);
        },

        /* The note as Markdown: a .md file, or a .zip with assets/ when
           it shows pictures. */
        md: function () {
            var noteId = NP.state && NP.state.currentNoteId;
            if (!noteId) {
                NP.dialog.alert(NP.t("export.noNoteSelected"));
                return;
            }
            NP.api.exportMd(noteId);
        }
    };

})(window.NP);

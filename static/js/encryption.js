/* encryption.js - NoirPad note encryption */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    NP.encryption = {
        encrypt: function () {
            var noteId = NP.state && NP.state.currentNoteId;
            if (!noteId) {
                alert("No note selected.");
                return Promise.resolve();
            }

            if (NP.encryption.isEncrypted(noteId)) {
                alert("Note is already encrypted.");
                return Promise.resolve();
            }

            var password = prompt("Enter encryption password:");
            if (!password) return Promise.resolve();

            var passwordConfirm = prompt("Confirm encryption password:");
            if (passwordConfirm !== password) {
                alert("Passwords do not match.");
                return Promise.resolve();
            }

            return NP.api.encrypt(noteId, password).then(function () {
                /* Reload note content */
                if (NP.editor && NP.editor.loadNote) {
                    return NP.editor.loadNote(noteId);
                }
            }).catch(function (err) {
                alert("Encryption failed: " + err.message);
            });
        },

        decrypt: function () {
            var noteId = NP.state && NP.state.currentNoteId;
            if (!noteId) {
                alert("No note selected.");
                return Promise.resolve();
            }

            if (!NP.encryption.isEncrypted(noteId)) {
                alert("Note is not encrypted.");
                return Promise.resolve();
            }

            var password = prompt("Enter decryption password:");
            if (!password) return Promise.resolve();

            return NP.api.decrypt(noteId, password).then(function () {
                /* Reload note content */
                if (NP.editor && NP.editor.loadNote) {
                    return NP.editor.loadNote(noteId);
                }
            }).catch(function (err) {
                alert("Decryption failed: " + err.message);
            });
        },

        isEncrypted: function (noteId) {
            if (!NP.state || !NP.state.data || !NP.state.data.notes) return false;
            var content = NP.state.data.notes[noteId];
            if (!content || typeof content !== "string") return false;

            /* Encrypted notes are stored as JSON with salt and data fields */
            try {
                var parsed = JSON.parse(content);
                return !!(parsed && parsed.encrypted && parsed.data);
            } catch (e) {
                return false;
            }
        }
    };

})(window.NP);

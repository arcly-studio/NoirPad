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

        /* ----------------------------------------------------------------
           State-aware Lock button
           ----------------------------------------------------------------
           The #btn-lock button has 3 behaviours, decided from the editor's
           authoritative view of the open note (NP.state.data is only
           refreshed by the 5s poll, so it lies right after encrypt/decrypt):

             A  plain note                -> encrypt (prompt password)
             B  encrypted + UNLOCKED      -> remove encryption (confirm)
             C  encrypted + LOCKED        -> unlock to view (prompt password)

           "unlocked" == we hold the password in memory
           (NP.editor._encryptedNotePassword) and the plaintext is shown.
           ---------------------------------------------------------------- */

        handleLockButtonClick: function () {
            var ed = NP.editor;
            var id = ed && ed._currentNoteId;
            if (!id) {
                alert("No note selected.");
                return;
            }

            if (!ed._currentNoteEncrypted) {
                /* STATE A — plain → encrypt */
                NP.encryption.encrypt();
            } else if (ed._encryptedNotePassword) {
                /* STATE B — encrypted + unlocked → remove encryption */
                NP.encryption.removeEncryption();
            } else {
                /* STATE C — encrypted + locked → unlock for viewing */
                NP.encryption.unlock();
            }
        },

        /* STATE C: re-run loadNote, which prompts for the password and
           decrypts for viewing (file stays encrypted). On success the
           note moves to STATE B. */
        unlock: function () {
            var id = NP.editor && NP.editor._currentNoteId;
            if (!id) return Promise.resolve();
            if (NP.editor && NP.editor.loadNote) {
                return NP.editor.loadNote(id);
            }
            return Promise.resolve();
        },

        /* STATE B: permanently strip encryption. The note is currently
           unlocked, so we already hold the password in memory — no
           re-prompt. A confirm dialog is mandatory (destructive). */
        removeEncryption: function () {
            var ed = NP.editor;
            var id = ed && ed._currentNoteId;
            if (!id) return Promise.resolve();

            var pw = ed._encryptedNotePassword;
            if (!pw) {
                /* Defensive: only reachable if the note is locked. The
                   caller must unlock first (STATE C). */
                alert("Unlock this note first, then remove encryption.");
                return Promise.resolve();
            }

            var ok = window.confirm(
                "Remove encryption from this note?\n\n" +
                "The password protection will be permanently removed and " +
                "the content saved as plain text."
            );
            if (!ok) return Promise.resolve();

            /* Stop autosave up front: an encrypted autosave firing during
               the decrypt request would immediately re-encrypt the note
               we are trying to strip. */
            if (ed.stopAutosave) ed.stopAutosave();

            /* Flush the latest editor buffer (re-encrypted with pw) so any
               unsaved edits survive the round-trip, THEN decrypt the
               server copy permanently. */
            var flush = (ed.save) ? ed.save(true) : Promise.resolve();

            return flush.then(function () {
                return NP.api.decrypt(id, pw);
            }).then(function () {
                /* Server content is plaintext again. Drop the in-memory
                   password and encrypted flag so save()/autosave won't
                   re-encrypt, then reload to render the plain note. */
                ed._encryptedNotePassword = null;
                ed._currentNoteEncrypted = false;
                if (ed.loadNote) {
                    return ed.loadNote(id);
                }
            }).catch(function (err) {
                /* Still encrypted + still unlocked in memory — restore
                   autosave so the user doesn't silently lose edits. */
                if (ed.startAutosave) ed.startAutosave();
                alert("Failed to remove encryption: " +
                    (err && err.message ? err.message : err));
            });
        },

        /* Sync the #btn-lock label/title with the open note's lock
           state. Driven by the editor's authoritative state. */
        updateLockButtonState: function () {
            var btn = document.getElementById("btn-lock");
            if (!btn) return;

            var ed = NP.editor;
            var id = ed && ed._currentNoteId;

            if (!id) {
                btn.textContent = "Lock";
                btn.title = "Encrypt this note with a password";
                return;
            }

            if (!ed._currentNoteEncrypted) {
                /* STATE A */
                btn.textContent = "Lock";
                btn.title = "Encrypt this note with a password";
            } else if (ed._encryptedNotePassword) {
                /* STATE B */
                btn.textContent = "Remove lock";
                btn.title = "Remove encryption from this note";
            } else {
                /* STATE C */
                btn.textContent = "Unlock";
                btn.title = "Enter password to view this note";
            }
        },

        /* Re-lock any encrypted note that is currently decrypted in
           memory. This app keeps at most ONE such note: the open note in
           the editor, held only by NP.editor._encryptedNotePassword (the
           file + NP.state.data stay encrypted strings — decryptView never
           writes). Locking = stop autosave, drop the password, and wipe
           the decrypted DOM via the lock screen. Returns true if it
           actually locked something. */
        lockAll: function () {
            if (!NP.editor) return false;
            var id = NP.editor._currentNoteId;
            if (!id || !NP.editor._encryptedNotePassword) return false;
            if (!NP.encryption.isEncrypted(id)) return false;

            if (NP.editor.stopAutosave) NP.editor.stopAutosave();
            NP.editor._encryptedNotePassword = null;
            if (NP.editor._showLockScreen) NP.editor._showLockScreen();
            /* B -> C: reflect the now-locked state on the button. */
            NP.encryption.updateLockButtonState();
            return true;
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

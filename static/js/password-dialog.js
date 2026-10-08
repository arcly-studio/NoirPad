/* password-dialog.js - modal password prompt (replaces window.prompt).

   NP.passwordDialog.ask({
       title, message,          // text only
       warning,                 // optional text, shown highlighted
       confirm: true,           // ask twice (setting a new password)
       minLength: 8,            // rejected inline when shorter
       okLabel: "Unlock"
   }) → Promise<string|null>    // null = cancelled

   Inputs are type=password; the value is never kept after closing. */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    function passwordInput(id, placeholder, autocomplete) {
        var input = el("input", "dialog-input");
        input.type = "password";
        input.id = id;
        input.placeholder = placeholder;
        input.setAttribute("autocomplete", autocomplete);
        input.setAttribute("spellcheck", "false");
        input.setAttribute("maxlength", "1024");
        return input;
    }

    function ask(opts) {
        opts = opts || {};
        var minLength = opts.minLength || 0;

        return new Promise(function (resolve) {
            var overlay = el("div", "dialog-overlay visible np-password-dialog");
            overlay.setAttribute("role", "dialog");
            overlay.setAttribute("aria-modal", "true");
            var box = el("form", "dialog-box");
            box.appendChild(el("div", "dialog-title", opts.title || "Password"));
            if (opts.message) box.appendChild(el("div", "dialog-message", opts.message));
            if (opts.warning) box.appendChild(el("div", "dialog-message np-password-warning", opts.warning));

            var auto = opts.confirm ? "new-password" : "current-password";
            var first = passwordInput("np-pw-1", "Password", auto);
            box.appendChild(first);
            var second = null;
            if (opts.confirm) {
                second = passwordInput("np-pw-2", "Repeat password", auto);
                box.appendChild(second);
            }
            var error = el("div", "dialog-message np-password-error");
            error.setAttribute("role", "alert");
            box.appendChild(error);

            var buttons = el("div", "dialog-buttons");
            var cancel = el("button", "dialog-btn", "Cancel");
            cancel.type = "button";
            var ok = el("button", "dialog-btn primary", opts.okLabel || "OK");
            ok.type = "submit";
            buttons.appendChild(cancel);
            buttons.appendChild(ok);
            box.appendChild(buttons);
            overlay.appendChild(box);
            document.body.appendChild(overlay);

            function close(value) {
                document.removeEventListener("keydown", onKey, true);
                first.value = "";
                if (second) second.value = "";
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                resolve(value);
            }

            function onKey(e) {
                if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    close(null);
                }
            }

            box.addEventListener("submit", function (e) {
                e.preventDefault();
                var value = first.value;
                if (!value) {
                    error.textContent = "Enter a password.";
                } else if (value.length < minLength) {
                    error.textContent = "Use at least " + minLength + " characters.";
                } else if (second && second.value !== value) {
                    error.textContent = "The passwords do not match.";
                    second.value = "";
                    second.focus();
                    return;
                } else {
                    close(value);
                    return;
                }
                first.focus();
            });
            cancel.addEventListener("click", function () { close(null); });
            document.addEventListener("keydown", onKey, true);
            setTimeout(function () { first.focus(); }, 30);
        });
    }

    NP.passwordDialog = { ask: ask };

})(window.NP);

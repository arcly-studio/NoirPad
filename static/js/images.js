/* images.js - NoirPad image handling */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    NP.images = {
        init: function () {
            var editor = document.getElementById("editor");
            if (!editor) return;

            editor.addEventListener("paste", NP.images._onPaste);
            NP.images._setupZoom();
        },

        _onPaste: function (e) {
            var items = e.clipboardData && e.clipboardData.items;
            if (!items) return;

            for (var i = 0; i < items.length; i++) {
                if (items[i].type.indexOf("image/") === 0) {
                    e.preventDefault();
                    var file = items[i].getAsFile();
                    if (file) NP.images.upload(file);
                    return;
                }
            }
        },

        upload: function (file) {
            return NP.api.uploadImage(file).then(function (res) {
                var url = res && (res.url || res.path);
                var filename = res && res.filename;
                if (!url) return;

                var editor = document.getElementById("editor");
                if (!editor) return;

                var img = document.createElement("img");
                img.src = url;
                if (filename) img.setAttribute("data-filename", filename);
                img.style.cssText = "max-width:100%;height:auto;display:block;margin:8px 0;";
                img.setAttribute("draggable", "false");

                /* Insert at cursor or append */
                var sel = window.getSelection();
                if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
                    var range = sel.getRangeAt(0);
                    range.deleteContents();
                    range.insertNode(img);
                    /* Move cursor after image */
                    range.setStartAfter(img);
                    range.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(range);
                } else {
                    editor.appendChild(img);
                }
            }).catch(function (err) {
                console.error("Image upload failed:", err);
            });
        },

        _setupZoom: function () {
            var editor = document.getElementById("editor");
            if (!editor) return;

            editor.addEventListener("wheel", function (e) {
                if (!e.ctrlKey) return;
                var target = e.target;
                if (target.tagName !== "IMG") return;

                e.preventDefault();
                var scale = parseFloat(target.dataset.scale || "1");
                if (e.deltaY < 0) {
                    scale = Math.min(scale * 1.1, 5);
                } else {
                    scale = Math.max(scale * 0.9, 0.2);
                }
                target.dataset.scale = String(scale);
                target.style.transform = "scale(" + scale + ")";
                target.style.transformOrigin = "top left";
            }, { passive: false });
        }
    };

})(window.NP);

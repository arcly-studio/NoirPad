/* api.js - NoirPad API client */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    function request(method, url, body) {
        var opts = {
            method: method,
            headers: {},
            credentials: "same-origin"
        };
        if (body instanceof FormData) {
            opts.body = body;
        } else if (body !== undefined) {
            opts.headers["Content-Type"] = "application/json";
            opts.body = JSON.stringify(body);
        }
        return fetch(url, opts).then(function (res) {
            if (!res.ok) {
                return res.text().then(function (txt) {
                    var msg = txt;
                    try {
                        var obj = JSON.parse(txt);
                        if (obj && obj.detail) msg = obj.detail;
                    } catch (e) { /* not json — keep raw */ }
                    var e = new Error(msg || ("API " + res.status));
                    e.status = res.status;
                    // 401 = server password session missing/expired.
                    e.unauthorized = res.status === 401;
                    throw e;
                });
            }
            var ct = res.headers.get("content-type") || "";
            if (ct.indexOf("application/json") !== -1) {
                return res.json();
            }
            return res.text();
        });
    }

    function triggerDownload(url) {
        var a = document.createElement("a");
        a.href = url;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    NP.api = {
        getData: function () {
            return request("GET", "/api/data");
        },

        getVersion: function () {
            return request("GET", "/api/data/version");
        },

        getNote: function (id) {
            return request("GET", "/api/note/" + encodeURIComponent(id));
        },

        saveNote: function (id, content, formats, opts) {
            var body = { content: content, formats: formats };
            if (opts && opts.mode !== undefined) body.mode = opts.mode;
            return request("PUT", "/api/note/" + encodeURIComponent(id), body);
        },

        newNote: function (parentId, name) {
            return request("POST", "/api/tree/new-note", {
                parent_id: parentId,
                name: name
            });
        },

        newFolder: function (parentId, name) {
            return request("POST", "/api/tree/new-folder", {
                parent_id: parentId,
                name: name
            });
        },

        rename: function (id, name) {
            return request("POST", "/api/tree/rename", {
                id: id,
                name: name
            });
        },

        move: function (id, targetId, position) {
            return request("POST", "/api/tree/move", {
                id: id,
                target_id: targetId,
                position: position
            });
        },

        deleteItem: function (id) {
            return request("POST", "/api/tree/delete", {
                id: id
            });
        },

        toggleFavorite: function (id) {
            return request("POST", "/api/favorites/toggle", {
                id: id
            });
        },

        getTags: function () {
            return request("GET", "/api/tags");
        },

        setTags: function (id, tags) {
            return request("PUT", "/api/tags/" + encodeURIComponent(id), {
                tags: tags
            });
        },

        getTrash: function () {
            return request("GET", "/api/trash");
        },

        restoreFromTrash: function (id) {
            return request("POST", "/api/trash/restore", {
                id: id
            });
        },

        emptyTrash: function () {
            return request("POST", "/api/trash/empty");
        },

        deleteTrashItem: function (id) {
            return request("POST", "/api/trash/delete", { id: id });
        },

        saveSettings: function (settings) {
            return request("PUT", "/api/settings", settings);
        },

        encrypt: function (id, password) {
            return request("POST", "/api/encrypt", {
                id: id,
                password: password
            });
        },

        decrypt: function (id, password) {
            return request("POST", "/api/decrypt", {
                id: id,
                password: password
            });
        },

        decryptView: function (id, password) {
            return request("POST", "/api/decrypt-view", {
                id: id,
                password: password
            });
        },

        saveEncrypted: function (id, password, content, formats) {
            return request("POST", "/api/save-encrypted", {
                id: id,
                password: password,
                content: content,
                formats: formats || []
            });
        },

        uploadImage: function (file) {
            var fd = new FormData();
            fd.append("file", file);
            return request("POST", "/api/images/upload", fd);
        },

        exportTxt: function (id) {
            triggerDownload("/api/export/" + encodeURIComponent(id) + "/txt");
        },

        exportHtml: function (id) {
            triggerDownload("/api/export/" + encodeURIComponent(id) + "/html");
        },

        downloadBackup: function () {
            triggerDownload("/api/backup");
        },

        importBackup: function (file) {
            var fd = new FormData();
            fd.append("file", file);
            return request("POST", "/api/backup/import", fd);
        },

        /* ---- Session (password-protected server mode) ---- */
        session: function () {
            return request("GET", "/api/session");
        },

        login: function (password, remember) {
            return request("POST", "/api/login", {
                password: password,
                remember: !!remember
            });
        },

        logout: function () {
            return request("POST", "/api/logout");
        }
    };

})(window.NP);

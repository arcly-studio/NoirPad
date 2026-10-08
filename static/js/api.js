/* api.js - NoirPad API client */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* Desktop app: desktop.py opens the window at /#token=<random>. Keep
       the token for this window (sessionStorage survives a reload) and
       drop it from the address bar. Web/server mode has no token. */
    var TOKEN_KEY = "noirpad_token";
    var token = null;
    try {
        var m = /[#&]token=([^&]+)/.exec(window.location.hash || "");
        if (m) {
            token = decodeURIComponent(m[1]);
            sessionStorage.setItem(TOKEN_KEY, token);
            history.replaceState(null, "", window.location.pathname + window.location.search);
        } else {
            token = sessionStorage.getItem(TOKEN_KEY);
        }
    } catch (e) { /* storage unavailable — web mode needs no token */ }

    /* Headers every /api/ call carries: the CSRF marker (server mode)
       and the per-launch token (desktop). */
    function apiHeaders(extra) {
        var h = { "X-NoirPad-Request": "1" };
        if (token) h["X-NoirPad-Token"] = token;
        if (extra) {
            Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
        }
        return h;
    }

    /* fetch() with the API headers added. */
    function apiFetch(url, opts) {
        opts = opts || {};
        opts.headers = apiHeaders(opts.headers);
        opts.credentials = "same-origin";
        return fetch(url, opts);
    }

    function errorFrom(res) {
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

    function request(method, url, body) {
        var opts = { method: method, headers: {} };
        if (body instanceof FormData) {
            opts.body = body;
        } else if (body !== undefined) {
            opts.headers["Content-Type"] = "application/json";
            opts.body = JSON.stringify(body);
        }
        return apiFetch(url, opts).then(function (res) {
            if (!res.ok) return errorFrom(res);
            var ct = res.headers.get("content-type") || "";
            if (ct.indexOf("application/json") !== -1) {
                return res.json();
            }
            return res.text();
        });
    }

    /* "attachment; filename=\"x.txt\"; filename*=UTF-8''%C5%99.txt" → name */
    function filenameFrom(disposition) {
        var star = /filename\*=UTF-8''([^;]+)/i.exec(disposition || "");
        if (star) {
            try { return decodeURIComponent(star[1]); } catch (e) { /* fall through */ }
        }
        var plain = /filename="([^"]*)"/i.exec(disposition || "");
        return plain ? plain[1] : "";
    }

    /* Downloads go through fetch (so they carry the API headers) and a
       blob: link with `download` (allowed by links.js). */
    function download(url) {
        return apiFetch(url).then(function (res) {
            if (!res.ok) return errorFrom(res);
            var name = filenameFrom(res.headers.get("content-disposition"));
            return res.blob().then(function (blob) {
                var href = URL.createObjectURL(blob);
                var a = document.createElement("a");
                a.href = href;
                a.download = name || "download";
                a.style.display = "none";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(function () { URL.revokeObjectURL(href); }, 10000);
            });
        }).catch(function (err) {
            alert("Download failed: " + (err && err.message ? err.message : err));
        });
    }

    NP.api = {
        fetch: apiFetch,
        download: download,
        hasToken: function () { return !!token; },

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
            download("/api/export/" + encodeURIComponent(id) + "/txt");
        },

        exportHtml: function (id) {
            download("/api/export/" + encodeURIComponent(id) + "/html");
        },

        downloadBackup: function () {
            download("/api/backup");
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
        },

        /* Desktop: lets <img src="/images/…"> through (cookie). */
        bindSession: function () {
            return request("POST", "/api/session/bind");
        }
    };

})(window.NP);

/* i18n.js - UI language (English, Czech). No build step.

   Texts live in static/locales/<lang>.json (nested objects):
       NP.t("tree.newNote")                 → "New note"
       NP.t("trash.emptied", { n: 3 })      → "{n}" placeholders filled in
       { "one": "…", "few": "…", "many": "…", "other": "…" }
                                            → plural form picked by params.n
   Static HTML:  data-i18n="key"            → element text
                 data-i18n-title / -placeholder / -aria-label / -data-placeholder="key"
                                            → that attribute
   A missing key falls back to English, then to the key itself.

   Language: Settings → Language ("auto" | "en" | "cs"); "auto" follows
   the browser (cs* → Czech, anything else → English). */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var SUPPORTED = ["en", "cs"];
    var ATTRS = ["title", "placeholder", "aria-label", "data-placeholder"];
    var dicts = {};          /* lang → nested dictionary */
    var current = "en";

    function lookup(dict, key) {
        var node = dict;
        var parts = key.split(".");
        for (var i = 0; i < parts.length; i++) {
            if (!node || typeof node !== "object") return undefined;
            node = node[parts[i]];
        }
        return node;
    }

    function pluralForm(value, n, lang) {
        var form = "other";
        try { form = new Intl.PluralRules(lang).select(n); } catch (e) { /* old engine */ }
        return value[form] != null ? value[form] : value.other;
    }

    function fill(text, params) {
        if (!params) return text;
        return text.replace(/\{(\w+)\}/g, function (m, name) {
            return params[name] != null ? String(params[name]) : m;
        });
    }

    function t(key, params) {
        var langs = [current, "en"];
        for (var i = 0; i < langs.length; i++) {
            var value = dicts[langs[i]] ? lookup(dicts[langs[i]], key) : undefined;
            if (value && typeof value === "object" && params && params.n != null) {
                value = pluralForm(value, Number(params.n), langs[i]);
            }
            if (typeof value === "string") return fill(value, params);
        }
        return key;
    }

    /* Translate every data-i18n* element under *root* (default: document). */
    function apply(root) {
        root = root || document;
        var nodes = root.querySelectorAll("[data-i18n]");
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].textContent = t(nodes[i].getAttribute("data-i18n"));
        }
        ATTRS.forEach(function (attr) {
            var withAttr = root.querySelectorAll("[data-i18n-" + attr + "]");
            for (var j = 0; j < withAttr.length; j++) {
                withAttr[j].setAttribute(attr, t(withAttr[j].getAttribute("data-i18n-" + attr)));
            }
        });
    }

    function resolve(setting) {
        if (SUPPORTED.indexOf(setting) !== -1) return setting;
        var nav = (navigator.languages && navigator.languages[0]) || navigator.language || "";
        return /^cs\b/i.test(nav) ? "cs" : "en";
    }

    function fetchDict(lang) {
        if (dicts[lang]) return Promise.resolve();
        return fetch("/static/locales/" + lang + ".json", { credentials: "same-origin" })
            .then(function (res) {
                if (!res.ok) throw new Error("locale " + lang + ": HTTP " + res.status);
                return res.json();
            })
            .then(function (dict) { dicts[lang] = dict; });
    }

    NP.t = t;
    NP.i18n = {
        supported: SUPPORTED,

        lang: function () { return current; },

        /* Load English (fallback) + the chosen language, then translate the
           page. *setting* is the stored "auto" | "en" | "cs". */
        init: function (setting) {
            var lang = resolve(setting);
            return fetchDict("en").then(function () {
                return lang === "en" ? null : fetchDict(lang);
            }).catch(function (err) {
                console.error("Could not load UI language:", err);
                lang = dicts[lang] ? lang : "en";
            }).then(function () {
                current = dicts[lang] ? lang : "en";
                document.documentElement.lang = current;
                apply(document);
            });
        },

        /* Tests / tools: register a dictionary without fetching. */
        use: function (lang, dict) {
            dicts[lang] = dict;
            current = lang;
        },

        apply: apply,
        resolve: resolve
    };

})(window.NP);

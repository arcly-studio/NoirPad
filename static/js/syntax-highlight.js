/* syntax-highlight.js — the one code highlighter (vendored highlight.js).

   Used by both editors:
     - rich-text: NP.editor._renderCodeBlock → NP.highlight.into(<code>)
     - markdown preview: every .md-codeblock after "np-md-rendered"

   Purely visual. The rich-text save path reads the raw code from
   pre[data-code]; the markdown save path reads the textarea. Highlighted
   HTML never reaches the backend. */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* Fence hints highlight.js doesn't know under that name. */
    var ALIAS = {
        "c#": "csharp", "cs": "csharp", "c++": "cpp", "h": "c", "hpp": "cpp",
        "objective-c": "objectivec", "objc": "objectivec",
        "sh": "bash", "shell": "bash", "zsh": "bash",
        "htm": "xml", "html": "xml", "svg": "xml", "vue": "xml"
    };

    function highlight(code, lang) {
        var hljs = window.hljs;
        if (!hljs) return null;
        var name = (lang || "").toLowerCase();
        name = ALIAS[name] || name;
        try {
            if (name && hljs.getLanguage(name)) {
                return hljs.highlight(code, { language: name, ignoreIllegals: true });
            }
            return hljs.highlightAuto(code);
        } catch (e) {
            return null;
        }
    }

    NP.highlight = {
        /* Fill *el* with highlighted *code*. Falls back to plain text
           when highlight.js is unavailable. Returns the language used. */
        into: function (el, code, lang) {
            var res = highlight(code, lang);
            if (!res) {
                el.textContent = code;
                return null;
            }
            el.innerHTML = NP.sanitizeHtml(res.value);
            el.classList.add("hljs");
            return res.language || null;
        }
    };

    document.addEventListener("np-md-rendered", function (e) {
        var root = e.target;
        if (!root || !root.querySelectorAll) return;
        var blocks = root.querySelectorAll(".md-codeblock");
        for (var i = 0; i < blocks.length; i++) {
            var lang = NP.highlight.into(blocks[i], blocks[i].textContent,
                blocks[i].getAttribute("data-lang"));
            if (lang && !blocks[i].getAttribute("data-lang")) {
                blocks[i].setAttribute("data-detected-lang", lang);
            }
        }
    });

})(window.NP);

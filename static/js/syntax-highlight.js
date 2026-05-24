/* syntax-highlight.js — Shiki-based highlighting for the MD preview.

   SAFETY MODEL — read this before changing anything:

   This module ONLY touches `.md-codeblock` elements inside the
   read-only `#md-preview` div. The markdown source of truth is
   `#editor-md` (textarea); the save path reads `ta.value` and never
   walks the preview DOM. As long as we stay inside #md-preview,
   there is no path by which highlighted HTML can reach the backend.
*/
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var TAG = "[Shiki]";

    /* lang + theme + code → cached HTML. */
    var cache = Object.create(null);
    var shikiReady = false;
    var langDetectReady = false;
    var pendingTimer = null;
    var generation = 0;
    var smokeTestDone = false;

    var THEME_MAP = {
        "matrix":     "github-dark",
        "amber":      "monokai",
        "cyan":       "one-dark-pro",
        "red":        "github-dark",
        "purple":     "dracula",
        "blue":       "one-dark-pro",
        "pink":       "dracula",
        "white":      "github-light",
        "gold":       "monokai",
        "lime":       "github-dark",
        "orange":     "monokai",
        "ice":        "one-dark-pro",
        "dracula":    "dracula",
        "synthwave":  "synthwave-84",
        "nord":       "nord",
        "gruvbox":    "gruvbox-dark-medium",
        "tokyo-night": "tokyo-night"
    };

    function currentShikiTheme() {
        var t = document.documentElement.getAttribute("data-theme") ||
                "matrix";
        return THEME_MAP[t] || "github-dark";
    }

    function isMdActive() {
        return document.body.classList.contains("editor-md-active");
    }

    function codeOf(block) {
        return block.textContent || "";
    }

    var LANG_ALIAS = {
        "cs": "csharp", "c#": "csharp", "fs": "fsharp",
        "py": "python", "rb": "ruby",
        "js": "javascript", "ts": "typescript",
        "jsx": "jsx", "tsx": "tsx",
        "kt": "kotlin", "rs": "rust",
        "sh": "bash", "shell": "bash", "zsh": "bash",
        "yml": "yaml", "md": "markdown",
        "tex": "latex", "ps1": "powershell", "ps": "powershell",
        "cpp": "cpp", "c++": "cpp", "h": "c", "hpp": "cpp",
        "htm": "html", "xml": "xml", "svg": "xml",
        "go": "go", "rb": "ruby", "rust": "rust",
        "java": "java", "scala": "scala",
        "json": "json", "json5": "json5", "jsonc": "jsonc",
        "yaml": "yaml", "toml": "toml", "ini": "ini",
        "sql": "sql", "dockerfile": "dockerfile",
        "dart": "dart", "swift": "swift", "lua": "lua",
        "objective-c": "objc", "objc": "objc",
        "vue": "vue", "svelte": "svelte"
    };
    function normalizeLang(lang) {
        if (!lang) return null;
        var k = String(lang).toLowerCase();
        return LANG_ALIAS[k] || k;
    }

    /* Regex heuristic — last-resort fallback when both the fence
       hint and the ML detector come up empty. Tests are ordered
       most-specific first so e.g. C# isn't misread as Java. Each
       rule looks for at least one signature token unique-ish to
       that language. Returns null only if nothing matches; callers
       supply the final default ("javascript"). */
    function guessHeuristic(code) {
        if (!code) return null;

        /* Python — colon-ending suffixes, def/class, dunder. */
        if (/^\s*(def|class)\s+\w+\s*\(|^\s*(import|from)\s+\w+|:\s*$|^\s*print\s*\(|^\s*if\s+__name__/m
            .test(code)) return "python";

        /* C# / Java family — Console.WriteLine and `using …;` are
           strong C# signals; `System.out.println` flips to Java. */
        if (/\bSystem\.out\.println|^\s*package\s+[a-z][\w.]+;/m.test(code)) {
            return "java";
        }
        if (/\b(Console\.(WriteLine|ReadLine|Write)|namespace\s+\w|using\s+System)|^\s*public\s+(static\s+)?(void|class|int|string)\s/m
            .test(code)) return "csharp";

        /* TypeScript signals (typed params/returns, interface, type
           aliases). Falls through to JS if not matched. */
        if (/:\s*(string|number|boolean|any|void)\b|\binterface\s+\w+\s*\{|\btype\s+\w+\s*=/.test(code)) {
            return "typescript";
        }

        /* JS — common globals + arrow funcs + var/let/const. */
        if (/\b(const|let|var|function)\b|=>|console\.(log|error|warn)|\bdocument\.|\bwindow\.|\brequire\s*\(/.test(code)) {
            return "javascript";
        }

        /* HTML — at least one tag. */
        if (/<\/?[a-z][\w-]*(\s[^>]*)?>/i.test(code)) return "html";

        /* CSS — selectors with declarations. */
        if (/[.#@]?[\w-]+\s*\{[^}]*[a-z-]+\s*:[^;}]+;?/i.test(code)) {
            return "css";
        }

        /* SQL keywords. */
        if (/\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|GROUP\s+BY|ORDER\s+BY|CREATE\s+TABLE)\b/i
            .test(code)) return "sql";

        /* JSON: top-level object/array with quoted keys. */
        if (/^\s*[\{\[][\s\S]*[\}\]]\s*$/.test(code) &&
            /"[\w-]+"\s*:/.test(code)) return "json";

        /* Bash / shell. */
        if (/^#!.*\b(bash|sh|zsh)\b|^\s*(echo|sudo|export|cd|ls|grep|chmod|curl|wget)\s/m
            .test(code)) return "bash";

        /* PowerShell — verb-noun cmdlets, $variables. */
        if (/\b(Get-|Set-|New-|Remove-|Invoke-|Write-Host)\w+/.test(code) ||
            /^\s*\$\w+\s*=/m.test(code) && /\|\s*\w+-\w+/.test(code)) {
            return "powershell";
        }

        /* Go. */
        if (/^\s*package\s+\w+\s*$|\bfunc\s+\w+\s*\(/m.test(code) &&
            /:\=|fmt\.Print/.test(code)) return "go";

        /* Rust. */
        if (/\bfn\s+\w+\s*\(|let\s+mut\s+|println!\s*\(|::\<.+>/.test(code)) {
            return "rust";
        }

        return null;
    }

    async function detectLang(code) {
        if (!langDetectReady || !window.detectLanguage) {
            console.log(TAG, "detect: detector not ready");
            return null;
        }
        if (!code || code.trim().length < 8) {
            console.log(TAG, "detect: code too short (" +
                (code ? code.trim().length : 0) + " chars)");
            return null;
        }
        try {
            var raw = await window.detectLanguage(code);
            console.log(TAG, "detect: raw result =", raw);
            return raw;
        } catch (e) {
            console.warn(TAG, "detectLanguage threw:", e);
            return null;
        }
    }

    /* Mark a block as visibly errored so failures are obvious
       instead of looking like a silent "no colors" state. */
    function markError(block, msg) {
        block.dataset.shikiError = msg;
        block.style.outline = "1px dashed #ff5555";
    }

    /* Promote Shiki's inline `style="color:..."` to JS-set inline
       !important so no cascade rule (even `!important`) can mute
       the per-token color. Uses `el.style.color` which the browser
       already parsed from the style attribute — sidesteps regex
       traps like matching the "color" inside "background-color". */
    function forceShikiColors(block) {
        var pre = block.querySelector("pre.shiki");
        if (pre) {
            var preBg = pre.style.backgroundColor;
            var preFg = pre.style.color;
            if (preBg) {
                pre.style.setProperty(
                    "background-color", preBg, "important"
                );
            }
            if (preFg) {
                pre.style.setProperty("color", preFg, "important");
                pre.style.setProperty(
                    "-webkit-text-fill-color", preFg, "important"
                );
            }
            pre.style.setProperty("text-shadow", "none", "important");
            pre.style.setProperty("filter", "none", "important");
        }
        var spans = block.querySelectorAll("span[style]");
        var painted = 0;
        for (var i = 0; i < spans.length; i++) {
            var s = spans[i];
            var c = s.style.color;
            if (c) {
                s.style.setProperty("color", c, "important");
                s.style.setProperty(
                    "-webkit-text-fill-color", c, "important"
                );
                painted++;
            }
            /* Neon glow on text smears multi-color tokens into the
               accent — must die per-span, not just per-pre, because
               text-shadow inherits-by-cascade not by computed
               style. */
            s.style.setProperty("text-shadow", "none", "important");
            s.style.setProperty("filter", "none", "important");
        }
        console.log(TAG, "forceColors: " + painted + "/" +
            spans.length + " span(s) had inline color");
    }

    async function highlightOne(block, myGen) {
        if (block.dataset.shikiDone === "1") return;
        var code = codeOf(block);
        if (!code.trim()) return;

        /* Language pipeline — most-trustworthy source wins:
             1) explicit fence hint   (```python  → data-lang)
             2) ML auto-detect        (vscode-languagedetection)
             3) regex heuristic       (def…, public static, <html>)
             4) default "javascript"  (NOT "text" — text means no
                highlighting at all, which looks identical to a
                broken Shiki call and is the bug we're fixing).
           Each step's contribution is logged so a misclassified
           block is easy to trace. */
        var lang = null;
        var langSource = null;

        var hint = block.dataset.lang;
        if (hint) {
            lang = normalizeLang(hint);
            langSource = "hint";
        }
        if (!lang) {
            var detected = await detectLang(code);
            if (myGen !== generation) return;
            var det = normalizeLang(detected);
            if (det && det !== "text" && det !== "unknown") {
                lang = det;
                langSource = "detect";
            }
        }
        if (!lang) {
            var h = guessHeuristic(code);
            if (h) {
                lang = h;
                langSource = "heuristic";
            }
        }
        if (!lang) {
            lang = "javascript";
            langSource = "default";
        }
        console.log(TAG, "lang chosen: " + lang +
            " (via " + langSource + ")");

        var theme = currentShikiTheme();
        var key = theme + "::" + lang + "::" + code;
        var html = cache[key];
        if (!html) {
            try {
                html = await window.shikiCodeToHtml(code, {
                    lang: lang, theme: theme
                });
            } catch (e) {
                console.warn(TAG, "codeToHtml failed for lang=" +
                    lang + ", retrying as text:", e && e.message);
                try {
                    html = await window.shikiCodeToHtml(code, {
                        lang: "text", theme: theme
                    });
                } catch (e2) {
                    console.error(TAG,
                        "codeToHtml fallback also failed:", e2);
                    markError(block, "shiki call failed: " +
                        (e2 && e2.message ? e2.message : e2));
                    return;
                }
            }
            cache[key] = html;
        }
        if (myGen !== generation) return;
        if (!block.isConnected) return;

        block.innerHTML = html;
        /* Shiki paints <pre tabindex="0"> for keyboard scroll. That
           focusable child inside #md-preview (aria-hidden="true")
           triggers a Chrome a11y warning. Drop the tabindex so the
           subtree stays cleanly hidden from focus + a11y tree. */
        var sp = block.querySelector("pre.shiki");
        if (sp) sp.removeAttribute("tabindex");

        /* NUCLEAR COLOR FIX. Cascade-based CSS overrides should be
           enough on a sane page, but NoirPad pours glow/text-shadow
           and accent-colored cascades through #md-preview. Promote
           every inline color Shiki painted to JS-inline !important
           so it beats any author `!important` rule no matter what
           selector targets the element. setProperty('important')
           creates inline !important, which has the highest possible
           specificity for non-animation declarations. */
        forceShikiColors(block);

        block.dataset.shikiDone = "1";
        block.dataset.shikiLang = lang;
        console.log(TAG, "painted block lang=" + lang +
            " (" + code.length + " chars, html=" + html.length + ")");
    }

    async function highlightAll() {
        /* Verbose [Shiki DIAG] block — survives without DevTools by
           also writing a summary to #md-preview's data-shiki-debug
           attribute (visible via Inspect Element). */
        var diag = {
            shikiReady: shikiReady,
            langDetectReady: langDetectReady,
            shikiCodeToHtml: typeof window.shikiCodeToHtml,
            isMdActive: isMdActive(),
            mdCodeblockTotal: document.querySelectorAll(
                ".md-codeblock").length,
            mdCodeblockInPreview: document.querySelectorAll(
                "#md-preview .md-codeblock").length,
            mdCodeblockInEditor: document.querySelectorAll(
                "#editor .md-codeblock").length,
            preShikiTotal: document.querySelectorAll(
                "pre.shiki").length,
            preShikiInPreview: document.querySelectorAll(
                "#md-preview pre.shiki").length,
            mdPreviewExists: !!document.getElementById("md-preview"),
            editorExists: !!document.getElementById("editor")
        };
        console.log(TAG, "DIAG === START === ", diag);

        if (!shikiReady || !window.shikiCodeToHtml) {
            console.log(TAG, "highlightAll: not ready " +
                "(shikiReady=" + shikiReady +
                ", codeToHtml=" + typeof window.shikiCodeToHtml + ")");
            return;
        }
        if (!isMdActive()) {
            return;
        }
        var preview = document.getElementById("md-preview");
        if (!preview) {
            console.warn(TAG, "highlightAll: no #md-preview");
            return;
        }

        generation++;
        var myGen = generation;
        var blocks = preview.querySelectorAll(
            ".md-codeblock:not([data-shiki-done='1'])"
        );
        console.log(TAG, "highlightAll: " + blocks.length +
            " block(s) pending (gen=" + myGen + ")");

        /* Visible diag — Inspect #md-preview to read this without
           opening Console. */
        preview.dataset.shikiDebug = "ts=" + Date.now() +
            " ready=" + shikiReady +
            " pending=" + blocks.length +
            " painted=" + preview.querySelectorAll(
                ".md-codeblock[data-shiki-done='1']").length +
            " preShiki=" + preview.querySelectorAll(
                "pre.shiki").length;

        for (var i = 0; i < blocks.length; i++) {
            if (myGen !== generation) return;
            await highlightOne(blocks[i], myGen);
        }

        /* Refresh visible diag after the pass. */
        preview.dataset.shikiDebug = "ts=" + Date.now() +
            " ready=" + shikiReady +
            " pending=0" +
            " painted=" + preview.querySelectorAll(
                ".md-codeblock[data-shiki-done='1']").length +
            " preShiki=" + preview.querySelectorAll(
                "pre.shiki").length;
    }

    function schedule() {
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(function () {
            pendingTimer = null;
            highlightAll();
        }, 250);
    }

    /* Self-test on first ready: confirms the bundle resolves themes
       + langs end-to-end. Result goes to console so the user can
       grep for it during diagnosis. */
    async function smokeTest() {
        if (smokeTestDone) return;
        smokeTestDone = true;
        try {
            var html = await window.shikiCodeToHtml(
                "const x = 1;",
                { lang: "javascript", theme: "github-dark" }
            );
            console.log(TAG, "smoke test OK (" + html.length +
                " chars). Theme/lang loading works.");
        } catch (e) {
            console.error(TAG, "SMOKE TEST FAILED — Shiki loaded " +
                "but codeToHtml threw. Check theme/lang bundling:", e);
        }
    }

    /* DOM-level inspector — call from DevTools console to find out
       why a highlighted block looks monochromatic. Picks the first
       Shiki span with a non-empty inline color, then reports:
         inlineColor   — what Shiki set
         computedColor — what the browser actually paints
         winning       — match means inline won, mismatch means
                         some !important author rule beat it
         override      — first author rule that targeted color on
                         this span (when winning=false) */
    window.__npShikiInspect = function () {
        var span = document.querySelector(
            "#md-preview pre.shiki span[style*='color']"
        );
        if (!span) {
            console.log(TAG,
                "inspect: no Shiki span found — either Shiki hasn't " +
                "run yet, or no inline-colored tokens in the preview.");
            return null;
        }
        var inline = span.style.color || "";
        var computed = getComputedStyle(span).color;
        var fillColor = getComputedStyle(span)
            .getPropertyValue("-webkit-text-fill-color");
        var textShadow = getComputedStyle(span).textShadow;
        var report = {
            inlineColor:   inline,
            computedColor: computed,
            winning:       cssColorsEqual(inline, computed),
            webkitTextFillColor: fillColor,
            textShadow:    textShadow,
            spanHTML:      span.outerHTML.slice(0, 200)
        };
        console.log(TAG, "inspect:", report);
        if (!report.winning) {
            console.warn(TAG,
                "inspect: inline color is being OVERRIDDEN. Open " +
                "DevTools → Elements, click this span, check the " +
                "Styles panel for a struck-through `color: ...` " +
                "line — that's the override.");
        } else if (textShadow && textShadow !== "none") {
            console.warn(TAG,
                "inspect: inline color WINS but textShadow is " +
                "active (\"" + textShadow + "\") — this is the " +
                "neon-glow washout. CSS override should already " +
                "kill it; if you still see it, the cached noirpad" +
                ".css is stale. Hard refresh.");
        } else {
            console.log(TAG, "inspect: colors look correct.");
        }
        return report;
    };

    /* Cheap color-string equality. Browsers normalize inline
       `color: #abc123` to `rgb(171, 193, 35)` in getComputedStyle,
       so a direct === fails. Parse both into rgb triplets. */
    function parseColor(s) {
        if (!s) return null;
        var d = document.createElement("div");
        d.style.color = s;
        document.body.appendChild(d);
        var c = getComputedStyle(d).color;
        d.remove();
        return c;
    }
    function cssColorsEqual(a, b) {
        var ca = parseColor(a);
        var cb = parseColor(b);
        return !!ca && !!cb && ca === cb;
    }

    /* All-in-one diagnostic. Returns a full report as one object so
       it can be screenshot/pasted from console without scrolling
       through individual logs. Run after typing a code block. */
    window.__npShikiDiag = function () {
        var preview = document.getElementById("md-preview");
        var firstBlock = preview && preview.querySelector(".md-codeblock");
        var firstPre = preview && preview.querySelector("pre.shiki");
        var firstColoredSpan = preview && preview.querySelector(
            "pre.shiki span[style*='color']");
        var report = {
            globals: {
                shikiCodeToHtml: typeof window.shikiCodeToHtml,
                detectLanguage:  typeof window.detectLanguage,
                shikiReady: shikiReady,
                langDetectReady: langDetectReady
            },
            dom: {
                mdActive: isMdActive(),
                editorExists: !!document.getElementById("editor"),
                editorMdExists: !!document.getElementById("editor-md"),
                previewExists: !!preview,
                previewDisplay: preview ?
                    getComputedStyle(preview).display : null,
                previewWidth: preview ? preview.clientWidth : null,
                previewVisibility: preview ?
                    getComputedStyle(preview).visibility : null
            },
            counts: {
                mdCodeblock_anywhere: document.querySelectorAll(
                    ".md-codeblock").length,
                mdCodeblock_inPreview: document.querySelectorAll(
                    "#md-preview .md-codeblock").length,
                mdCodeblock_inEditor: document.querySelectorAll(
                    "#editor .md-codeblock").length,
                preShiki_anywhere: document.querySelectorAll(
                    "pre.shiki").length,
                preShiki_inPreview: document.querySelectorAll(
                    "#md-preview pre.shiki").length,
                doneMarker_inPreview: document.querySelectorAll(
                    "#md-preview .md-codeblock[data-shiki-done='1']"
                ).length
            },
            firstBlock: firstBlock ? {
                hasShikiDone: firstBlock.dataset.shikiDone === "1",
                shikiLang: firstBlock.dataset.shikiLang,
                shikiError: firstBlock.dataset.shikiError,
                outerHTML: firstBlock.outerHTML.slice(0, 300)
            } : null,
            firstPre: firstPre ? {
                inlineBg: firstPre.style.backgroundColor,
                inlineColor: firstPre.style.color,
                computedColor: getComputedStyle(firstPre).color,
                computedBg: getComputedStyle(firstPre).backgroundColor,
                computedTextShadow:
                    getComputedStyle(firstPre).textShadow
            } : null,
            firstColoredSpan: firstColoredSpan ? {
                inlineColor: firstColoredSpan.style.color,
                computedColor:
                    getComputedStyle(firstColoredSpan).color,
                computedTextShadow:
                    getComputedStyle(firstColoredSpan).textShadow,
                webkitTextFillColor: getComputedStyle(firstColoredSpan)
                    .getPropertyValue("-webkit-text-fill-color"),
                outerHTML:
                    firstColoredSpan.outerHTML.slice(0, 200)
            } : null
        };
        console.log(TAG, "__npShikiDiag report:", report);
        /* Also stringify to clipboard if available — easy paste. */
        try {
            var s = JSON.stringify(report, null, 2);
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(s);
                console.log(TAG, "report copied to clipboard.");
            }
        } catch (e) { /* no clipboard — that's fine */ }
        return report;
    };

    /* Manual test helper — call from DevTools console. */
    window.__npShikiTest = async function (code, lang, theme) {
        if (!window.shikiCodeToHtml) {
            console.log(TAG, "test: shikiCodeToHtml NOT available");
            return null;
        }
        var c = code || "const x = 1;";
        var l = lang || "javascript";
        var t = theme || "github-dark";
        try {
            var html = await window.shikiCodeToHtml(c,
                { lang: l, theme: t });
            console.log(TAG, "test OK:", html);
            return html;
        } catch (e) {
            console.error(TAG, "test FAILED:", e);
            return null;
        }
    };

    NP.syntaxHighlight = {
        schedule: schedule,
        highlightAll: highlightAll,
        _state: function () {
            return {
                shikiReady: shikiReady,
                langDetectReady: langDetectReady,
                shikiCodeToHtml: typeof window.shikiCodeToHtml,
                detectLanguage: typeof window.detectLanguage,
                isMdActive: isMdActive(),
                cacheSize: Object.keys(cache).length,
                generation: generation
            };
        }
    };

    /* ---- Wiring ---- */

    window.addEventListener("shiki-ready", function () {
        shikiReady = true;
        console.log(TAG, "ready event received. codeToHtml=" +
            typeof window.shikiCodeToHtml);
        if (window.shikiCodeToHtml) {
            smokeTest().then(schedule);
        } else {
            console.error(TAG,
                "shiki-ready fired but window.shikiCodeToHtml is " +
                "undefined — import almost certainly failed. " +
                "Check the [Shiki] loader error above.");
        }
    });
    window.addEventListener("langdetect-ready", function () {
        langDetectReady = true;
        console.log(TAG, "langdetect ready. detectLanguage=" +
            typeof window.detectLanguage);
    });

    document.addEventListener("np-md-rendered", schedule);

    document.addEventListener("np-theme-changed", function () {
        console.log(TAG, "theme changed → invalidating cache");
        cache = Object.create(null);
        var preview = document.getElementById("md-preview");
        if (preview) {
            var done = preview.querySelectorAll("[data-shiki-done='1']");
            for (var i = 0; i < done.length; i++) {
                delete done[i].dataset.shikiDone;
                done[i].style.outline = "";
            }
        }
        schedule();
    });

    console.log(TAG, "syntax-highlight.js loaded. State:",
        NP.syntaxHighlight._state());

})(window.NP);

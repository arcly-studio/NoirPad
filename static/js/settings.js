/* settings.js - Settings panel + reusable .np-dropdown component */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* =====================================================================
     * Reusable dropdown component
     * ---------------------------------------------------------------------
     * Generic: NO theme/font logic lives here. It only handles
     * open/close/select and dispatches a `np-dropdown-change` CustomEvent
     * ({ value, dropdown }) on the .np-dropdown root. Feature-specific
     * behaviour (theme switch, font switch, …) lives below and just listens
     * for that event. Works for any .np-dropdown anywhere in the DOM.
     * ===================================================================== */

    var _globalDropdownHandlersBound = false;

    function closeAllDropdowns(except) {
        var open = document.querySelectorAll(".np-dropdown.open");
        for (var i = 0; i < open.length; i++) {
            if (open[i] !== except) open[i].classList.remove("open");
        }
    }

    /* Reflect dropdown[data-value] into the trigger label + selected option.
       Does NOT fire any event. */
    function syncDropdown(dropdown) {
        var value = dropdown.getAttribute("data-value");
        var labelEl = dropdown.querySelector(".np-dropdown-label");
        var options = dropdown.querySelectorAll(".np-dropdown-option");
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            var isSelected = opt.getAttribute("data-value") === value;
            if (isSelected) {
                opt.classList.add("np-dropdown-option-selected");
                if (labelEl) {
                    var optLabel = opt.querySelector(".np-dropdown-option-label");
                    labelEl.textContent = optLabel ? optLabel.textContent : value;
                }
            } else {
                opt.classList.remove("np-dropdown-option-selected");
            }
        }
    }

    function selectOption(dropdown, value, fireEvent) {
        dropdown.setAttribute("data-value", value);
        syncDropdown(dropdown);
        if (fireEvent) {
            dropdown.dispatchEvent(new CustomEvent("np-dropdown-change", {
                bubbles: true,
                detail: { value: value, dropdown: dropdown }
            }));
        }
    }

    function initDropdowns() {
        var dropdowns = document.querySelectorAll(".np-dropdown");
        for (var d = 0; d < dropdowns.length; d++) {
            (function (dropdown) {
                /* Always (re)sync visual state from data-value */
                syncDropdown(dropdown);

                if (dropdown._npInited) return;
                dropdown._npInited = true;

                var trigger = dropdown.querySelector(".np-dropdown-trigger");
                if (trigger) {
                    trigger.addEventListener("click", function (e) {
                        e.stopPropagation();
                        var willOpen = !dropdown.classList.contains("open");
                        closeAllDropdowns(dropdown);   /* only one open at a time */
                        dropdown.classList.toggle("open", willOpen);
                    });
                }

                var options = dropdown.querySelectorAll(".np-dropdown-option");
                for (var i = 0; i < options.length; i++) {
                    options[i].addEventListener("click", function (e) {
                        e.stopPropagation();
                        dropdown.classList.remove("open");
                        selectOption(dropdown, this.getAttribute("data-value"), true);
                    });
                }
            })(dropdowns[d]);
        }

        if (!_globalDropdownHandlersBound) {
            _globalDropdownHandlersBound = true;
            /* Click anywhere outside a dropdown closes all open ones */
            document.addEventListener("click", function (e) {
                if (!e.target || !e.target.closest || !e.target.closest(".np-dropdown")) {
                    closeAllDropdowns(null);
                }
            });
            /* Escape closes all open dropdowns (generic component behaviour) */
            document.addEventListener("keydown", function (e) {
                if (e.key === "Escape") closeAllDropdowns(null);
            });
        }
    }

    NP.dropdown = {
        initAll: initDropdowns,
        setValue: function (dropdown, value, fireEvent) {
            if (typeof dropdown === "string") {
                dropdown = document.getElementById(dropdown);
            }
            if (dropdown) selectOption(dropdown, value, !!fireEvent);
        }
    };

    /* =====================================================================
     * Settings panel (feature layer)
     * ===================================================================== */

    function currentTheme() {
        if (NP.state && NP.state.data && NP.state.data.theme) {
            return NP.state.data.theme;
        }
        return document.documentElement.getAttribute("data-theme") || "matrix";
    }

    function currentUiFont() {
        if (NP.state && NP.state.data && NP.state.data.ui_font) {
            return NP.state.data.ui_font;
        }
        return "orbitron";
    }

    function fontFamilyFor(value) {
        var opt = document.querySelector(
            '#setting-ui-font .np-dropdown-option[data-value="' + value + '"]'
        );
        return opt ? opt.getAttribute("data-font-family") : null;
    }

    function applyUiFont(value) {
        var fam = fontFamilyFor(value);
        if (fam) {
            document.documentElement.style.setProperty("--font-display", fam);
        }
    }

    /* =====================================================================
     * Settings v2 — helpers + wiring
     * ===================================================================== */

    /* Read a setting from NP.state.data, falling back to dflt when the key
       is missing/null (existing data files predate the v2 keys). */
    function sget(key, dflt) {
        var d = NP.state && NP.state.data;
        if (d && d[key] !== undefined && d[key] !== null) return d[key];
        return dflt;
    }

    /* Mirror a patch into local state and persist it to the backend. */
    function saveSetting(patch) {
        if (NP.state && NP.state.data) {
            for (var k in patch) {
                if (patch.hasOwnProperty(k)) NP.state.data[k] = patch[k];
            }
        }
        if (NP.api && NP.api.saveSettings) {
            NP.api.saveSettings(patch);
        } else {
            NP.api.fetch("/api/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch)
            });
        }
    }

    function setToggle(id, isOn) {
        var el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle("on", isOn);
        el.setAttribute("aria-checked", isOn ? "true" : "false");
    }

    function bindToggle(id, getter, onChange) {
        var el = document.getElementById(id);
        if (!el) return;
        setToggle(id, getter());
        el.addEventListener("click", function () {
            var next = !el.classList.contains("on");
            setToggle(id, next);
            onChange(next);
        });
    }

    /* Bottom-bar autosave indicator — mirror app.js's styling so the two
       controls stay visually in sync. */
    function syncAutosaveIndicator(on) {
        var ind = document.getElementById("autosave-indicator");
        if (!ind) return;
        ind.style.color = on ? "var(--accent)" : "var(--fg-dim)";
        ind.style.opacity = on ? "1" : "0.4";
    }

    function applyShortcutHints(show) {
        var bar = document.getElementById("bottom-bar");
        if (bar) bar.classList.toggle("hide-shortcuts", !show);
    }

    /* No existing layout module applies orientation; keep it to a safe,
       non-breaking data attribute so the value round-trips + persists. */
    function applyOrientation(value) {
        /* Landscape is the CSS default for #editor; portrait is the
           body-class override. Toggle both so state is always explicit. */
        var portrait = value === "portrait";
        document.body.classList.toggle("orientation-portrait", portrait);
        document.body.classList.toggle("orientation-landscape", !portrait);
    }

    /* Number with a fixed count of decimals in the UI language's format
       ("1.5" in English, "1,5" in Czech). */
    function formatDecimal(value, digits) {
        try {
            return value.toLocaleString(NP.i18n ? NP.i18n.lang() : "en", {
                minimumFractionDigits: digits,
                maximumFractionDigits: digits
            });
        } catch (e) {
            return value.toFixed(digits);
        }
    }

    function formatBytes(bytes) {
        if (!bytes || bytes < 0) return NP.t("settings.size.bytes", { n: 0 });
        if (bytes < 1024) return NP.t("settings.size.bytes", { n: bytes });
        if (bytes < 1024 * 1024) {
            return NP.t("settings.size.kb", { n: formatDecimal(bytes / 1024, 1) });
        }
        if (bytes < 1024 * 1024 * 1024) {
            return NP.t("settings.size.mb", { n: formatDecimal(bytes / (1024 * 1024), 2) });
        }
        return NP.t("settings.size.gb", { n: formatDecimal(bytes / (1024 * 1024 * 1024), 2) });
    }

    /* About → Storage used. Refreshed each time Settings opens (no
       polling). Read-only /api/storage endpoint. */
    function refreshStorageUsed() {
        var el = document.getElementById("setting-storage-used");
        if (!el) return;
        el.textContent = NP.t("common.loading");
        NP.api.fetch("/api/storage")
            .then(function (r) { return r.json(); })
            .then(function (data) {
                el.textContent = formatBytes(data.total_size) + " / ∞";
            })
            .catch(function () {
                el.textContent = NP.t("settings.storageError");
            });
    }

    /* Single source of truth for glow strength. Sets concrete px values
       (JS does the math; CSS just substitutes var(--glow-blur*)) plus the
       multiplier (kept for compat) and updates the live % readout. */
    function applyGlow(pct) {
        pct = parseInt(pct, 10);
        if (isNaN(pct)) pct = 100;
        var m = pct / 100;
        var root = document.documentElement;
        root.style.setProperty("--glow-multiplier", String(m));
        root.style.setProperty("--glow-core", (4 * m) + "px");
        root.style.setProperty("--glow-blur-sm", (12 * m) + "px");
        root.style.setProperty("--glow-blur", (22 * m) + "px");
        root.style.setProperty("--glow-blur-lg", (40 * m) + "px");
        var vEl = document.getElementById("setting-glow-intensity-val");
        if (vEl) vEl.textContent = pct + "%";
    }

    /* Shortcuts list + recording UI moved to shortcuts-manager.js
       (standalone #shortcuts-overlay). The core registry/dispatch/
       validation stays in shortcuts.js. */

    function syncRadioGroup(name, value) {
        var btns = document.querySelectorAll(
            '[id^="setting-' + name + '-"]'
        );
        for (var i = 0; i < btns.length; i++) {
            var on = btns[i].getAttribute("data-value") === value;
            btns[i].classList.toggle("on", on);
            btns[i].setAttribute("aria-checked", on ? "true" : "false");
        }
    }

    var _v2Wired = false;

    function wireV2() {
        if (_v2Wired) return;
        _v2Wired = true;

        /* ---- Appearance ---- */

        var openFp = document.getElementById("setting-open-font-picker");
        if (openFp) {
            openFp.addEventListener("click", function () {
                NP.settings.close();
                if (NP.fontPicker && NP.fontPicker.show) NP.fontPicker.show();
            });
        }

        /* setting-glow-intensity: drives --glow-multiplier (every glow
           blur in noirpad.css is calc(Npx * var(--glow-multiplier,1))).
           input = real-time live preview; persistence is debounced. */
        var glowSlider = document.getElementById("setting-glow-intensity");
        if (glowSlider) {
            glowSlider.addEventListener("input", function () {
                var pct = parseInt(this.value, 10);
                if (isNaN(pct)) pct = 100;
                applyGlow(pct);
                if (NP.state && NP.state.data) {
                    NP.state.data.glow_intensity = pct;
                }
                if (NP.settings._glowSaveTimer) {
                    clearTimeout(NP.settings._glowSaveTimer);
                }
                NP.settings._glowSaveTimer = setTimeout(function () {
                    if (NP.api && NP.api.saveSettings) {
                        NP.api.saveSettings({ glow_intensity: pct });
                    }
                }, 500);
            });
        }

        /* CRT lives in localStorage (effects.js), not the backend. */
        bindToggle(
            "setting-crt",
            function () {
                return !!(NP.effects && NP.effects.crtIsOn &&
                    NP.effects.crtIsOn());
            },
            function (v) {
                if (NP.effects && NP.effects.crtApply) NP.effects.crtApply(v);
            }
        );

        bindToggle(
            "setting-matrix-rain",
            function () { return sget("matrix_rain_enabled", true) !== false; },
            function (v) {
                saveSetting({ matrix_rain_enabled: v });
                if (NP.matrixRain && NP.matrixRain.setEnabled) {
                    NP.matrixRain.setEnabled(v);
                }
            }
        );

        bindToggle(
            "setting-show-splash",
            function () { return sget("show_splash", true) !== false; },
            function (v) { saveSetting({ show_splash: v }); }
        );

        /* ---- Editor ---- */

        bindToggle(
            "setting-autosave",
            function () { return !!sget("autosave", false); },
            function (v) {
                saveSetting({ autosave: v });
                syncAutosaveIndicator(v);
                if (NP.editor && NP.editor._currentNoteId) NP.editor.startAutosave();
            }
        );

        var aiDd = document.getElementById("setting-autosave-interval");
        if (aiDd) {
            aiDd.addEventListener("np-dropdown-change", function (e) {
                var n = parseInt(e.detail.value, 10);
                saveSetting({ autosave_interval: isNaN(n) ? 5 : n });
                if (NP.editor && NP.editor.startAutosave && NP.editor._autosaveTimer) {
                    NP.editor.startAutosave();   /* restart with the new interval */
                }
            });
        }

        var orient = document.querySelector("#setting-page-orientation-landscape");
        var orientP = document.querySelector("#setting-page-orientation-portrait");
        [orient, orientP].forEach(function (btn) {
            if (!btn) return;
            btn.addEventListener("click", function () {
                var value = btn.getAttribute("data-value");
                syncRadioGroup("page-orientation", value);
                saveSetting({ page_orientation: value });
                applyOrientation(value);
            });
        });

        bindToggle(
            "setting-spellcheck",
            function () { return sget("spellcheck", true) !== false; },
            function (v) {
                saveSetting({ spellcheck: v });
                var ed = document.getElementById("editor");
                if (ed) ed.spellcheck = v;
            }
        );

        /* glitch_effect is read by effects.js (onEditorInput early-returns
           when false) — integrated with effects.js. */
        bindToggle(
            "setting-glitch-effect",
            function () { return sget("glitch_effect", true) !== false; },
            function (v) { saveSetting({ glitch_effect: v }); }
        );

        /* ---- Behavior ---- */

        /* confirm_delete is read by tree.js + app.js delete handlers. */
        bindToggle(
            "setting-confirm-delete",
            function () { return sget("confirm_delete", true) !== false; },
            function (v) { saveSetting({ confirm_delete: v }); }
        );

        /* Language: stored with the settings; reload so every module
           (and the lock screen next time) renders in it. */
        var langDd = document.getElementById("setting-language");
        if (langDd) {
            langDd.addEventListener("np-dropdown-change", function (e) {
                var value = e.detail.value;   /* "auto" | "en" | "cs" */
                if (NP.state && NP.state.data) NP.state.data.language = value;
                NP.api.saveSettings({ language: value }).then(function () {
                    window.location.reload();
                });
            });
        }

        var idleDd = document.getElementById("setting-idle-lock");
        if (idleDd) {
            idleDd.addEventListener("np-dropdown-change", function (e) {
                var value = e.detail.value;   /* "off" | "5" | "30" | "60" */
                /* saveSetting mirrors to NP.state.data + persists. */
                saveSetting({ idle_lock_minutes: value });
                /* Apply live: off => 0, otherwise the numeric minutes. */
                if (NP.autoLock && NP.autoLock.setMinutes) {
                    var n = parseInt(value, 10);
                    NP.autoLock.setMinutes(isNaN(n) ? 0 : n);
                }
            });
        }

        /* When ON, the +Note flow prompts for an encryption password
           immediately after loading the new note (see app.js #btn-new-note
           handler). Cancelling the prompt leaves the note plain. */
        bindToggle(
            "setting-default-encrypted",
            function () { return !!sget("default_encrypted", false); },
            function (v) { saveSetting({ default_encrypted: v }); }
        );

        bindToggle(
            "setting-shortcut-hints",
            function () { return sget("show_shortcut_hints", true) !== false; },
            function (v) {
                saveSetting({ show_shortcut_hints: v });
                applyShortcutHints(v);
            }
        );

        /* ---- Data ---- */

        var dlBackup = document.getElementById("setting-download-backup");
        if (dlBackup) {
            dlBackup.addEventListener("click", function () {
                if (NP.backup && NP.backup.download) NP.backup.download();
                else if (NP.api && NP.api.downloadBackup) NP.api.downloadBackup();
            });
        }

        var impBackup = document.getElementById("setting-import-backup");
        if (impBackup) {
            impBackup.addEventListener("click", function () {
                if (NP.backup && NP.backup.import) NP.backup.import();
            });
        }

        var exportAll = document.getElementById("setting-export-all");
        if (exportAll) {
            exportAll.addEventListener("click", function () {
                /* Fetch as blob so we can show a loading state during the
                   server-side zip build (vs. window.location.href which
                   gives no feedback). */
                var originalText = exportAll.textContent;
                exportAll.textContent = NP.t("settings.exporting");
                exportAll.disabled = true;

                NP.api.download("/api/notes/export")
                    .finally(function () {
                        exportAll.textContent = originalText;
                        exportAll.disabled = false;
                    });
            });
        }

        var exportMd = document.getElementById("setting-export-md");
        if (exportMd) {
            exportMd.addEventListener("click", function () {
                exportMd.disabled = true;
                NP.api.download("/api/notes/export-md").then(function (headers) {
                    var skipped = headers ? parseInt(headers.get("x-noirpad-skipped"), 10) : 0;
                    if (skipped > 0) {
                        alert(NP.t("settings.exportMdSkipped", { n: skipped }));
                    }
                }).finally(function () { exportMd.disabled = false; });
            });
        }

        var importMd = document.getElementById("setting-import-md");
        if (importMd) {
            importMd.addEventListener("click", function () {
                var input = document.createElement("input");
                input.type = "file";
                input.multiple = true;
                input.accept = ".md,.markdown,.txt,.zip";
                input.addEventListener("change", function () {
                    if (!input.files || !input.files.length) return;
                    NP.api.importMarkdown(input.files).then(function (res) {
                        return NP.state.init().then(function () {
                            if (NP.tree && NP.tree.render) NP.tree.render();
                            var msg = res.images
                                ? NP.t("settings.importDoneWithImages", {
                                    notes: NP.t("settings.importNotes", { n: res.notes }),
                                    images: NP.t("settings.importImages", { n: res.images })
                                })
                                : NP.t("settings.importDone", {
                                    notes: NP.t("settings.importNotes", { n: res.notes })
                                });
                            if (res.skipped) msg += "\n" + NP.t("settings.importSkipped", { n: res.skipped });
                            alert(msg);
                        });
                    }).catch(function (err) {
                        alert(NP.t("settings.importFailed", { error: err && err.message ? err.message : err }));
                    });
                });
                input.click();
            });
        }

        var emptyTrash = document.getElementById("setting-empty-trash");
        if (emptyTrash) {
            emptyTrash.addEventListener("click", function () {
                /* NP.trash.empty() handles its own confirm + refresh. */
                if (NP.trash && NP.trash.empty) NP.trash.empty();
            });
        }

        var resetAll = document.getElementById("setting-reset-all");
        if (resetAll) {
            resetAll.addEventListener("click", function () {
                var ok = window.confirm(
                    NP.t("settings.resetConfirm") + "\n\n" + NP.t("settings.resetConfirmDetail")
                );
                if (!ok) return;

                NP.api.fetch("/api/settings/reset", { method: "POST" })
                    .then(function (r) {
                        if (!r.ok) {
                            throw new Error(NP.t("settings.serverError", { status: r.status }));
                        }
                        return r.json();
                    })
                    .then(function () {
                        /* Reload — simpler and more reliable than
                           re-applying every setting in JS (theme, font,
                           glow multiplier, CRT/matrix rain, autosave
                           timer, shortcut bindings, ...). */
                        window.location.reload();
                    })
                    .catch(function (err) {
                        alert(NP.t("settings.resetFailed", {
                            error: err && err.message ? err.message : err
                        }));
                    });
            });
        }

        /* ---- Session (only for a password-protected server) ---- */
        var sessionSection = document.getElementById("settings-session-section");
        if (sessionSection && NP.auth && NP.auth.passwordRequired) {
            sessionSection.hidden = !NP.auth.passwordRequired();
        }
        var logoutBtn = document.getElementById("settings-logout-btn");
        if (logoutBtn) {
            logoutBtn.addEventListener("click", function () {
                var ok = window.confirm(NP.t("settings.logoutConfirm"));
                if (!ok) return;
                if (NP.auth && NP.auth.logout) {
                    NP.auth.logout();
                }
            });
        }
    }

    NP.settings = {
        _inited: false,

        init: function () {
            var overlay = document.getElementById("settings-overlay");
            if (!overlay) return;

            initDropdowns();

            if (!NP.settings._inited) {
                NP.settings._inited = true;

                var closeBtn = document.getElementById("settings-close");
                if (closeBtn) {
                    closeBtn.addEventListener("click", function () {
                        NP.settings.close();
                    });
                }

                /* Backdrop click closes the panel */
                overlay.addEventListener("mousedown", function (e) {
                    if (e.target === overlay) NP.settings.close();
                });

                /* Escape: capture phase so we decide before the generic
                   dropdown / app.js handlers. First Escape closes an open
                   dropdown, a second closes the panel. */
                document.addEventListener("keydown", function (e) {
                    if (e.key !== "Escape") return;
                    /* Recording a shortcut? Let Escape reach the recorder
                       (cancel) instead of closing Settings. */
                    if (NP.shortcuts && NP.shortcuts._recordingActive) return;
                    /* Shortcuts manager open on top of Settings? Let its
                       own Escape handler close it, don't close Settings. */
                    var sov = document.getElementById("shortcuts-overlay");
                    if (sov && sov.classList.contains("visible")) return;
                    if (!overlay.classList.contains("visible")) return;
                    if (overlay.querySelector(".np-dropdown.open")) {
                        closeAllDropdowns(null);
                    } else {
                        NP.settings.close();
                    }
                    e.stopPropagation();
                }, true);

                /* Theme dropdown → apply + persist (reuse NP.themes so
                   state + server stay consistent with the rest of the app) */
                var themeDd = document.getElementById("setting-theme");
                if (themeDd) {
                    themeDd.addEventListener("np-dropdown-change", function (e) {
                        if (NP.themes && NP.themes.apply) {
                            NP.themes.apply(e.detail.value);
                        } else {
                            document.documentElement.dataset.theme = e.detail.value;
                            if (NP.api && NP.api.saveSettings) {
                                NP.api.saveSettings({ theme: e.detail.value });
                            }
                        }
                    });
                }

                /* UI font dropdown → set --font-display + persist */
                var fontDd = document.getElementById("setting-ui-font");
                if (fontDd) {
                    fontDd.addEventListener("np-dropdown-change", function (e) {
                        var selectedOption = e.target.querySelector(
                            '.np-dropdown-option[data-value="' + e.detail.value + '"]'
                        );
                        var fontFamily = selectedOption
                            ? selectedOption.dataset.fontFamily
                            : null;

                        if (fontFamily) {
                            document.documentElement.style.setProperty(
                                "--font-display", fontFamily
                            );
                        }
                        if (NP.state && NP.state.data) {
                            NP.state.data.ui_font = e.detail.value;
                        }
                        if (NP.api && NP.api.saveSettings) {
                            NP.api.saveSettings({ ui_font: e.detail.value });
                        } else {
                            NP.api.fetch("/api/settings", {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ ui_font: e.detail.value })
                            });
                        }
                    });
                }

                wireV2();
            }

            /* Apply persisted ui_font on startup + sync both dropdowns */
            NP.settings.syncFromState();
            applyUiFont(currentUiFont());
        },

        /* Apply persisted runtime state to the live app. Called from app.js
           once NP.state.data is loaded. */
        applyRuntimeState: function () {
            if (NP.matrixRain && NP.matrixRain.setEnabled) {
                NP.matrixRain.setEnabled(
                    sget("matrix_rain_enabled", true) !== false
                );
            }
            applyShortcutHints(sget("show_shortcut_hints", true) !== false);
            var ed = document.getElementById("editor");
            if (ed) ed.spellcheck = sget("spellcheck", true) !== false;
            /* Startup ALWAYS forces Landscape (user choice) — overrides any
               persisted Portrait. setOrientation keeps the body class, the
               Settings radio and the stored value in sync. Ctrl+L / Settings
               still switch during the session; a reload resets to Landscape. */
            NP.settings.setOrientation("landscape");
            /* Apply persisted glow strength at startup (not the 100%
               default) so the saved slider value takes effect on load. */
            applyGlow(sget("glow_intensity", 100));
        },

        /* Public orientation API — shared by the Settings radio, the
           Ctrl+L shortcut and the :orientation command so the body class,
           the persisted setting and the radio UI stay in sync. */
        setOrientation: function (value) {
            if (value !== "portrait" && value !== "landscape") return;
            applyOrientation(value);
            syncRadioGroup("page-orientation", value);
            saveSetting({ page_orientation: value });
        },

        toggleOrientation: function () {
            var cur = sget("page_orientation", "landscape");
            NP.settings.setOrientation(
                cur === "portrait" ? "landscape" : "portrait"
            );
        },

        /* Reflect saved theme / ui_font into the dropdowns WITHOUT firing
           change events (used on init and every open). */
        syncFromState: function () {
            var themeDd = document.getElementById("setting-theme");
            if (themeDd) selectOption(themeDd, currentTheme(), false);
            var fontDd = document.getElementById("setting-ui-font");
            if (fontDd) selectOption(fontDd, currentUiFont(), false);

            /* ---- Settings v2 controls ---- */
            setToggle("setting-crt",
                !!(NP.effects && NP.effects.crtIsOn && NP.effects.crtIsOn()));
            setToggle("setting-matrix-rain",
                sget("matrix_rain_enabled", true) !== false);
            setToggle("setting-show-splash",
                sget("show_splash", true) !== false);
            setToggle("setting-autosave", !!sget("autosave", false));
            setToggle("setting-spellcheck",
                sget("spellcheck", true) !== false);
            setToggle("setting-glitch-effect",
                sget("glitch_effect", true) !== false);
            setToggle("setting-confirm-delete",
                sget("confirm_delete", true) !== false);
            setToggle("setting-default-encrypted",
                !!sget("default_encrypted", false));
            setToggle("setting-shortcut-hints",
                sget("show_shortcut_hints", true) !== false);

            var aiDd = document.getElementById("setting-autosave-interval");
            if (aiDd) {
                selectOption(aiDd, String(sget("autosave_interval", 5)), false);
            }
            var idleDd = document.getElementById("setting-idle-lock");
            if (idleDd) {
                selectOption(idleDd, String(sget("idle_lock_minutes", "off")),
                    false);
            }
            var langDd = document.getElementById("setting-language");
            if (langDd) selectOption(langDd, String(sget("language", "auto")), false);

            syncRadioGroup("page-orientation",
                sget("page_orientation", "landscape"));

            var glowSlider2 = document.getElementById("setting-glow-intensity");
            if (glowSlider2) {
                var glow = sget("glow_intensity", 100);
                glowSlider2.value = glow;
                applyGlow(glow);
            }
        },

        open: function () {
            var overlay = document.getElementById("settings-overlay");
            if (!overlay) return;
            NP.settings.syncFromState();
            applyUiFont(currentUiFont());
            refreshStorageUsed();
            if (NP.shortcutsManager && NP.shortcutsManager.refreshSummary) {
                NP.shortcutsManager.refreshSummary();
            }
            overlay.classList.add("visible");
        },

        close: function () {
            var overlay = document.getElementById("settings-overlay");
            if (!overlay) return;
            closeAllDropdowns(null);
            overlay.classList.remove("visible");
        },

        toggle: function () {
            var overlay = document.getElementById("settings-overlay");
            if (overlay && overlay.classList.contains("visible")) {
                NP.settings.close();
            } else {
                NP.settings.open();
            }
        }
    };

})(window.NP);

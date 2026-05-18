/* matrix-rain.js - Matrix rain canvas overlay animation */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var CHARS = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン"
        + "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        + "0123456789"
        + "!@#$%^&*()-=+[]{}|;:<>?/~";
    var COL_WIDTH = 14;
    var MIN_SPEED = 20;
    var MAX_SPEED = 60;
    var MIN_TRAIL = 15;
    var MAX_TRAIL = 25;
    var CHAR_CHANGE_PROB = 0.016; /* ~1x per second at 60fps */

    function randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function randChar() {
        return CHARS[Math.floor(Math.random() * CHARS.length)];
    }

    function makeColumn(x, rows) {
        return {
            x: x,
            head: randInt(-rows, 0),
            speed: randInt(MIN_SPEED, MAX_SPEED),
            trail: randInt(MIN_TRAIL, MAX_TRAIL),
            chars: [],
            accumulator: 0
        };
    }

    NP.matrixRain = {
        running: false,
        canvas: null,
        ctx: null,
        columns: [],
        animId: null,
        _lastTime: 0,

        toggle: function () {
            if (this.running) {
                this.stop();
            } else {
                this.start();
            }
        },

        start: function () {
            if (this.running) return;
            this.running = true;

            /* Create canvas overlay */
            var canvas = document.createElement("canvas");
            canvas.id = "matrix-rain-canvas";
            canvas.style.cssText =
                "position:fixed;top:0;left:0;width:100%;height:100%;" +
                "z-index:900;pointer-events:none;";
            document.body.appendChild(canvas);
            this.canvas = canvas;
            this.ctx = canvas.getContext("2d");

            this._resize();
            this._initColumns();

            var self = this;
            this._resizeHandler = function () { self._resize(); self._initColumns(); };
            window.addEventListener("resize", this._resizeHandler);

            this._lastTime = performance.now();
            this._scheduleFrame();
        },

        stop: function () {
            this.running = false;
            if (this.animId) {
                cancelAnimationFrame(this.animId);
                this.animId = null;
            }
            if (this._resizeHandler) {
                window.removeEventListener("resize", this._resizeHandler);
                this._resizeHandler = null;
            }
            if (this.canvas && this.canvas.parentNode) {
                this.canvas.parentNode.removeChild(this.canvas);
            }
            this.canvas = null;
            this.ctx = null;
            this.columns = [];
        },

        _resize: function () {
            if (!this.canvas) return;
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        },

        _initColumns: function () {
            if (!this.canvas) return;
            var cols = Math.ceil(this.canvas.width / COL_WIDTH);
            var rows = Math.ceil(this.canvas.height / COL_WIDTH);
            this.columns = [];
            for (var i = 0; i < cols; i++) {
                var col = makeColumn(i * COL_WIDTH, rows);
                /* Pre-fill chars array */
                for (var j = 0; j < col.trail; j++) {
                    col.chars.push(randChar());
                }
                this.columns.push(col);
            }
        },

        _scheduleFrame: function () {
            var self = this;
            this.animId = requestAnimationFrame(function (t) { self._frame(t); });
        },

        _frame: function (timestamp) {
            if (!this.running || !this.ctx) return;

            var dt = (timestamp - this._lastTime) / 1000;
            this._lastTime = timestamp;
            /* Clamp delta to avoid huge jumps on tab switch */
            if (dt > 0.1) dt = 0.1;

            var ctx = this.ctx;
            var w = this.canvas.width;
            var h = this.canvas.height;

            /* Semi-transparent overlay for trail fade */
            ctx.fillStyle = "rgba(10, 10, 10, 0.15)";
            ctx.fillRect(0, 0, w, h);

            /* Read theme colors from CSS */
            var style = getComputedStyle(document.documentElement);
            var fgBright = style.getPropertyValue("--fg-bright").trim() || "#4cff7a";
            var fg = style.getPropertyValue("--fg").trim() || "#00ff41";
            var fgDim = style.getPropertyValue("--fg-dim").trim() || "#00bf30";

            ctx.font = COL_WIDTH + "px monospace";
            ctx.textBaseline = "top";

            var rows = Math.ceil(h / COL_WIDTH);

            for (var i = 0; i < this.columns.length; i++) {
                var col = this.columns[i];

                /* Accumulate movement based on speed (pixels per second) */
                col.accumulator += col.speed * dt;
                var steps = Math.floor(col.accumulator / COL_WIDTH);
                if (steps > 0) {
                    col.accumulator -= steps * COL_WIDTH;
                    col.head += steps;
                    /* Add new chars for each step */
                    for (var s = 0; s < steps; s++) {
                        col.chars.push(randChar());
                        if (col.chars.length > col.trail + 5) {
                            col.chars.shift();
                        }
                    }
                }

                /* Random character mutations in trail */
                for (var c = 0; c < col.chars.length; c++) {
                    if (Math.random() < CHAR_CHANGE_PROB) {
                        col.chars[c] = randChar();
                    }
                }

                /* Draw trail */
                var headRow = col.head;
                var startIdx = Math.max(0, col.chars.length - col.trail);
                for (var j = startIdx; j < col.chars.length; j++) {
                    var rowOffset = j - col.chars.length + 1;
                    var y = (headRow + rowOffset) * COL_WIDTH;
                    if (y < -COL_WIDTH || y > h) continue;

                    var distFromHead = col.chars.length - 1 - j;
                    var alpha;
                    if (distFromHead === 0) {
                        /* Head: bright */
                        ctx.fillStyle = fgBright;
                        alpha = 1.0;
                    } else if (distFromHead < 3) {
                        /* Near head: normal */
                        ctx.fillStyle = fg;
                        alpha = 0.9;
                    } else {
                        /* Tail: fading */
                        alpha = 1.0 - (distFromHead / col.trail);
                        if (alpha < 0.05) alpha = 0.05;
                        ctx.fillStyle = fgDim;
                    }
                    ctx.globalAlpha = alpha;
                    ctx.fillText(col.chars[j], col.x, y);
                }
                ctx.globalAlpha = 1.0;

                /* Reset column when fully off screen */
                if ((headRow - col.trail) * COL_WIDTH > h) {
                    var newCol = makeColumn(col.x, rows);
                    for (var k = 0; k < newCol.trail; k++) {
                        newCol.chars.push(randChar());
                    }
                    this.columns[i] = newCol;
                }
            }

            this._scheduleFrame();
        }
    };

})(window.NP);

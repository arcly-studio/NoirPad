// Integration harness for tab flows (review 2): the real state.js, tabs.js,
// editor.js and tree.js against an in-memory server that behaves like the
// backend where it matters (a trashed note refuses saves, a folder goes to
// the trash with its whole subtree). Every fix that goes through tabs gets a
// test here that fails without the fix.
import { vi } from "vitest";
import { loadApp } from "./harness.js";

export const BODY = `
  <div id="tab-bar"></div>
  <div id="tree-container"></div>
  <div class="side-head" id="side-tags-head"><button id="side-tags-toggle" type="button" aria-expanded="true"></button></div>
  <div id="tag-list"></div>
  <input id="note-title-input">
  <div id="tag-bar"></div>
  <div id="editor" contenteditable="false"></div>
  <div id="md-stack"><div id="md-highlight"></div><textarea id="editor-md"></textarea><div id="md-preview"></div></div>
  <div id="status-label"><span class="status-text"></span></div>
  <div id="mode-label"></div>`;

export const SCRIPTS = ["js/utils.js", "js/state.js", "js/topbar.js", "js/editor.js",
    "js/tabs.js", "js/tree.js"];

const clone = (v) => JSON.parse(JSON.stringify(v));

function findWithParent(items, id, parent = null) {
    for (const it of items) {
        if (it.id === id) return { item: it, list: items, parent };
        const hit = findWithParent(it.children || [], id, it);
        if (hit) return hit;
    }
    return null;
}

function noteIds(item, out = []) {
    if (item.type === "note") out.push(item.id);
    (item.children || []).forEach((c) => noteIds(c, out));
    return out;
}

export const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// tree: [{id, name, type, children?}], notes: {id: content}
export function startApp({ tree, notes, modes = {}, scripts = [], body = BODY } = {}) {
    const win = loadApp([...SCRIPTS, ...scripts], { body });
    const srv = {
        tree: clone(tree), notes: { ...notes }, modes: { ...modes },
        trash: { tree: [], notes: {} },
        saves: [],          // [id, content] of every accepted save
        refused: [],        // [id, content] the server refused
        holds: {},          // id -> resolve(): getNote waits until released
        failSaves: false,
        confirmAnswer: true, // what the user answers in NP.dialog.confirm
    };
    const err = (msg, status) => Object.assign(new Error(msg), { status });
    const data = () => ({
        tree: clone(srv.tree), favorites: [], note_modes: { ...srv.modes },
        trash: { tree: clone(srv.trash.tree), notes: {} }, confirm_delete: false,
        autosave: true, autosave_interval: 30,
    });
    let etag = 1;
    win.NP.api = {
        getDataIfChanged: vi.fn((tag) => Promise.resolve(
            tag === String(etag) ? null : { data: data(), etag: String(etag) })),
        getNote: vi.fn((id) => {
            const answer = () => {
                if (id in srv.notes) return { content: srv.notes[id], formats: [], mode: srv.modes[id] || "richtext" };
                if (id in srv.trash.notes) return { content: srv.trash.notes[id], formats: [], trashed: true };
                throw err("Note not found", 404);
            };
            if (srv.holds[id]) return new Promise((res, rej) => {
                srv.holds[id] = () => { try { res(answer()); } catch (e) { rej(e); } };
            });
            try { return Promise.resolve(answer()); } catch (e) { return Promise.reject(e); }
        }),
        saveNote: vi.fn((id, content) => {
            if (srv.failSaves || !(id in srv.notes)) {
                srv.refused.push([id, content]);
                return Promise.reject(err(srv.failSaves ? "Disk full" : "The note no longer exists.", srv.failSaves ? 507 : 404));
            }
            srv.notes[id] = content;
            srv.saves.push([id, content]);
            etag++;
            return Promise.resolve({ ok: true });
        }),
        rename: vi.fn((id, name) => {
            const hit = findWithParent(srv.tree, id);
            if (!hit) return Promise.reject(err("Not found", 404));
            hit.item.name = name;
            etag++;
            return Promise.resolve({ ok: true });
        }),
        deleteItem: vi.fn((id) => {
            const hit = findWithParent(srv.tree, id);
            if (!hit) return Promise.reject(err("Not found", 404));
            hit.list.splice(hit.list.indexOf(hit.item), 1);
            srv.trash.tree.push(hit.item);
            for (const nid of noteIds(hit.item)) {
                srv.trash.notes[nid] = srv.notes[nid];
                delete srv.notes[nid];
            }
            etag++;
            return Promise.resolve({ ok: true });
        }),
        setNoteMode: vi.fn((id, mode) => { srv.modes[id] = mode; return Promise.resolve({ ok: true }); }),
        setTags: vi.fn((id, tags) => {
            const answer = () => {
                const hit = findWithParent(srv.tree, id);
                if (!hit) throw err("Not found", 404);
                if (tags.length > 50 || tags.some((t) => t.length > 100)) throw err("Invalid input", 422);
                hit.item.tags = [...tags];
                etag++;
                return { ok: true };
            };
            if (srv.holds["tags:" + id]) return new Promise((res, rej) => {
                srv.holds["tags:" + id] = () => { try { res(answer()); } catch (e) { rej(e); } };
            });
            try { return Promise.resolve(answer()); } catch (e) { return Promise.reject(e); }
        }),
        restoreFromTrash: vi.fn((id) => {
            const i = srv.trash.tree.findIndex((t) => t.id === id);
            if (i === -1) return Promise.reject(err("Not found", 404));
            const [item] = srv.trash.tree.splice(i, 1);
            srv.tree.push(item);
            for (const nid of noteIds(item)) {
                srv.notes[nid] = srv.trash.notes[nid];
                delete srv.trash.notes[nid];
            }
            etag++;
            return Promise.resolve({ ok: true });
        }),
        toggleFavorite: vi.fn(() => Promise.resolve({ ok: true })),
        lock: vi.fn(() => Promise.resolve({ ok: true })),
    };
    win.NP.dialog = {
        confirm: vi.fn(() => Promise.resolve(srv.confirmAnswer)),
        alert: vi.fn(() => Promise.resolve()),
        failed: vi.fn(),
    };
    win.NP.editor.init();
    const app = {
        win, srv, NP: win.NP,
        ready: () => win.NP.state.init().then(() => win.NP.tree.render()),
        // what the user sees and does
        open: async (id) => { win.NP.tabs.add(id, findWithParent(srv.tree, id).item.name); await flush(); },
        type: (text) => {
            const ed = win.NP.editor.el;
            ed.textContent = text;
            ed.dispatchEvent(new win.Event("input", { bubbles: true }));
        },
        tabs: () => win.NP.state.openTabs.map((t) => t.id),
        hold: (id) => { srv.holds[id] = true; },
        release: (id) => { const r = srv.holds[id]; delete srv.holds[id]; if (typeof r === "function") r(); },
    };
    return app;
}

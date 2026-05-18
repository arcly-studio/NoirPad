# NoirPad Web — `server.py`

FastAPI backend pro NoirPad. Samostatný projekt — `notes_data.json` a složka `images/` leží v kořeni projektu (vedle `server.py`). Datový formát zůstává kompatibilní s desktopovou aplikací (lze ručně přenést soubory).

## Přehled

- **Framework:** FastAPI + Uvicorn
- **Úložiště:** `notes_data.json` (JSON na disku) + `images/` (binární soubory)
- **Šifrování:** Fernet (PBKDF2-HMAC-SHA256, 480 000 iterací) — kompatibilní s desktop verzí
- **Spuštění:** `python server.py` → běží na `0.0.0.0:8000`

## Struktura souborů

```
NoirPad-web/              ← BASE_DIR
├── server.py
├── notes_data.json       ← DATA_FILE (vytvoří se za běhu, gitignored)
├── images/               ← IMAGES_DIR (gitignored)
└── static/               ← STATIC_DIR (CSS, JS, index.html)
```

## Datový model

`notes_data.json` má následující strukturu:

```json
{
  "tree": [],
  "notes": {},
  "favorites": [],
  "trash": { "tree": [], "notes": {} },
  "note_formats": {},
  "theme": "matrix",
  "font_family": "Cascadia Code",
  "font_size": 12,
  "autosave": false,
  "page_orientation": "landscape"
}
```

Strom (`tree`) obsahuje položky typu `note` nebo `folder`. Folder má pole `children`. Obsah poznámek je uložen v `notes` pod jejich `id`.

## Thread-safe I/O

Všechny operace nad `notes_data.json` jsou chráněné `threading.Lock()`:

| Funkce | Popis |
|---|---|
| `_read_data()` | Načte JSON, vrátí default pokud chybí |
| `_write_data(data)` | Zapíše JSON s `indent=2`, `ensure_ascii=False` |
| `_data_mtime()` | Vrátí mtime souboru pro polling klienta |

## Pomocné funkce

| Funkce | Účel |
|---|---|
| `find_item_by_id(tree, id)` | Rekurzivně najde položku ve stromě |
| `find_parent_list(tree, id)` | Najde seznam, který položku přímo obsahuje |
| `collect_note_ids(item)` | Vrátí všechny note ID pod položkou |
| `move_to_trash(data, id)` | Přesune položku + obsahy + formáty do koše |
| `restore_from_trash(data, id)` | Obnoví ze koše do kořene stromu |
| `get_all_tags(data)` | Setříděný seznam všech unikátních tagů |

## Šifrování

Formát: `version(1B) + salt(16B) + fernet_payload`, base64-zakódováno do `{"encrypted": true, "data": "..."}`.

- **Verze 1:** Fernet (AES-128-CBC + HMAC), PBKDF2 480k iterací
- **Verze 2:** XOR s PBKDF2 klíčem (legacy, jen dešifrování)

## API endpointy

### Data
| Metoda | Cesta | Popis |
|---|---|---|
| `GET` | `/` | Vrátí `static/index.html` |
| `GET` | `/api/data` | Kompletní snapshot dat |
| `GET` | `/api/data/version` | mtime souboru (pro polling) |

### Strom
| Metoda | Cesta | Popis |
|---|---|---|
| `POST` | `/api/tree/new-note` | Vytvoří poznámku (volitelně v `parent_id`) |
| `POST` | `/api/tree/new-folder` | Vytvoří složku |
| `POST` | `/api/tree/rename` | Přejmenuje položku |
| `POST` | `/api/tree/move` | Přesune položku (`before`/`after`/`inside`) |
| `POST` | `/api/tree/delete` | Přesune do koše |

### Poznámky
| Metoda | Cesta | Popis |
|---|---|---|
| `GET` | `/api/note/{note_id}` | Vrátí `{content, formats}` |
| `PUT` | `/api/note/{note_id}` | Uloží obsah + formátování |

### Oblíbené
| Metoda | Cesta | Popis |
|---|---|---|
| `POST` | `/api/favorites/toggle` | Přepne stav oblíbenosti |

### Tagy
| Metoda | Cesta | Popis |
|---|---|---|
| `GET` | `/api/tags` | Seznam všech tagů |
| `PUT` | `/api/tags/{item_id}` | Nastaví tagy položce |

### Koš
| Metoda | Cesta | Popis |
|---|---|---|
| `GET` | `/api/trash` | Vrátí obsah koše |
| `POST` | `/api/trash/restore` | Obnoví položku |
| `POST` | `/api/trash/empty` | Vyprázdní koš + smaže obrázky |
| `POST` | `/api/trash/delete` | Trvale smaže jednu položku z koše |

### Nastavení
| Metoda | Cesta | Popis |
|---|---|---|
| `PUT` | `/api/settings` | Theme / font / autosave / orientace |

### Šifrování
| Metoda | Cesta | Popis |
|---|---|---|
| `POST` | `/api/encrypt` | Zašifruje obsah poznámky a uloží |
| `POST` | `/api/decrypt` | Dešifruje a uloží jako plaintext |
| `POST` | `/api/decrypt-view` | Dešifruje **bez** zápisu (jen pro čtení) |
| `POST` | `/api/save-encrypted` | Zašifruje nový obsah daným heslem |

### Obrázky
| Metoda | Cesta | Popis |
|---|---|---|
| `POST` | `/api/images/upload` | Upload, vrátí `{filename, url}` |
| `GET`  | `/images/{filename}` | Statická data obrázku |

### Export
| Metoda | Cesta | Popis |
|---|---|---|
| `GET` | `/api/export/{note_id}/txt` | Export jako `.txt` |
| `GET` | `/api/export/{note_id}/html` | Export jako jednoduché HTML |

### Záloha
| Metoda | Cesta | Popis |
|---|---|---|
| `GET` | `/api/backup` | ZIP s `notes_data.json` + `images/` |
| `POST` | `/api/backup/import` | Import ZIP zálohy (validuje JSON) |

## Pydantic modely (request bodies)

| Model | Pole |
|---|---|
| `NewItemReq` | `parent_id?`, `name` |
| `RenameReq` | `id`, `name` |
| `MoveReq` | `id`, `target_id`, `position` |
| `DeleteReq` | `id` |
| `NoteBody` | `content`, `formats` |
| `ToggleFavReq` | `id` |
| `TagsBody` | `tags` |
| `RestoreReq` | `id` |
| `SettingsBody` | `theme?`, `font_family?`, `font_size?`, `autosave?`, `page_orientation?` |
| `CryptoReq` | `id`, `password` |
| `SaveEncryptedReq` | `id`, `password`, `content`, `formats` |

## CORS

`allow_origins=["*"]` — povoleno všem (vhodné pro lokální vývoj, v produkci zúžit).

## Spuštění

```bash
python server.py
# nebo
uvicorn server:app --host 0.0.0.0 --port 8000
```

"""API routers, one module per area. Included by noirpad.app."""

from . import backup, data, encryption, export, images, notes, session, settings, tree

ROUTERS = [session.router, data.router, tree.router, notes.router, settings.router,
           encryption.router, images.router, export.router, backup.router]

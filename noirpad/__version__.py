"""The one place the NoirPad version is written down.

Read by the API (/api/version, FastAPI), the About box (via the API), the
PyInstaller version resource, the Inno Setup installer (build.ps1 passes
/DAppVersion) and the release workflow.
"""

__version__ = "1.0.0"

# Project page — one constant if the repository is ever renamed.
PROJECT_URL = "https://github.com/krystof2-ops/NoirPad-web"

; ============================================================================
;  NoirPad — Inno Setup script
; ----------------------------------------------------------------------------
;  Builds a per-user Windows installer that drops the PyInstaller onedir
;  output (dist\NoirPad\) into %LOCALAPPDATA%\Programs\NoirPad and registers
;  Start Menu + (optional) desktop shortcuts plus an uninstaller.
;
;  Workflow:
;     1) pyinstaller --clean --noconfirm noirpad.spec
;     2) "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
;     3) Installer lands in dist\installer\NoirPad-Setup-<version>.exe
;
;  Per-user install means no UAC prompt and no admin rights. Data still
;  lives under %LOCALAPPDATA%\NoirPad\ (platformdirs default in frozen
;  mode), independent of the install dir, so uninstalling does NOT touch
;  the user's notes.
; ============================================================================

#define MyAppName        "NoirPad"
#define MyAppVersion     "1.0.0"
#define MyAppPublisher   "NoirPad"
#define MyAppURL         "https://github.com/krystof2-ops/NoirPad-web"
#define MyAppExeName     "NoirPad.exe"
#define MySourceDir      "dist\NoirPad"

[Setup]
; AppId — never change this once published; uninstaller keys off it.
AppId={{B6F2E7C0-7C2B-4A3F-9C6A-2F7A4E1D9A11}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
VersionInfoVersion={#MyAppVersion}

; Per-user install: drop everything under %LOCALAPPDATA%\Programs\NoirPad.
; This avoids UAC and Program Files write-protection entirely.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
AllowNoIcons=yes
UsePreviousAppDir=yes

; 64-bit only — PyInstaller builds match the host Python, which is x64.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

; Output
OutputDir=dist\installer
OutputBaseFilename=NoirPad-Setup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern

SetupIconFile=noirpad.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName} {#MyAppVersion}

; Clean wizard — no license/info pages until we have content for them.
DisableWelcomePage=no
DisableDirPage=no
DisableReadyPage=no
DisableFinishedPage=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "czech";   MessagesFile: "compiler:Languages\Czech.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Recursively grab the whole PyInstaller onedir output. The bootloader
; (NoirPad.exe) plus _internal\ must stay together; recursesubdirs keeps
; the layout intact.
Source: "{#MySourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}";        Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}";  Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; Offer to launch after install. nowait so the wizard closes immediately.
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; PyInstaller drops these next to the .exe at runtime; remove them so the
; install dir disappears cleanly. User notes live elsewhere — see header.
Type: filesandordirs; Name: "{app}\_internal"
Type: files;           Name: "{app}\{#MyAppExeName}"

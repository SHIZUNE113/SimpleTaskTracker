Task Tracker - portable exe
===========================

Put TaskTracker.exe in a folder you can write to (e.g. Documents\TaskTracker), not in
Program Files. Double-click to run. Nothing is installed and nothing is written to the registry.

Data
  Everything is kept in the TaskTrackerData folder next to the exe:
    store.json   your tasks, history, notes, staff list, notebook
    backups\     one automatic copy per day, the newest 30 are kept
    webview\     the window's own settings (language, sort order...)
  To move to another computer, copy the exe together with the whole TaskTrackerData folder.
  To roll back, close the app, copy a file from backups\ over store.json, and reopen.

Bringing data over from the browser version
  In the browser version click the download (export) button to save a backup .json,
  then in the exe click the upload (import) button and pick that file.

Start with Windows (no registry)
  Press Win+R, type  shell:startup  and press Enter. A folder opens.
  Right-click TaskTracker.exe -> Show more options -> Create shortcut, then move that
  shortcut into the startup folder. Delete the shortcut to stop it.

Network
  The app makes no network requests. Its window is only allowed to load its own bundled
  files and talk to its own exe; the "what's new" popup reads the copy of version.json
  built into the exe.

Needs Microsoft Edge WebView2, which is already part of Windows 10 and 11.

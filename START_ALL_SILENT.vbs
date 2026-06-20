' AntiBridge v3.7.2 - Silent Master Startup Script
' Runs the bot in the background without showing any CMD popup windows.
' The bot will automatically launch Antigravity IDE if it is not already running.

Set WshShell = CreateObject("WScript.Shell")
CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = CurrentDirectory

' Run START_BOT.bat with WindowStyle=0 (hidden) and WaitOnReturn=False
WshShell.Run "START_BOT.bat", 0, False

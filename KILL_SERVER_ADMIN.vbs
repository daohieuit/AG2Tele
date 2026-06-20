' ========================================
' Kill Server on Port 8000 (Auto Admin)
' ========================================

Set objShell = CreateObject("Shell.Application")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get script directory
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batFile = scriptDir & "\KILL_SERVER.bat"

' Check if batch file exists
If Not fso.FileExists(batFile) Then
    MsgBox "Error: KILL_SERVER.bat not found!" & vbCrLf & vbCrLf & "Path: " & batFile, vbCritical, "Kill Server Error"
    WScript.Quit 1
End If

' Run batch file with Admin rights
objShell.ShellExecute batFile, "", "", "runas", 1

' Cleanup
Set objShell = Nothing
Set fso = Nothing

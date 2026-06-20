# Script to create Windows Start Menu shortcuts for AG2Tele
# This script is fully portable and detects the current workspace directory automatically.

# Get the directory where this script is located
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
# Get the parent workspace directory
$workspaceDir = Split-Path -Parent $scriptRoot

$programsPath = [Environment]::GetFolderPath('Programs')
$folderPath = Join-Path $programsPath "AG2Tele"

if (-not (Test-Path $folderPath)) {
    New-Item -ItemType Directory -Force -Path $folderPath | Out-Null
}

$wshShell = New-Object -ComObject WScript.Shell

# Start Shortcut
$startShortcut = $wshShell.CreateShortcut((Join-Path $folderPath "AG2Tele - Start.lnk"))
$startShortcut.TargetPath = "wscript.exe"
$startShortcut.Arguments = """$(Join-Path $workspaceDir 'START_ALL_SILENT.vbs')"""
$startShortcut.WorkingDirectory = $workspaceDir
$startShortcut.Description = "Start AG2Tele Bot and IDE"
$startShortcut.Save()

# Stop Shortcut
$stopShortcut = $wshShell.CreateShortcut((Join-Path $folderPath "AG2Tele - Stop.lnk"))
$stopShortcut.TargetPath = "wscript.exe"
$stopShortcut.Arguments = """$(Join-Path $workspaceDir 'KILL_SERVER_ADMIN.vbs')"""
$stopShortcut.WorkingDirectory = $workspaceDir
$stopShortcut.Description = "Stop AG2Tele Bot and Server"
$stopShortcut.Save()

Write-Output "Shortcuts created successfully in Start Menu under AG2Tele folder!"

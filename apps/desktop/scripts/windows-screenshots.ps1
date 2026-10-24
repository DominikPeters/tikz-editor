# Launches the portable Windows build and saves screenshots of the window, in
# the light and dark app theme, for checking the Windows look on CI
# (design/native-windows-look.md, Verification). Not a test: it fails only
# when the app does not start.
param(
  [string]$ExecutablePath = (Join-Path $PSScriptRoot "..\src-tauri\target\release\tikz-editor.exe"),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\src-tauri\target\screenshots")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[void][NativeWindow]::SetProcessDPIAware()
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

# A larger desktop than the runner's default, where the window fits.
try { Set-DisplayResolution -Width 1920 -Height 1080 -Force -ErrorAction Stop } catch { Write-Host "Could not set the display resolution: $_" }

function Save-Screen([string]$Name, [System.Drawing.Rectangle]$Area) {
  $bitmap = New-Object System.Drawing.Bitmap $Area.Width, $Area.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($Area.Location, [System.Drawing.Point]::Empty, $Area.Size)
  $path = Join-Path $OutputDirectory "$Name.png"
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose(); $bitmap.Dispose()
  Write-Host "Saved $path"
}

function Get-WindowArea($Process) {
  $rect = New-Object NativeWindow+Rect
  [void][NativeWindow]::GetWindowRect($Process.MainWindowHandle, [ref]$rect)
  # A little margin shows the window's shadow and corners.
  $margin = 16
  return New-Object System.Drawing.Rectangle ($rect.Left - $margin), ($rect.Top - $margin), ($rect.Right - $rect.Left + 2 * $margin), ($rect.Bottom - $rect.Top + 2 * $margin)
}

function Send-Keys([string]$Keys, [int]$WaitMs = 700) {
  [System.Windows.Forms.SendKeys]::SendWait($Keys)
  Start-Sleep -Milliseconds $WaitMs
}

function Capture-Theme([string]$Theme) {
  # The app follows the Windows app theme by default.
  $personalize = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
  New-Item -Path $personalize -Force | Out-Null
  Set-ItemProperty -Path $personalize -Name AppsUseLightTheme -Value ([int]($Theme -eq "light")) -Type DWord
  Set-ItemProperty -Path $personalize -Name SystemUsesLightTheme -Value ([int]($Theme -eq "light")) -Type DWord

  $app = Start-Process -FilePath $ExecutablePath -WorkingDirectory (Split-Path $ExecutablePath) -PassThru
  try {
    $deadline = (Get-Date).AddSeconds(60)
    while ($app.MainWindowHandle -eq 0) {
      if ((Get-Date) -gt $deadline) { throw "The app opened no window within 60 s." }
      if ($app.HasExited) { throw "The app exited at start: $($app.ExitCode)" }
      Start-Sleep -Milliseconds 250
      $app.Refresh()
    }
    # Let the webview load and the first render settle.
    Start-Sleep -Seconds 8
    [void][NativeWindow]::SetForegroundWindow($app.MainWindowHandle)
    Start-Sleep -Milliseconds 500

    $area = Get-WindowArea $app
    Save-Screen "$Theme-1-window" $area

    Send-Keys "%f"
    Save-Screen "$Theme-2-file-menu" $area
    Send-Keys "{ESC}"; Send-Keys "{ESC}"

    Send-Keys "^,"
    Save-Screen "$Theme-3-settings" $area
    Send-Keys "{ESC}"

    # The pointer on the maximise button: Windows 11 shows Snap Layouts there.
    $rect = New-Object NativeWindow+Rect
    [void][NativeWindow]::GetWindowRect($app.MainWindowHandle, [ref]$rect)
    [void][NativeWindow]::SetCursorPos($rect.Right - 46 - 23, $rect.Top + 16)
    Start-Sleep -Seconds 2
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    Save-Screen "$Theme-4-snap-layouts" $screen
    [void][NativeWindow]::SetCursorPos(10, 10)

    # Maximised, as most people will use it.
    [void][NativeWindow]::ShowWindow($app.MainWindowHandle, 3)
    Start-Sleep -Seconds 2
    Save-Screen "$Theme-5-maximized" $screen
  } finally {
    if (-not $app.HasExited) {
      taskkill /PID $app.Id /T /F | Out-Null
    }
  }
}

Capture-Theme "light"
Capture-Theme "dark"

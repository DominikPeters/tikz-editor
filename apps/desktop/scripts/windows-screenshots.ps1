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
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr window);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr window, System.Text.StringBuilder name, int size);
  public delegate bool EnumProc(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr data);

  public static string ClassOf(IntPtr window) {
    var name = new System.Text.StringBuilder(256);
    GetClassName(window, name, name.Capacity);
    return name.ToString();
  }

  // What the window under a screen point answers to WM_NCHITTEST.
  public static int HitTest(int x, int y) {
    var window = WindowFromPoint(new Point { X = x, Y = y });
    return (int)SendMessage(window, 0x0084, IntPtr.Zero, (IntPtr)((y << 16) | (x & 0xffff)));
  }

  public static string Children(IntPtr parent) {
    var lines = new System.Text.StringBuilder();
    EnumChildWindows(parent, (child, data) => {
      Rect rect;
      GetWindowRect(child, out rect);
      lines.AppendLine(string.Format("  {0} {1} [{2},{3} {4}x{5}]", child, ClassOf(child), rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top));
      return true;
    }, IntPtr.Zero);
    return lines.ToString();
  }

  // Real pointer input, which reaches hit-testing and the shell as a mouse would.
  public static void MoveMouse(int x, int y) {
    mouse_event(0x8001, x * 65535 / (GetSystemMetrics(0) - 1), y * 65535 / (GetSystemMetrics(1) - 1), 0, UIntPtr.Zero);
  }

  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, string lParam, uint flags, uint timeout, out IntPtr result);

  // Tells running programs, the shell among them, that the theme changed, as
  // Settings does; otherwise they keep the theme they cached.
  public static void BroadcastThemeChange() {
    IntPtr result;
    SendMessageTimeout((IntPtr)0xffff, 0x001A, IntPtr.Zero, "ImmersiveColorSet", 2, 5000, out result);
  }

  public static void Click(int x, int y) {
    MoveMouse(x, y);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }
}
"@
[void][NativeWindow]::SetProcessDPIAware()
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

# A larger desktop than the runner's default, where the window fits.
try { Set-DisplayResolution -Width 1920 -Height 1080 -Force -ErrorAction Stop } catch { Write-Host "Could not set the display resolution: $_" }

# Snap Layouts on the maximise button, in case the server image turns it off.
$advanced = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"
Set-ItemProperty -Path $advanced -Name EnableSnapAssistFlyout -Value 1 -Type DWord
Set-ItemProperty -Path "HKCU:\Control Panel\Desktop" -Name WindowArrangementActive -Value "1"
Write-Host "Snap settings: $(Get-ItemProperty -Path $advanced | Select-Object EnableSnapAssistFlyout, EnableSnapBar | Out-String)"

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

# A point on the window's maximise button, found by hit-testing along the
# caption: Windows offers Snap Layouts where WM_NCHITTEST answers HTMAXBUTTON.
function Find-MaximizeButton([IntPtr]$Window) {
  $rect = New-Object NativeWindow+Rect
  [void][NativeWindow]::GetWindowRect($Window, [ref]$rect)
  foreach ($dy in 8, 16) {
    for ($x = $rect.Right - 2; $x -gt $rect.Right - 240; $x -= 2) {
      if ([NativeWindow]::HitTest($x, $rect.Top + $dy) -eq 9) {
        $width = 0
        while ([NativeWindow]::HitTest($x - $width - 2, $rect.Top + $dy) -eq 9) { $width += 2 }
        return [System.Drawing.Point]::new($x - [int]($width / 2), $rect.Top + $dy)
      }
    }
  }
  return $null
}

function Show-SnapLayouts([string]$Name, [IntPtr]$Window) {
  $button = Find-MaximizeButton $Window
  if (-not $button) {
    Write-Host "No HTMAXBUTTON along the caption of $Window"
    return $null
  }
  Write-Host "Maximise button of $Window at $button"
  [NativeWindow]::MoveMouse($button.X - 4, $button.Y)
  Start-Sleep -Milliseconds 200
  [NativeWindow]::MoveMouse($button.X, $button.Y)
  Start-Sleep -Seconds 2
  Save-Screen $Name ([System.Windows.Forms.Screen]::PrimaryScreen.Bounds)
  return $button
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
  [NativeWindow]::BroadcastThemeChange()
  Start-Sleep -Seconds 1

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
    Write-Host "Child windows of $($app.MainWindowHandle):"
    Write-Host ([NativeWindow]::Children($app.MainWindowHandle))
    $button = Show-SnapLayouts "$Theme-4-snap-layouts" $app.MainWindowHandle
    [NativeWindow]::MoveMouse(10, 10)
    Start-Sleep -Milliseconds 500

    # Maximised by a click on the button, as most people will use it.
    if ($button) {
      [NativeWindow]::Click($button.X, $button.Y)
      Start-Sleep -Seconds 2
      [NativeWindow]::MoveMouse(10, 10)
    }
    if (-not [NativeWindow]::IsZoomed($app.MainWindowHandle)) {
      Write-Host "A click on the maximise button did not maximise the window."
      [void][NativeWindow]::ShowWindow($app.MainWindowHandle, 3)
    }
    Start-Sleep -Seconds 2
    Save-Screen "$Theme-5-maximized" ([System.Windows.Forms.Screen]::PrimaryScreen.Bounds)
  } finally {
    if (-not $app.HasExited) {
      taskkill /PID $app.Id /T /F | Out-Null
    }
  }
}

# A control for the Snap Layouts shot: a window with a system-drawn caption.
$notepad = Start-Process notepad.exe -PassThru
try {
  Start-Sleep -Seconds 3
  $notepad.Refresh()
  if ($notepad.MainWindowHandle -ne 0) {
    [void][NativeWindow]::SetForegroundWindow($notepad.MainWindowHandle)
    [void](Show-SnapLayouts "0-control-snap-layouts" $notepad.MainWindowHandle)
    [NativeWindow]::MoveMouse(10, 10)
  }
} finally {
  if (-not $notepad.HasExited) { Stop-Process -Id $notepad.Id -Force }
}

Capture-Theme "light"
Capture-Theme "dark"

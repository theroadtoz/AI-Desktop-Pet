param(
  [Parameter(Mandatory = $true)]
  [UInt64]$ExpectedHwnd
)

$ErrorActionPreference = 'Stop'

try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class P283aCursorNeutralizer {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")]
  public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr value);

  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hwnd);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern int GetSystemMetrics(int index);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  private static long DistanceSquared(int x, int y, long centerX, long centerY) {
    long dx = x - centerX;
    long dy = y - centerY;
    return dx * dx + dy * dy;
  }

  public static void MoveOutside(ulong expectedHwndValue) {
    SetProcessDpiAwarenessContext(new IntPtr(-4));
    var hwnd = new IntPtr(unchecked((long)expectedHwndValue));
    RECT rect = new RECT();
    bool hasRect = expectedHwndValue != 0 && IsWindow(hwnd) && GetWindowRect(hwnd, out rect);

    int virtualLeft = GetSystemMetrics(76);
    int virtualTop = GetSystemMetrics(77);
    int virtualWidth = GetSystemMetrics(78);
    int virtualHeight = GetSystemMetrics(79);
    if (virtualWidth <= 32 || virtualHeight <= 32) throw new InvalidOperationException("Virtual screen is too small");

    int[,] points = new int[,] {
      { virtualLeft + 16, virtualTop + 16 },
      { virtualLeft + virtualWidth - 17, virtualTop + 16 },
      { virtualLeft + 16, virtualTop + virtualHeight - 17 },
      { virtualLeft + virtualWidth - 17, virtualTop + virtualHeight - 17 }
    };
    long centerX = hasRect ? ((long)rect.Left + rect.Right) / 2 : virtualLeft + virtualWidth / 2;
    long centerY = hasRect ? ((long)rect.Top + rect.Bottom) / 2 : virtualTop + virtualHeight / 2;
    int selectedX = points[0, 0];
    int selectedY = points[0, 1];
    long bestDistance = -1;
    for (int index = 0; index < 4; index++) {
      int x = points[index, 0];
      int y = points[index, 1];
      bool insideOldWindow = hasRect && x >= rect.Left && x < rect.Right && y >= rect.Top && y < rect.Bottom;
      if (insideOldWindow) continue;
      long distance = DistanceSquared(x, y, centerX, centerY);
      if (distance > bestDistance) {
        selectedX = x;
        selectedY = y;
        bestDistance = distance;
      }
    }
    if (bestDistance < 0) throw new InvalidOperationException("No neutral point outside the old Electron window");
    if (!SetCursorPos(selectedX, selectedY)) throw new InvalidOperationException("SetCursorPos failed");
  }
}
'@

  [P283aCursorNeutralizer]::MoveOutside($ExpectedHwnd)
  [Console]::Out.WriteLine('{"ok":true,"action":"cursor_neutralized"}')
  exit 0
} catch {
  [Console]::Error.WriteLine("safe_failure: cursor neutralization failed: $($_.Exception.Message)")
  exit 1
}

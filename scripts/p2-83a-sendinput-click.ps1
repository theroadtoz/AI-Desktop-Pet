param(
  [Parameter(Mandatory = $true)][UInt64]$ExpectedHwnd,
  [Parameter(Mandatory = $true)][UInt32]$ExpectedPid,
  [Parameter(Mandatory = $true)][double]$ClientX,
  [Parameter(Mandatory = $true)][double]$ClientY,
  [Parameter(Mandatory = $true)][ValidateRange(0.5, 8.0)][double]$DeviceScaleFactor,
  [ValidateRange(1, 100)][int]$PollIntervalMilliseconds = 25,
  [ValidateRange(50, 2000)][int]$ActivationTimeoutMilliseconds = 750,
  [ValidateRange(0, 500)][int]$OutsideSettleMilliseconds = 60,
  [switch]$PrepareOnly,
  [switch]$KeepCursorAtTarget
)

$ErrorActionPreference = 'Stop'

$signature = @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class P283ANativeMouse {
  [StructLayout(LayoutKind.Sequential)]
  private struct INPUT { public uint type; public MOUSEINPUT mouse; }

  [StructLayout(LayoutKind.Sequential)]
  private struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct POINT { public int x; public int y; }

  [StructLayout(LayoutKind.Sequential)]
  private struct RECT { public int left; public int top; public int right; public int bottom; }

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")]
  private static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool ClientToScreen(IntPtr hwnd, ref POINT point);
  [DllImport("user32.dll")]
  private static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")]
  private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint SendInput(uint count, INPUT[] inputs, int size);

  private const uint GA_ROOT = 2;

  public static string Click(
    ulong expectedHwndValue,
    uint expectedPid,
    double clientX,
    double clientY,
    double deviceScaleFactor,
    int pollIntervalMilliseconds,
    int activationTimeoutMilliseconds,
    int outsideSettleMilliseconds,
    bool prepareOnly,
    bool keepCursorAtTarget
  ) {
    var perMonitorAwareV2 = new IntPtr(-4);
    if (!SetProcessDpiAwarenessContext(perMonitorAwareV2)) {
      throw new Win32Exception(Marshal.GetLastWin32Error(), "SetProcessDpiAwarenessContext failed");
    }

    var expectedHwnd = new IntPtr(unchecked((long)expectedHwndValue));
    if (!IsWindow(expectedHwnd)) throw new InvalidOperationException("Expected HWND is no longer valid");
    AssertProcess(expectedHwnd, expectedPid, "expected HWND");

    POINT originalCursor;
    if (!GetCursorPos(out originalCursor)) {
      throw new Win32Exception(Marshal.GetLastWin32Error(), "GetCursorPos failed");
    }

    try {
      RECT clientRect;
      if (!GetClientRect(expectedHwnd, out clientRect)) {
        throw new Win32Exception(Marshal.GetLastWin32Error(), "GetClientRect failed");
      }
      var clientPoint = new POINT {
        x = checked((int)Math.Round(clientX * deviceScaleFactor)),
        y = checked((int)Math.Round(clientY * deviceScaleFactor))
      };
      if (clientPoint.x < clientRect.left || clientPoint.y < clientRect.top ||
          clientPoint.x >= clientRect.right || clientPoint.y >= clientRect.bottom) {
        throw new InvalidOperationException("DPI-scaled point is outside the expected client area");
      }
      if (!ClientToScreen(expectedHwnd, ref clientPoint)) {
        throw new Win32Exception(Marshal.GetLastWin32Error(), "ClientToScreen failed");
      }

      RECT beforeMove;
      if (!GetWindowRect(expectedHwnd, out beforeMove)) {
        throw new Win32Exception(Marshal.GetLastWin32Error(), "GetWindowRect failed");
      }
      var outsidePoint = FindOutsidePoint(beforeMove);
      if (!SetCursorPos(outsidePoint.x, outsidePoint.y)) {
        throw new Win32Exception(Marshal.GetLastWin32Error(), "SetCursorPos outside failed");
      }
      if (outsideSettleMilliseconds > 0) Thread.Sleep(outsideSettleMilliseconds);
      if (!SetCursorPos(clientPoint.x, clientPoint.y)) {
        throw new Win32Exception(Marshal.GetLastWin32Error(), "SetCursorPos target failed");
      }

      var activationClock = Stopwatch.StartNew();
      var activated = false;
      do {
        RECT beforeInputCheck;
        if (!GetWindowRect(expectedHwnd, out beforeInputCheck) || !SameRect(beforeMove, beforeInputCheck)) {
          throw new InvalidOperationException("Expected Electron window moved before SendInput");
        }
        if (IsExpectedPointTarget(clientPoint, expectedHwnd, expectedPid)) {
          activated = true;
          break;
        }
        Thread.Sleep(pollIntervalMilliseconds);
      } while (activationClock.ElapsedMilliseconds <= activationTimeoutMilliseconds);
      if (!activated) {
        throw new TimeoutException("Native point target activation timed out before SendInput");
      }
      AssertPointTarget(clientPoint, expectedHwnd, expectedPid, "before SendInput");

      if (prepareOnly) return clientPoint.x + "," + clientPoint.y;

      var inputs = new[] {
        new INPUT { type = 0, mouse = new MOUSEINPUT { dwFlags = 0x0002 } },
        new INPUT { type = 0, mouse = new MOUSEINPUT { dwFlags = 0x0004 } }
      };
      var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
      if (sent != (uint)inputs.Length) {
        throw new Win32Exception(Marshal.GetLastWin32Error(), "SendInput failed");
      }

      Thread.Sleep(60);
      if (!IsWindow(expectedHwnd)) throw new InvalidOperationException("Expected HWND closed after SendInput");
      AssertProcess(expectedHwnd, expectedPid, "expected HWND after SendInput");
      RECT afterInput;
      if (!GetWindowRect(expectedHwnd, out afterInput) || !SameRect(beforeMove, afterInput)) {
        throw new InvalidOperationException("Expected Electron window moved during SendInput");
      }
      return clientPoint.x + "," + clientPoint.y;
    } finally {
      if (!keepCursorAtTarget) SetCursorPos(originalCursor.x, originalCursor.y);
    }
  }

  private static POINT FindOutsidePoint(RECT windowRect) {
    var virtualLeft = GetSystemMetrics(76);
    var virtualTop = GetSystemMetrics(77);
    var virtualRight = virtualLeft + GetSystemMetrics(78) - 1;
    var virtualBottom = virtualTop + GetSystemMetrics(79) - 1;
    var candidates = new[] {
      new POINT { x = Math.Max(virtualLeft, windowRect.left - 12), y = Math.Max(virtualTop, windowRect.top - 12) },
      new POINT { x = Math.Min(virtualRight, windowRect.right + 12), y = Math.Max(virtualTop, windowRect.top - 12) },
      new POINT { x = Math.Max(virtualLeft, windowRect.left - 12), y = Math.Min(virtualBottom, windowRect.bottom + 12) },
      new POINT { x = virtualLeft, y = virtualTop },
      new POINT { x = virtualRight, y = virtualBottom }
    };
    foreach (var candidate in candidates) {
      if (candidate.x < windowRect.left || candidate.x >= windowRect.right ||
          candidate.y < windowRect.top || candidate.y >= windowRect.bottom) {
        return candidate;
      }
    }
    throw new InvalidOperationException("No safe virtual-screen point exists outside the pet window");
  }

  private static bool IsExpectedPointTarget(POINT point, IntPtr expectedHwnd, uint expectedPid) {
    var target = WindowFromPoint(point);
    if (target == IntPtr.Zero) return false;
    var targetRoot = GetAncestor(target, GA_ROOT);
    if (targetRoot != expectedHwnd) return false;
    uint actualPid;
    GetWindowThreadProcessId(targetRoot, out actualPid);
    return actualPid == expectedPid;
  }

  private static void AssertPointTarget(
    POINT point,
    IntPtr expectedHwnd,
    uint expectedPid,
    string phase
  ) {
    var target = WindowFromPoint(point);
    if (target == IntPtr.Zero) throw new InvalidOperationException("WindowFromPoint returned no window " + phase);
    var targetRoot = GetAncestor(target, GA_ROOT);
    if (targetRoot != expectedHwnd) {
      throw new InvalidOperationException("Point is occluded or targets a different Electron window " + phase);
    }
    AssertProcess(targetRoot, expectedPid, "point target root " + phase);
  }

  private static void AssertProcess(IntPtr hwnd, uint expectedPid, string label) {
    uint actualPid;
    GetWindowThreadProcessId(hwnd, out actualPid);
    if (actualPid != expectedPid) {
      throw new InvalidOperationException(label + " PID mismatch");
    }
  }

  private static bool SameRect(RECT left, RECT right) {
    return left.left == right.left && left.top == right.top &&
      left.right == right.right && left.bottom == right.bottom;
  }
}
'@

try {
  Add-Type -TypeDefinition $signature
  $screenPoint = [P283ANativeMouse]::Click(
    $ExpectedHwnd,
    $ExpectedPid,
    $ClientX,
    $ClientY,
    $DeviceScaleFactor,
    $PollIntervalMilliseconds,
    $ActivationTimeoutMilliseconds,
    $OutsideSettleMilliseconds,
    $PrepareOnly.IsPresent,
    $KeepCursorAtTarget.IsPresent
  )
  @{
    ok = $true
    input = if ($PrepareOnly) { "DPI-aware verified cursor preparation" } else { "DPI-aware Windows SetCursorPos + verified SendInput left click" }
    screenPoint = $screenPoint
  } | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine("safe_failure: " + $_.Exception.Message)
  exit 1
}

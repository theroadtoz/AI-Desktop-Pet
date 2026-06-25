param(
  [Parameter(Mandatory = $true)]
  [int] $X,

  [Parameter(Mandatory = $true)]
  [int] $Y,

  [Parameter(Mandatory = $true)]
  [int] $WheelDelta,

  [switch] $Ctrl,
  [switch] $Shift,
  [switch] $Alt,
  [switch] $MouseDown,
  [int] $HoldMilliseconds = 90
)

$ErrorActionPreference = "Stop"

$signature = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

public static class P2KSendInput {
  private const int INPUT_MOUSE = 0;
  private const int INPUT_KEYBOARD = 1;
  private const uint KEYEVENTF_KEYUP = 0x0002;
  private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  private const uint MOUSEEVENTF_LEFTUP = 0x0004;
  private const uint MOUSEEVENTF_WHEEL = 0x0800;

  [StructLayout(LayoutKind.Sequential)]
  private struct INPUT {
    public int type;
    public INPUTUNION u;
  }

  [StructLayout(LayoutKind.Explicit)]
  private struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  public static void SendWheel(int x, int y, int wheelDelta, bool ctrl, bool shift, bool alt, bool mouseDown, int holdMilliseconds) {
    if (!SetCursorPos(x, y)) {
      throw new InvalidOperationException("SetCursorPos failed: " + Marshal.GetLastWin32Error());
    }

    var keyDown = new List<INPUT>();
    if (ctrl) { keyDown.Add(Key(0x11, false)); }
    if (shift) { keyDown.Add(Key(0x10, false)); }
    if (alt) { keyDown.Add(Key(0x12, false)); }
    SendBatch(keyDown);
    Thread.Sleep(Math.Max(0, holdMilliseconds));

    var wheel = new List<INPUT>();
    if (mouseDown) { wheel.Add(Mouse(MOUSEEVENTF_LEFTDOWN, 0)); }
    wheel.Add(Mouse(MOUSEEVENTF_WHEEL, unchecked((uint)wheelDelta)));
    if (mouseDown) { wheel.Add(Mouse(MOUSEEVENTF_LEFTUP, 0)); }
    SendBatch(wheel);
    Thread.Sleep(Math.Max(0, holdMilliseconds));

    var keyUp = new List<INPUT>();
    if (alt) { keyUp.Add(Key(0x12, true)); }
    if (shift) { keyUp.Add(Key(0x10, true)); }
    if (ctrl) { keyUp.Add(Key(0x11, true)); }
    SendBatch(keyUp);
  }

  private static void SendBatch(List<INPUT> inputs) {
    if (inputs.Count == 0) {
      return;
    }

    var sent = SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT)));
    if (sent != inputs.Count) {
      throw new InvalidOperationException("SendInput failed: sent " + sent + " of " + inputs.Count + ", error " + Marshal.GetLastWin32Error());
    }
  }

  private static INPUT Key(ushort vk, bool keyUp) {
    var input = new INPUT();
    input.type = INPUT_KEYBOARD;
    input.u.ki.wVk = vk;
    input.u.ki.wScan = 0;
    input.u.ki.dwFlags = keyUp ? KEYEVENTF_KEYUP : 0;
    input.u.ki.time = 0;
    input.u.ki.dwExtraInfo = IntPtr.Zero;
    return input;
  }

  private static INPUT Mouse(uint flags, uint data) {
    var input = new INPUT();
    input.type = INPUT_MOUSE;
    input.u.mi.dx = 0;
    input.u.mi.dy = 0;
    input.u.mi.mouseData = data;
    input.u.mi.dwFlags = flags;
    input.u.mi.time = 0;
    input.u.mi.dwExtraInfo = IntPtr.Zero;
    return input;
  }
}
"@

Add-Type -TypeDefinition $signature
[P2KSendInput]::SendWheel($X, $Y, $WheelDelta, [bool]$Ctrl, [bool]$Shift, [bool]$Alt, [bool]$MouseDown, $HoldMilliseconds)

[pscustomobject]@{
  ok = $true
  x = $X
  y = $Y
  wheelDelta = $WheelDelta
  ctrl = [bool]$Ctrl
  shift = [bool]$Shift
  alt = [bool]$Alt
  mouseDown = [bool]$MouseDown
  input = "SetCursorPos + Windows SendInput keyboard modifiers and mouse wheel"
} | ConvertTo-Json -Compress

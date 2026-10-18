param([long]$WindowHandle,[string]$Action='Hit',[double]$X,[double]$Y,[double]$ViewWidth,[double]$ViewHeight,[double]$DeltaX=0,[double]$DeltaY=0,[int]$Wheel=-120)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CloudTunePointer {
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int L,T,R,B;}
 [StructLayout(LayoutKind.Sequential)] public struct Point {public int X,Y;}
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd,out Rect rect);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd,ref Point point);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd,uint msg,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
 public static long Hit(IntPtr hwnd,int x,int y){return SendMessage(hwnd,0x84,IntPtr.Zero,new IntPtr((y<<16)|(x&65535))).ToInt64();}
 public static void Wheel(int delta){mouse_event(0x800,0,0,unchecked((uint)delta),UIntPtr.Zero);}
}
'@
[void][CloudTunePointer]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
$hwnd=[IntPtr]::new($WindowHandle)
$rect=[CloudTunePointer+Rect]::new();[void][CloudTunePointer]::GetClientRect($hwnd,[ref]$rect)
$origin=[CloudTunePointer+Point]::new();[void][CloudTunePointer]::ClientToScreen($hwnd,[ref]$origin)
$scaleX=($rect.R-$rect.L)/$ViewWidth;$scaleY=($rect.B-$rect.T)/$ViewHeight
$px=[int]($origin.X+$X*$scaleX);$py=[int]($origin.Y+$Y*$scaleY)
$hit=[CloudTunePointer]::Hit($hwnd,$px,$py)
if($Action -ne 'Hit'){
 [void][CloudTunePointer]::SetForegroundWindow($hwnd)
 [void][CloudTunePointer]::SetCursorPos($px,$py)
 Start-Sleep -Milliseconds 60
 $hit=[CloudTunePointer]::Hit($hwnd,$px,$py)
 if($Action -eq 'DoubleClick'){
  for($i=0;$i -lt 2;$i++){[CloudTunePointer]::mouse_event(2,0,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 70;[CloudTunePointer]::mouse_event(4,0,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 70}
 }
 if($Action -eq 'Drag' -or $Action -eq 'Click'){
  [CloudTunePointer]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  try{if($Action -eq 'Drag'){for($i=1;$i -le 12;$i++){[void][CloudTunePointer]::SetCursorPos([int]($px+$DeltaX*$scaleX*$i/12),[int]($py+$DeltaY*$scaleY*$i/12));Start-Sleep -Milliseconds 18}}}
  finally{[CloudTunePointer]::mouse_event(4,0,0,0,[UIntPtr]::Zero)}
  Start-Sleep -Milliseconds 80
 }
 if($Action -eq 'Wheel'){[CloudTunePointer]::Wheel($Wheel)}
}
@{hit=$hit;scaleX=$scaleX;scaleY=$scaleY} | ConvertTo-Json -Compress

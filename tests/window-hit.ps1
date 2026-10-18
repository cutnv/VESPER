param([long]$WindowHandle,[int]$Inset=3)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CloudTuneHit {
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int L,T,R,B;}
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd,uint msg,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
 public static long Hit(long handle,int x,int y){return SendMessage(new IntPtr(handle),0x84,IntPtr.Zero,new IntPtr((y<<16)|(x&65535))).ToInt64();}
}
'@
[void][CloudTuneHit]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
$rect=[CloudTuneHit+Rect]::new()
[void][CloudTuneHit]::GetWindowRect([IntPtr]::new($WindowHandle),[ref]$rect)
$cx=[int](($rect.L+$rect.R)/2);$cy=[int](($rect.T+$rect.B)/2)
$points=@(@('left',($rect.L+$Inset),$cy),@('right',($rect.R-$Inset-1),$cy),@('top',$cx,($rect.T+$Inset)),@('bottom',$cx,($rect.B-$Inset-1)),@('topLeft',($rect.L+$Inset+3),($rect.T+$Inset+3)),@('topRight',($rect.R-$Inset-4),($rect.T+$Inset+3)),@('bottomLeft',($rect.L+$Inset+3),($rect.B-$Inset-4)),@('bottomRight',($rect.R-$Inset-4),($rect.B-$Inset-4)))
$output=@{}
foreach($point in $points){$output[$point[0]]=[CloudTuneHit]::Hit($WindowHandle,[int]$point[1],[int]$point[2])}
$output | ConvertTo-Json -Compress

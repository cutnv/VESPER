param([int]$KeyCode)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CloudTuneTestKeys {
 [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
}
'@
[CloudTuneTestKeys]::keybd_event(0x11,0,0,[UIntPtr]::Zero)
[CloudTuneTestKeys]::keybd_event(0x12,0,0,[UIntPtr]::Zero)
[CloudTuneTestKeys]::keybd_event([byte]$KeyCode,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 45
[CloudTuneTestKeys]::keybd_event([byte]$KeyCode,0,2,[UIntPtr]::Zero)
[CloudTuneTestKeys]::keybd_event(0x12,0,2,[UIntPtr]::Zero)
[CloudTuneTestKeys]::keybd_event(0x11,0,2,[UIntPtr]::Zero)

param([long]$hwnd, [int]$affinity = 17)
try {
    Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class AffinityHelper {
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);
    }
"@
    $ptr = [System.IntPtr]::new($hwnd)
    $res = [AffinityHelper]::SetWindowDisplayAffinity($ptr, [uint32]$affinity)
    Write-Output "RESULT:$res"
} catch {
    Write-Output "ERROR:$($_.Exception.Message)"
}

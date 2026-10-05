using System;
using System.Runtime.InteropServices;

public class Program {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetWindowDisplayAffinity(IntPtr hWnd, out uint pdwAffinity);

    public static int Main(string[] args) {
        if (args.Length < 1) {
            Console.WriteLine("Usage: SetAffinity.exe <hwnd> [affinity]");
            return 1;
        }

        long hwndVal;
        if (!long.TryParse(args[0], out hwndVal)) {
            Console.WriteLine("Invalid HWND");
            return 2;
        }

        IntPtr hWnd = new IntPtr(hwndVal);
        uint targetAffinity = 1; // 0x00000001 WDA_MONITOR: forces black rectangle in OBS and screen recorders
        if (args.Length >= 2) {
            uint.TryParse(args[1], out targetAffinity);
        }

        bool result = SetWindowDisplayAffinity(hWnd, targetAffinity);
        if (!result) {
            result = SetWindowDisplayAffinity(hWnd, 1); // Ensure WDA_MONITOR is strictly enforced
            targetAffinity = 1;
        }

        int err = Marshal.GetLastWin32Error();
        uint currentAffinity = 0;
        GetWindowDisplayAffinity(hWnd, out currentAffinity);

        Console.WriteLine("SET_RESULT:" + result + " AFFINITY:" + currentAffinity + " LAST_ERROR:" + err);
        return result ? 0 : 3;
    }
}

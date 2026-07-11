#include <windows.h>
#include <string.h>
#include <stdio.h>

int WINAPI WinMain(HINSTANCE hInst, HINSTANCE hPrev, LPSTR lpCmdLine, int nShowCmd) {
    char exePath[MAX_PATH];
    char dirPath[MAX_PATH];
    char electronPath[MAX_PATH];
    char cmdLine[8192];

    GetModuleFileNameA(NULL, exePath, MAX_PATH);
    strcpy(dirPath, exePath);
    char* lastSlash = strrchr(dirPath, '\\');
    if (lastSlash) *lastSlash = '\0';

    snprintf(electronPath, sizeof(electronPath), "%s\\node_modules\\electron\\dist\\electron.exe", dirPath);

    // Check if electron.exe exists
    DWORD attr = GetFileAttributesA(electronPath);
    if (attr == INVALID_FILE_ATTRIBUTES) {
        char msg[2048];
        snprintf(msg, sizeof(msg),
            "找不到 Electron 运行时。\n\n"
            "预期路径:\n%s\n\n"
            "可能原因:\n"
            "1. 请确保解压完整，node_modules 目录未被省略\n"
            "2. 不要将程序放在路径过长的位置（如多层嵌套文件夹）\n"
            "3. 建议解压到 D:\\SWJTU\\ 等短路径下运行",
            electronPath);
        MessageBoxA(NULL, msg, "西南交大抢课系统 - 启动失败", MB_ICONERROR | MB_OK);
        return 1;
    }

    snprintf(cmdLine, sizeof(cmdLine), "\"%s\" \"%s\"", electronPath, dirPath);

    STARTUPINFOA si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    ZeroMemory(&pi, sizeof(pi));
    si.cb = sizeof(si);

    BOOL ok = CreateProcessA(NULL, cmdLine, NULL, NULL, FALSE,
        CREATE_NO_WINDOW, NULL, dirPath, &si, &pi);
    if (!ok) {
        DWORD err = GetLastError();
        char msg[1024];
        snprintf(msg, sizeof(msg),
            "无法启动 Electron (错误代码: %lu)。\n\n"
            "路径: %s\n\n"
            "可能原因:\n"
            "1. 缺少 VC++ 运行库，请安装 Visual C++ Redistributable\n"
            "2. 杀毒软件拦截了 electron.exe\n"
            "3. 路径包含特殊字符",
            err, electronPath);
        MessageBoxA(NULL, msg, "西南交大抢课系统 - 启动失败", MB_ICONERROR | MB_OK);
        return 1;
    }

    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return 0;
}

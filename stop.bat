@echo off
set "APPDIR=%~dp0"

if /i not "%~1"=="/silencioso" (
    title Corny - Parar Servidor
    echo ============================================
    echo      CORNY - PARANDO SERVIDOR
    echo ============================================
    echo.
)

REM Mata somente o que e deste jogo: o node do server.js desta pasta e o tunel (ngrok/cloudflared)
REM que esta dentro desta pasta ou que tem a pasta na linha de comando (ngrok instalado no sistema)
powershell -NoProfile -Command "$d = $env:APPDIR; $n = 0; Get-CimInstance Win32_Process | Where-Object { $tunnel = ($_.Name -eq 'ngrok.exe' -or $_.Name -eq 'cloudflared.exe'); $mine = ($_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.IndexOf($d + 'server.js', [StringComparison]::OrdinalIgnoreCase) -ge 0) -or ($tunnel -and (($_.ExecutablePath -and $_.ExecutablePath.StartsWith($d, [StringComparison]::OrdinalIgnoreCase)) -or ($_.CommandLine -and $_.CommandLine.IndexOf($d, [StringComparison]::OrdinalIgnoreCase) -ge 0))); $mine } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('  Parado: ' + $_.Name + ' (PID ' + $_.ProcessId + ')'); $n++ }; if ($n -eq 0) { Write-Host '  Nada rodando.' }"

if exist "%~dp0URL_PUBLICA.txt" del /q "%~dp0URL_PUBLICA.txt"

if /i not "%~1"=="/silencioso" (
    echo.
    echo [OK] Servidor e tunel finalizados.
    echo.
    pause
)

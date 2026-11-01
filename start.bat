@echo off
title Corny
color 0A
cd /d "%~dp0"
set "APPDIR=%~dp0"

echo ============================================
echo      CORNY - cortar o mal pela raiz
echo ============================================
echo.

REM Verificar se Node.js esta instalado
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Node.js nao encontrado!
    echo.
    echo Por favor, instale o Node.js de: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [1/4] Verificando Node.js...
node --version
echo.

REM Verificar se package.json existe
if not exist "package.json" (
    echo [ERRO] package.json nao encontrado!
    echo Certifique-se de estar na pasta correta do projeto.
    echo.
    pause
    exit /b 1
)

REM Sincronizar dependencias com o package.json (rapido quando ja esta tudo instalado)
echo [2/4] Verificando dependencias...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
    if not exist "node_modules" (
        echo.
        echo [ERRO] Falha ao instalar dependencias!
        echo.
        pause
        exit /b 1
    )
    echo [AVISO] Nao foi possivel atualizar as dependencias. Seguindo com as ja instaladas.
)
echo.

REM Parar apenas o servidor e o tunel desta pasta (nao mexe em outros node.exe)
echo [3/4] Parando processos anteriores...
call "%~dp0stop.bat" /silencioso
echo.

REM Configuracao do tunel no .env:
REM   NGROK_DOMAIN=seu-dominio.ngrok-free.dev  (endereco fixo do ngrok)
REM   NGROK_AUTHTOKEN=...                      (token do painel do ngrok; o ngrok le direto da variavel)
REM Sem NGROK_DOMAIN, usa o tunel temporario da Cloudflare (endereco muda a cada inicio).
set "NGROK_DOMAIN="
set "NGROK_AUTHTOKEN="
if exist ".env" (
    for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
        if /i "%%A"=="NGROK_DOMAIN" set "NGROK_DOMAIN=%%B"
        if /i "%%A"=="NGROK_AUTHTOKEN" set "NGROK_AUTHTOKEN=%%B"
    )
)

echo [4/4] Abrindo tunel publico...
if exist "tunnel.log" del /q "tunnel.log"
if exist "URL_PUBLICA.txt" del /q "URL_PUBLICA.txt"
set "TUNEL_FIXO="
if defined NGROK_DOMAIN goto tunel_ngrok
goto tunel_cloudflare

:tunel_ngrok
REM O ngrok precisa estar instalado (winget install ngrok.ngrok ou Microsoft Store).
REM Ele nao e baixado solto aqui: o Windows Defender bloqueia o arquivo avulso como PUA.
set "NGROK_EXE="
if exist "tools\ngrok.exe" set "NGROK_EXE=%APPDIR%tools\ngrok.exe"
if not defined NGROK_EXE for /f "delims=" %%N in ('where ngrok 2^>nul') do if not defined NGROK_EXE set "NGROK_EXE=%%N"
REM Instalado agora ha pouco o PATH desta janela ainda nao sabe: procura nas pastas do winget e da Store
if not defined NGROK_EXE if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\ngrok.exe" set "NGROK_EXE=%LOCALAPPDATA%\Microsoft\WinGet\Links\ngrok.exe"
if not defined NGROK_EXE for /d %%P in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\Ngrok.Ngrok_*") do if exist "%%P\ngrok.exe" set "NGROK_EXE=%%P\ngrok.exe"
if not defined NGROK_EXE if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\ngrok.exe" set "NGROK_EXE=%LOCALAPPDATA%\Microsoft\WindowsApps\ngrok.exe"
if not defined NGROK_EXE (
    echo [AVISO] ngrok nao instalado. Para o endereco fixo, rode uma vez:  winget install ngrok.ngrok
    echo          Usando o tunel temporario da Cloudflare.
    goto tunel_cloudflare
)
echo Abrindo %NGROK_DOMAIN% com o ngrok (ate 30 segundos)...
if exist "ngrok.log" del /q "ngrok.log"
REM Log proprio (ngrok.log) com caminho completo: guarda o motivo de uma falha e deixa a pasta
REM do jogo na linha de comando, que e como o stop.bat acha este ngrok
powershell -NoProfile -Command "Start-Process -FilePath $env:NGROK_EXE -ArgumentList 'http','3000',('--domain=' + $env:NGROK_DOMAIN),'--log',('\"' + $env:APPDIR + 'ngrok.log\"') -WorkingDirectory $env:APPDIR -WindowStyle Hidden"
REM Confirma pela API local do ngrok que o endereco fixo esta no ar
powershell -NoProfile -Command "for ($i = 0; $i -lt 30; $i++) { try { $t = Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 1; $u = $t.tunnels | Where-Object { $_.public_url -like ('*' + $env:NGROK_DOMAIN + '*') } | Select-Object -First 1; if ($u) { Set-Content -Path ($env:APPDIR + 'URL_PUBLICA.txt') -Value $u.public_url; exit 0 } } catch {}; Start-Sleep -Milliseconds 700 }; exit 1"
if exist "URL_PUBLICA.txt" (
    set "TUNEL_FIXO=1"
    goto tunel_pronto
)
echo [AVISO] O ngrok nao abriu o endereco fixo. Motivo (ngrok.log):
powershell -NoProfile -Command "if (Test-Path 'ngrok.log') { $l = Get-Content 'ngrok.log'; $e = $l | Where-Object { $_ -match 'lvl=(eror|crit)|err=' } | Select-Object -Last 3; if (-not $e) { $e = $l | Select-Object -Last 3 }; $e | ForEach-Object { '   ' + $_ } } else { '   (o ngrok nem chegou a iniciar)' }"
echo          Usando o tunel temporario da Cloudflare.
call "%~dp0stop.bat" /silencioso
goto tunel_cloudflare

:tunel_cloudflare
if exist "tunnel.log" del /q "tunnel.log"
if not exist "tools\cloudflared.exe" (
    echo Baixando cloudflared...
    if not exist "tools" mkdir tools
    powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'tools\cloudflared.exe'"
)
if not exist "tools\cloudflared.exe" (
    echo [AVISO] Falha ao baixar cloudflared. O jogo vai rodar so na rede local.
    goto tunel_pronto
)
powershell -NoProfile -Command "Start-Process -FilePath ($env:APPDIR + 'tools\cloudflared.exe') -ArgumentList 'tunnel','--no-autoupdate','--url','http://localhost:3000','--logfile','tunnel.log' -WorkingDirectory $env:APPDIR -WindowStyle Hidden"
powershell -NoProfile -Command "$f = $env:APPDIR + 'tunnel.log'; for ($i = 0; $i -lt 60; $i++) { if (Test-Path $f) { $c = Get-Content $f -Raw; if ($c -match 'https://[a-z0-9-]+\.trycloudflare\.com') { Set-Content -Path ($env:APPDIR + 'URL_PUBLICA.txt') -Value $Matches[0]; exit 0 } }; Start-Sleep -Milliseconds 500 }; exit 1"

:tunel_pronto
set "URL_PUBLICA="
if exist "URL_PUBLICA.txt" set /p URL_PUBLICA=<"URL_PUBLICA.txt"

echo.
echo ============================================
echo      INICIANDO SERVIDOR...
echo ============================================
echo.
echo ------------------------------------------
echo Acesso Local (mesmo PC):
echo   http://localhost:3000
echo.
echo Acesso na Rede Local (WiFi):
echo   http://%COMPUTERNAME%:3000
echo.
echo Acesso pela Internet:
if defined URL_PUBLICA (
    echo   %URL_PUBLICA%
    if defined TUNEL_FIXO (
        echo   ^(endereco fixo do ngrok^)
    ) else (
        echo   ^(tambem salvo em URL_PUBLICA.txt - muda a cada reinicio^)
    )
) else (
    echo   [AVISO] Tunel nao respondeu. Veja tunnel.log
)
echo ------------------------------------------
echo.
echo Para parar: feche esta janela e rode stop.bat
echo.

REM Iniciar servidor (caminho absoluto para o stop.bat identificar o processo)
node --disable-warning=ExperimentalWarning "%~dp0server.js"

REM Servidor parou: derrubar o tunel tambem
call "%~dp0stop.bat" /silencioso
echo.
echo [AVISO] Servidor parou.
pause

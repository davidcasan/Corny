@echo off
REM Abre o painel do Corny (janela para iniciar/parar o servidor), sem console.
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0painel.ps1"

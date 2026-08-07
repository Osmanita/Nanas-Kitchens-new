@echo off
REM Double-clickable entry point for the dev launcher. See scripts\dev.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev.ps1" %*

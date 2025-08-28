@echo off

rem Read and set variables from .env
for /f "tokens=1* delims==" %%a in (.env) do (
    set "%%a=%%b"
)

node --enable-source-maps dist/peer.js

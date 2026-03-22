@echo off
REM Direct port checking using netstat and wmic

setlocal enabledelayedexpansion

echo.
echo ========================================================================
echo PORT USAGE CHECK FOR PORTS 5173, 8002, 2567
echo ========================================================================
echo.

REM Check port 5173 (Vite frontend default)
echo PORT 5173 (Vite Frontend - Expected if frontend running)
echo -----------------------------------------------------------------------
echo Netstat output:
netstat -ano | findstr ":5173"
for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":5173"') do (
    echo.
    echo PID: %%A
    echo Process name:
    tasklist /FI "PID eq %%A" /NH
    echo.
    echo Command line and details:
    wmic process where processid=%%A get commandline,executablepath,workingdirectory /value 2>nul
)
echo.

REM Check port 8002 (Backend default)
echo ========================================================================
echo PORT 8002 (Backend - Expected if backend running)
echo -----------------------------------------------------------------------
echo Netstat output:
netstat -ano | findstr ":8002"
for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":8002"') do (
    echo.
    echo PID: %%A
    echo Process name:
    tasklist /FI "PID eq %%A" /NH
    echo.
    echo Command line and details:
    wmic process where processid=%%A get commandline,executablepath,workingdirectory /value 2>nul
)
echo.

REM Check port 2567 (Realtime/Socket.io default)
echo ========================================================================
echo PORT 2567 (Realtime/Socket.io - Expected if realtime running)
echo -----------------------------------------------------------------------
echo Netstat output:
netstat -ano | findstr ":2567"
for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":2567"') do (
    echo.
    echo PID: %%A
    echo Process name:
    tasklist /FI "PID eq %%A" /NH
    echo.
    echo Command line and details:
    wmic process where processid=%%A get commandline,executablepath,workingdirectory /value 2>nul
)

echo.
echo ========================================================================
echo END OF REPORT
echo ========================================================================

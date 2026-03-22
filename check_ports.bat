@echo off
REM Check port usage for 5173, 8002, 2567

echo ========================================
echo PORT USAGE CHECK FOR TWISTEDKART
echo ========================================
echo.

for %%P in (5173 8002 2567) do (
    echo ========================================
    echo PORT %%P
    echo ========================================
    
    netstat -ano | findstr ":%%P" | findstr "LISTENING"
    
    if errorlevel 1 (
        echo Status: NOT LISTENING
    ) else (
        echo Status: LISTENING (see above)
        echo.
        echo Detailed netstat output:
        netstat -ano | findstr ":%%P"
    )
    
    echo.
)

echo.
echo ========================================
echo COMPLETE NETSTAT OUTPUT FOR ALL 3 PORTS
echo ========================================
echo.

netstat -ano | findstr "5173\|8002\|2567"

echo.
echo ========================================
echo Done
echo ========================================

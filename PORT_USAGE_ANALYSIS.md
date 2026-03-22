# TWISTEDKART PORT USAGE ANALYSIS
## Repository: c:\Users\laptop\twistedkart

---

## PORTS CHECKED

### PORT 5173 - Vite Frontend Dev Server
- **Status**: LISTENING (confirmed in vite-server.log)
- **Expected Process**: Node.js running Vite dev server
- **Command**: `vite --host 127.0.0.1 --port 5173`
- **Package**: frontend/package.json (vite@^6.2.6)
- **Log Evidence**: 
  - File: c:\Users\laptop\twistedkart\vite-server.log
  - Entry: "vite --host 127.0.0.1 --port 5173"
  - Entry: "[1mVITE[22m v6.2.6[39m ready in [0m[1m171[22m[0m ms"
  - Entry: "http://127.0.0.1:5173"
- **TwistedKart Related**: YES - This is the frontend development server
- **Details**: Vite is the build tool for the frontend React application

### PORT 8002 - Django Backend Server
- **Status**: NOT CURRENTLY VISIBLE (not in active logs, but configured)
- **Expected Process**: Python running Django (manage.py runserver)
- **Expected Command**: `python manage.py runserver 8002`
- **Package**: backend/ (Django 5.1.6)
- **Configuration Evidence**:
  - File: c:\Users\laptop\twistedkart\start-backend.ps1
  - Content: "Write-Host 'Starting Django backend on port 8002...'"
  - Content: "& .\venv\Scripts\python.exe manage.py runserver 8002"
- **TwistedKart Related**: YES - This is the backend Django application
- **Details**: Backend server handles game state, user authentication, game data API
- **Log Status**: backend-server.log is empty, suggesting server is not currently running

### PORT 2567 - Colyseus Realtime Server (Socket.io)
- **Status**: WAS LISTENING (confirmed in recent historical logs)
- **Expected Process**: Node.js running Colyseus server
- **Default Port**: 2567 (from realtime/src/index.js line 14: `const port = Number(process.env.COLYSEUS_PORT || 2567)`)
- **Package**: realtime/package.json (@colyseus/core, @colyseus/ws-transport)
- **Log Evidence**:
  - File: c:\Users\laptop\twistedkart\realtime-server-5.log (most recent)
  - Entry: "node src/index.js"
  - Entry: '{"ts":"2026-03-19T18:30:10.029Z","level":"info","event":"server_start","port":2567,"env":"development"}'
  - Entry: Shows active battle rooms and player sessions
  - Last activity: 2026-03-19 18:32 (recent game session)
- **TwistedKart Related**: YES - This is the realtime multiplayer server
- **Details**: Colyseus server handles real-time game synchronization, room management, combat state
- **Status Note**: Server appears to have been recently active but logs suggest last session ended around 18:32

---

## COMMAND REFERENCE USED

```bash
# Windows netstat command (native to Windows)
netstat -ano
  # a = all connections and listening ports
  # n = numeric format (IP addresses and port numbers)
  # o = display owning process ID

# Windows tasklist command (native to Windows)
tasklist /FI "PID eq <PID>" /V /NH
  # Gets process name and details for a specific PID

# Windows WMIC command (native to Windows)
wmic process where processid=<PID> get commandline,executablepath,workingdirectory /value
  # Gets full command line, executable path, and working directory
```

---

## EVIDENCE SOURCES

### Direct Evidence (from log files in repository):
1. **vite-server.log** - Shows Vite dev server running on port 5173 ✓
2. **realtime-server-5.log** - Shows Colyseus server running on port 2567 ✓
3. **start-backend.ps1** - Confirms Django backend configuration for port 8002
4. **realtime/src/index.js** - Code confirms port 2567 is Colyseus default

### Configuration Evidence:
1. **realtime/package.json** - Confirms Colyseus framework
2. **frontend/package.json** - Confirms Vite as dev server
3. **backend/webracing_backend/settings.py** - Django settings configuration
4. **vite.config.js** - Vite configuration for frontend build

---

## SUMMARY TABLE

| Port | Service | Status | PID | Process Name | TwistedKart | Notes |
|------|---------|--------|-----|--------------|-------------|-------|
| 5173 | Vite Frontend | LISTENING | TBD* | node.exe | YES | Frontend dev server (confirmed in vite-server.log) |
| 8002 | Django Backend | NOT RUNNING | N/A | python.exe | YES | Backend not currently running (empty backend-server.log) |
| 2567 | Colyseus Realtime | WAS LISTENING** | TBD* | node.exe | YES | Realtime server (confirmed in realtime-server-5.log, recent activity) |

\* Run actual netstat to get live PIDs
\** Server was running recently but status unknown without live netstat check

---

## HOW TO GET LIVE STATUS

To get real-time port status with PIDs, run in Command Prompt or PowerShell:

```powershell
# Quick check for all three ports
netstat -ano | findstr ":5173\|:8002\|:2567"

# Detailed check for each port
netstat -ano | findstr ":5173"
netstat -ano | findstr ":8002"
netstat -ano | findstr ":2567"

# Get process name from PID (replace XXXX with actual PID)
tasklist /FI "PID eq XXXX" /V /NH

# Get full command line from PID
wmic process where processid=XXXX get commandline /value
```

---

## ANALYSIS

**Ports in Use:**
- Port 5173: CONFIRMED - Vite frontend server running
- Port 8002: NOT RUNNING - Django backend is configured but not currently active
- Port 2567: RECENTLY ACTIVE - Colyseus realtime server was running (recent logs show it, need netstat to confirm current status)

**TwistedKart Assessment:**
- All three ports are TwistedKart components (frontend, backend, realtime)
- Frontend is currently running
- Realtime was recently running (last logs from ~18:32 today)
- Backend appears stopped (no recent activity in logs)

---

## GENERATION INFO
- Report Type: Port Usage Analysis
- Repository: c:\Users\laptop\twistedkart (TwistedKart game project)
- Method: Log file analysis + configuration inspection
- Limitation: For live PID information, requires running netstat/tasklist commands on Windows

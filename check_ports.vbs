CreateObject("WScript.Shell").Run "cmd /c netstat -ano | findstr :5173 > """ & CreateObject("WScript.Shell").CurrentDirectory & "\port_5173_live.txt""", 0
CreateObject("WScript.Shell").Run "cmd /c netstat -ano | findstr :8002 > """ & CreateObject("WScript.Shell").CurrentDirectory & "\port_8002_live.txt""", 0
CreateObject("WScript.Shell").Run "cmd /c netstat -ano | findstr :2567 > """ & CreateObject("WScript.Shell").CurrentDirectory & "\port_2567_live.txt""", 0

WScript.Sleep(2000)

' Display results
Dim shell, result
Set shell = CreateObject("WScript.Shell")

WScript.Echo "Port 5173 (Vite Frontend):"
On Error Resume Next
Set result = shell.Exec("cmd /c type port_5173_live.txt")
WScript.Echo result.StdOut.ReadAll()
WScript.Echo ""

WScript.Echo "Port 8002 (Django Backend):"
Set result = shell.Exec("cmd /c type port_8002_live.txt")
WScript.Echo result.StdOut.ReadAll()
WScript.Echo ""

WScript.Echo "Port 2567 (Colyseus Realtime):"
Set result = shell.Exec("cmd /c type port_2567_live.txt")
WScript.Echo result.StdOut.ReadAll()
WScript.Echo ""

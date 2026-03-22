REM Run netstat command and save to file
cmd /c netstat -ano > c:\Users\laptop\twistedkart\netstat_output.txt

REM Run tasklist
cmd /c tasklist > c:\Users\laptop\twistedkart\tasklist_output.txt

REM Check specific ports
cmd /c netstat -ano | findstr ":5173" > c:\Users\laptop\twistedkart\port_5173.txt
cmd /c netstat -ano | findstr ":8002" > c:\Users\laptop\twistedkart\port_8002.txt
cmd /c netstat -ano | findstr ":2567" > c:\Users\laptop\twistedkart\port_2567.txt

REM Run wmic for all potential processes
cmd /c "wmic process get processid,name,commandline" > c:\Users\laptop\twistedkart\wmic_processes.txt

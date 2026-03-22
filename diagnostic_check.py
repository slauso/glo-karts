#!/usr/bin/env python3
"""
Direct port checking - execute system commands and parse results
"""

import subprocess
import re
import sys

def run_command(cmd):
    """Run a command and return output"""
    try:
        output = subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.DEVNULL)
        return output.strip()
    except Exception as e:
        return f"Error: {e}"

def main():
    ports = [
        (5173, "Vite Frontend (npm dev server)"),
        (8002, "Django Backend (manage.py runserver)"),
        (2567, "Colyseus Realtime Server (node src/index.js)")
    ]
    
    print("=" * 90)
    print("TWISTEDKART PORT USAGE DIAGNOSTIC")
    print("=" * 90)
    print()
    
    # First get complete netstat output
    print("STEP 1: Running netstat -ano to check all listening ports")
    print("-" * 90)
    netstat_output = run_command("netstat -ano | findstr LISTENING")
    
    port_data = {}
    for port_num, desc in ports:
        print()
        print(f"PORT {port_num}: {desc}")
        print("-" * 90)
        
        # Search for port in netstat
        port_pattern = f':{port_num}\\s'
        found = False
        
        for line in netstat_output.split('\n'):
            if re.search(port_pattern, line):
                print(f"Netstat Entry: {line}")
                found = True
                
                # Extract PID (last field)
                parts = line.split()
                if len(parts) >= 5:
                    pid = parts[-1]
                    port_data[port_num] = {'pid': pid, 'netstat_line': line}
                    
                    # Get process name
                    print(f"PID: {pid}")
                    
                    tasklist_cmd = f'tasklist /FI "PID eq {pid}" /V /NH'
                    tasklist_output = run_command(tasklist_cmd)
                    if tasklist_output and 'Error' not in tasklist_output:
                        lines = tasklist_output.split('\n')
                        if lines:
                            print(f"Tasklist:\n  {lines[0]}")
                            port_data[port_num]['tasklist'] = lines[0]
                    
                    # Get wmic details
                    wmic_cmd = f'wmic process where processid={pid} get commandline,executablepath,workingdirectory /value'
                    wmic_output = run_command(wmic_cmd)
                    if wmic_output and 'Error' not in wmic_output:
                        print(f"Process Details (wmic):")
                        for wmic_line in wmic_output.split('\n'):
                            if '=' in wmic_line and wmic_line.strip():
                                print(f"  {wmic_line.strip()}")
                        port_data[port_num]['wmic'] = wmic_output
        
        if not found:
            print("Status: NOT LISTENING on this port")
            print("Expected: If this TwistedKart component was running, it should appear above.")
        else:
            # Assess if TwistedKart
            full_info = str(port_data.get(port_num, {})).lower()
            keywords = ['node', 'npm', 'vite', 'python', 'manage.py', 'django', 
                       'colyseus', 'realtime', 'frontend', 'backend', 'kart']
            if any(kw in full_info for kw in keywords):
                print(f"TwistedKart Component: YES (confirmed by process details)")
            else:
                print(f"TwistedKart Component: UNKNOWN (not identified by keywords)")
    
    print()
    print("=" * 90)
    print("SUMMARY")
    print("=" * 90)
    print()
    print("Evidence Source: netstat -ano, tasklist, wmic")
    print()
    
    for port_num, desc in ports:
        status = "LISTENING" if port_num in port_data else "NOT LISTENING"
        print(f"Port {port_num}: {status:20} - {desc}")
    
    print()
    print("NOTE: Results based on Windows netstat/tasklist/wmic commands")
    print("If a process appears here, it is actively listening on that port right now.")

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Port check script - using subprocess to run netstat and parse
This works on Windows without special Python packages
"""

import subprocess
import sys
import os

def get_netstat_output():
    """Get raw netstat output"""
    try:
        # On Windows, use: netstat -ano
        # a = all connections
        # n = numeric form
        # o = owning process ID
        result = subprocess.run(
            ['netstat', '-ano'],
            capture_output=True,
            text=True,
            timeout=10
        )
        return result.stdout
    except Exception as e:
        print(f"Error running netstat: {e}")
        return ""

def get_tasklist_for_pid(pid):
    """Get process info for a PID"""
    try:
        result = subprocess.run(
            ['tasklist', '/FI', f'PID eq {pid}', '/V', '/NH'],
            capture_output=True,
            text=True,
            timeout=5
        )
        return result.stdout.strip()
    except Exception as e:
        return f"Error: {e}"

def get_wmic_for_pid(pid):
    """Get detailed process info using wmic"""
    try:
        result = subprocess.run(
            f'wmic process where processid={pid} get commandline,executablepath,workingdirectory /value',
            shell=True,
            capture_output=True,
            text=True,
            timeout=5
        )
        return result.stdout.strip()
    except Exception as e:
        return f"Error: {e}"

def main():
    ports_to_check = [
        (5173, "Vite Frontend Dev Server"),
        (8002, "Django Backend"),
        (2567, "Colyseus Realtime Server")
    ]
    
    print("=" * 100)
    print("TWISTEDKART PORT USAGE REPORT")
    print("=" * 100)
    print()
    
    # Get netstat output
    print("Running: netstat -ano")
    print("This shows all listening ports and their owning process IDs")
    print()
    
    netstat_output = get_netstat_output()
    
    if not netstat_output:
        print("ERROR: Could not get netstat output")
        sys.exit(1)
    
    results = {}
    
    for port, description in ports_to_check:
        print(f"\n{'='*100}")
        print(f"PORT {port}: {description}")
        print(f"{'='*100}")
        
        # Look for this port in netstat
        port_str = f":{port} "
        found = False
        
        for line in netstat_output.split('\n'):
            if port_str in line and 'LISTENING' in line:
                print(f"✓ LISTENING")
                print(f"  Netstat line: {line.strip()}")
                found = True
                
                # Extract PID (usually last column)
                parts = line.split()
                if len(parts) >= 5:
                    try:
                        pid = int(parts[-1])
                        print(f"  PID: {pid}")
                        results[port] = {'status': 'LISTENING', 'pid': pid}
                        
                        # Get process info
                        tasklist_info = get_tasklist_for_pid(pid)
                        if tasklist_info and 'Error' not in tasklist_info:
                            first_line = tasklist_info.split('\n')[0] if tasklist_info else ''
                            if first_line:
                                print(f"  Process: {first_line[:120]}")
                                results[port]['process'] = first_line
                        
                        # Get detailed info
                        wmic_info = get_wmic_for_pid(pid)
                        if wmic_info and 'Error' not in wmic_info:
                            print(f"  Details:")
                            for detail_line in wmic_info.split('\n'):
                                if '=' in detail_line and detail_line.strip():
                                    key, val = detail_line.split('=', 1)
                                    if val.strip():
                                        print(f"    {key.strip()}: {val.strip()[:90]}")
                            results[port]['details'] = wmic_info
                        
                        # Determine if TwistedKart
                        all_text = (tasklist_info + wmic_info).lower()
                        tk_keywords = ['node', 'npm', 'vite', 'python', 'manage.py', 
                                      'django', 'colyseus', 'realtime', 'frontend', 
                                      'backend', 'twisted', 'kart']
                        
                        is_tk = any(kw in all_text for kw in tk_keywords)
                        results[port]['is_twistedkart'] = is_tk
                        
                        if is_tk:
                            print(f"  ★ TwistedKart Related: YES")
                        else:
                            print(f"  ☆ TwistedKart Related: UNLIKELY")
                        
                    except (ValueError, IndexError) as e:
                        print(f"  Error parsing PID: {e}")
                
                break
        
        if not found:
            print(f"✗ NOT LISTENING on this port")
            results[port] = {'status': 'NOT LISTENING', 'listening': False}
    
    # Summary
    print(f"\n{'='*100}")
    print("SUMMARY")
    print(f"{'='*100}\n")
    
    for port, description in ports_to_check:
        if port in results:
            res = results[port]
            status = res.get('status', 'UNKNOWN')
            pid = res.get('pid', 'N/A')
            is_tk = res.get('is_twistedkart', False)
            tk_str = "✓" if is_tk else "✗"
            
            print(f"Port {port:5} | Status: {status:15} | PID: {str(pid):8} | TwistedKart: {tk_str} | {description}")
        else:
            print(f"Port {port:5} | Status: {'UNKNOWN':15} | PID: {'N/A':8} | TwistedKart: ✗ | {description}")
    
    print()
    print("Command used: netstat -ano (Windows native)")
    print("Additional commands: tasklist, wmic")

if __name__ == '__main__':
    main()

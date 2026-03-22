#!/usr/bin/env python3
"""
Check port usage for 5173, 8002, 2567 on Windows
Uses multiple methods: socket, psutil, subprocess netstat
"""

import socket
import subprocess
import sys
import re
import os

def check_port_socket(port):
    """Check if a port is listening using socket"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        result = sock.connect_ex(('127.0.0.1', port))
        sock.close()
        # connect_ex returns 0 on success (port is open)
        return result == 0
    except Exception as e:
        return False

def parse_netstat():
    """Parse netstat output to find listening processes"""
    try:
        output = subprocess.check_output('netstat -ano', shell=True, text=True, 
                                        stderr=subprocess.DEVNULL)
        return output
    except Exception as e:
        print(f"Error running netstat: {e}")
        return ""

def get_process_name(pid):
    """Get process name from PID"""
    try:
        output = subprocess.check_output(f'tasklist /FI "PID eq {pid}"', 
                                        shell=True, text=True, stderr=subprocess.DEVNULL)
        lines = output.strip().split('\n')
        for line in lines[3:]:  # Skip header lines
            if pid in line:
                return line.split()[0]
    except:
        pass
    return None

def get_process_details(pid):
    """Get detailed process information"""
    try:
        output = subprocess.check_output(
            f'wmic process where processid={pid} get commandline,workingdirectory,executablepath /value',
            shell=True, text=True, stderr=subprocess.DEVNULL)
        return output
    except:
        return ""

def main():
    ports = [5173, 8002, 2567]
    
    print("=" * 80)
    print("PORT USAGE CHECK FOR TWISTEDKART")
    print("=" * 80)
    print()
    
    # First, check with socket method
    print("SOCKET CHECK (Quick connectivity test):")
    print("-" * 40)
    for port in ports:
        is_open = check_port_socket(port)
        print(f"Port {port}: {'RESPONDING' if is_open else 'NOT RESPONDING'}")
    print()
    
    # Now parse netstat for detailed info
    print("NETSTAT ANALYSIS (Listening processes):")
    print("-" * 40)
    
    netstat_output = parse_netstat()
    
    for port in ports:
        print()
        print(f"Port {port}:")
        port_pattern = f":{port}\\s"
        matching_lines = []
        
        for line in netstat_output.split('\n'):
            if re.search(port_pattern, line) and 'LISTENING' in line:
                matching_lines.append(line)
        
        if matching_lines:
            print("  Status: LISTENING")
            for line in matching_lines:
                print(f"  {line}")
                # Extract PID from netstat output
                parts = line.split()
                if parts:
                    pid = parts[-1]
                    print(f"  PID: {pid}")
                    
                    # Get process name
                    proc_name = get_process_name(pid)
                    if proc_name:
                        print(f"  Process Name: {proc_name}")
                    
                    # Get process details
                    details = get_process_details(pid)
                    if details:
                        print(f"  Process Details:")
                        for line in details.split('\n'):
                            if '=' in line and line.strip():
                                print(f"    {line.strip()}")
                    
                    # Check if TwistedKart related
                    all_info = (details + (proc_name or "")).lower()
                    if any(kw in all_info for kw in ['node', 'npm', 'vite', 'python', 'realtime', 'backend']):
                        print(f"  TwistedKart Related: LIKELY YES")
                    else:
                        print(f"  TwistedKart Related: INCONCLUSIVE")
        else:
            print("  Status: NOT LISTENING (or not found in netstat)")
    
    print()
    print("=" * 80)
    print("COMMAND REFERENCE:")
    print("  Socket check: Attempted connection to 127.0.0.1:port")
    print("  netstat -ano: Display all connections with owning process ID")
    print("  tasklist /FI: Filter processes by PID")
    print("  wmic process: Get detailed command line and working directory")
    print("=" * 80)

if __name__ == '__main__':
    main()
